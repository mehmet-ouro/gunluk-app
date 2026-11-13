// A dreamcontext App backend, zero dependencies. Keep the three rules:
//   1. listen on process.env.PORT at process.env.HOST (127.0.0.1);
//   2. refuse anything without the gateway secret (dcGuard);
//   3. keep data in process.env.DC_DATA_DIR, secrets in .env (never committed).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dc } from './lib/dc.mjs';
import { createStore, InputError, checkDay, checkTitle, checkProject, checkStatus, checkId, checkDescription, checkTags, checkDayOrBacklog, checkUrgency } from './lib/store.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DC_DATA_DIR || join(ROOT, 'data');
const SECRET = process.env.DC_GATEWAY_SECRET || '';

/** Only the dreamcontext gateway knows the secret: nothing else on this Mac reaches the app. */
function dcGuard(req) {
  return SECRET !== '' && req.headers['x-dc-gateway-secret'] === SECRET;
}

/** Escape text before it goes into HTML. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const CSP = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' http://127.0.0.1:*";

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 128 * 1024) throw new InputError('İstek çok büyük.');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  try { return text ? JSON.parse(text) : {}; } catch { throw new InputError('Geçersiz JSON.'); }
}

/** Today on this Mac, as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const store = createStore(DATA);

const routes = {
  'GET /health': async (_req, res) => json(res, 200, dc.health()),

  // Read tools (in the manifest, open to agents).
  'GET /api/day': async (_req, res, url) => json(res, 200, await store.day(checkDayOrBacklog(url.searchParams.get('date') || today()))),
  'GET /api/projects': async (_req, res) => json(res, 200, await store.projects()),
  'GET /api/carryover': async (_req, res, url) => {
    const day = checkDay(url.searchParams.get('today') || today());
    json(res, 200, { today: day, tasks: await store.carryover(day) });
  },

  // The page's own routes. Not in the manifest: only the user changes anything, from the window.
  'GET /api/counts': async (_req, res, url) => json(res, 200, await store.counts(checkDay(url.searchParams.get('from')), checkDay(url.searchParams.get('to')))),
  'POST /api/tasks': async (req, res) => {
    const b = await readBody(req);
    json(res, 200, await store.add({ day: checkDayOrBacklog(b.day), title: checkTitle(b.title), project: checkProject(b.project), urgency: checkUrgency(b.urgency) }));
  },
  'POST /api/tasks/update': async (req, res) => {
    const b = await readBody(req);
    const patch = {};
    if (b.title !== undefined) patch.title = checkTitle(b.title);
    if (b.project !== undefined) patch.project = checkProject(b.project);
    if (b.status !== undefined) patch.status = checkStatus(b.status);
    if (b.urgency !== undefined) patch.urgency = checkUrgency(b.urgency);
    if (b.day !== undefined) patch.day = checkDayOrBacklog(b.day);
    if (b.description !== undefined) patch.description = checkDescription(b.description);
    if (b.tags !== undefined) patch.tags = checkTags(b.tags);
    json(res, 200, await store.update(checkId(b.id), patch));
  },
  'POST /api/tasks/delete': async (req, res) => {
    const b = await readBody(req);
    json(res, 200, await store.remove(checkId(b.id)));
  },
  'POST /api/tasks/reorder': async (req, res) => {
    const b = await readBody(req);
    if (!Array.isArray(b.ids)) throw new InputError('Sıra listesi eksik.');
    json(res, 200, await store.reorder(checkDayOrBacklog(b.day), b.ids.map(checkId)));
  },
  'POST /api/subtasks': async (req, res) => {
    const b = await readBody(req);
    json(res, 200, await store.addSub(checkId(b.taskId), checkTitle(b.title)));
  },
  'POST /api/subtasks/update': async (req, res) => {
    const b = await readBody(req);
    const patch = {};
    if (b.title !== undefined) patch.title = checkTitle(b.title);
    if (b.status !== undefined) patch.status = checkStatus(b.status);
    json(res, 200, await store.updateSub(checkId(b.taskId), checkId(b.id), patch));
  },
  'POST /api/subtasks/delete': async (req, res) => {
    const b = await readBody(req);
    json(res, 200, await store.removeSub(checkId(b.taskId), checkId(b.id)));
  },
  'POST /api/subtasks/reorder': async (req, res) => {
    const b = await readBody(req);
    if (!Array.isArray(b.ids)) throw new InputError('Sıra listesi eksik.');
    json(res, 200, await store.reorderSubs(checkId(b.taskId), b.ids.map(checkId)));
  },
};

// Every manifest action this backend serves, by id.
dc.actions(['day-tasks', 'projects', 'carryover']);

const server = http.createServer(async (req, res) => {
  if (!dcGuard(req)) { res.writeHead(401); res.end('unauthorized'); return; }
  const url = new URL(req.url, 'http://app');
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) { await route(req, res, url); return; }
    // Static files from public/ (no directory escape).
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(404); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' });
    res.end(data);
  } catch (err) {
    if (err instanceof InputError) { json(res, 400, { error: err.message }); return; }
    if (err && err.code === 'ENOENT') { res.writeHead(404); res.end('not found'); return; }
    console.error(err);
    json(res, 500, { error: 'internal' });
  }
});

server.listen(Number(process.env.PORT), process.env.HOST || '127.0.0.1');
