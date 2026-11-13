// Günlük's data: one JSON file in DC_DATA_DIR, written atomically (tmp + rename), one write at a time.
// Projects are kept in the file and added there only when the user asks for one (never by the app's
// assistant); the window only picks from them.
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUSES = ['not_started', 'in_progress', 'almost_done', 'waiting', 'done'];
export const URGENCIES = ['urgent', 'high', 'normal', 'low'];
const RANK = Object.fromEntries(URGENCIES.map((u, i) => [u, i]));
/** Urgency first (Acil on top), then the user's own drag order inside it. */
const byUrgency = (a, b) => (RANK[a.urgency] - RANK[b.urgency]) || (a.order - b.order);
export const PROJECT_COLORS = ['peach', 'sky', 'mint', 'lilac', 'sun', 'rose', 'lime', 'sand'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InputError extends Error {}

function normalize(raw) {
  const projects = (Array.isArray(raw.projects) ? raw.projects : [])
    .map((p) => (typeof p === 'string' ? { name: p, color: 'sand' } : p))
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .map((p) => ({ name: p.name.trim(), color: PROJECT_COLORS.includes(p.color) ? p.color : 'sand' }));
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map((t, i) => ({
    ...t,
    day: typeof t.day === 'string' && t.day ? t.day : null, // null = backlog (no date)
    urgency: URGENCIES.includes(t.urgency) ? t.urgency : 'normal',
    order: Number.isFinite(t.order) ? t.order : i,
    description: typeof t.description === 'string' ? t.description : '',
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    tags: Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string') : [],
  }));
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).filter((x) => typeof x === 'string' && x.trim());
  return { version: 3, projects, tasks, tags };
}

export function createStore(dir) {
  const file = join(dir, 'gunluk.json');
  let cache = null;
  let cacheMtime = 0;
  let queue = Promise.resolve();

  /** The file is the truth: a change made outside the app (a project added, a restore) is picked up on the next read. */
  async function load() {
    let mtime = 0;
    try { mtime = (await stat(file)).mtimeMs; } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (cache && mtime === cacheMtime) return cache;
    try {
      cache = normalize(JSON.parse(await readFile(file, 'utf-8')));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      cache = normalize({});
    }
    cacheMtime = mtime;
    return cache;
  }

  async function save(data) {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
    cacheMtime = (await stat(file)).mtimeMs;
  }

  /** Run one mutation at a time; the cache only changes once the file is written. */
  function mutate(fn) {
    const run = queue.then(async () => {
      const next = structuredClone(await load());
      const result = fn(next);
      await save(next);
      cache = next;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  const dayTasks = (data, day) => data.tasks.filter((t) => t.day === day).sort(byUrgency);
  const nextOrder = (data, day) => data.tasks.filter((t) => t.day === day).reduce((m, t) => Math.max(m, t.order), -1) + 1;
  const find = (data, id) => {
    const t = data.tasks.find((x) => x.id === id);
    if (!t) throw new InputError('Görev bulunamadı.');
    return t;
  };
  const findSub = (task, id) => {
    const s = task.subtasks.find((x) => x.id === id);
    if (!s) throw new InputError('Alt görev bulunamadı.');
    return s;
  };
  /** Only a project that exists in the file may be set; '' is "no project". */
  const known = (data, project) => {
    if (!project) return '';
    const p = data.projects.find((x) => x.name === project);
    if (!p) throw new InputError('Bu proje listede yok.');
    return p.name;
  };
  const touch = (t) => { t.updatedAt = new Date().toISOString(); return t; };
  /** Every tag the user has used, kept for autocomplete; a new spelling reuses the stored one. */
  const keepTags = (data, tags) => tags.map((tag) => {
    const known = data.tags.find((x) => x.toLocaleLowerCase('tr') === tag.toLocaleLowerCase('tr'));
    if (known) return known;
    data.tags.push(tag);
    return tag;
  });
  const sortedProjects = (data) => [...data.projects].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return {
    async day(day) {
      const data = await load();
      return {
        date: day ?? 'backlog',
        tasks: dayTasks(data, day),
        backlog: data.tasks.filter((t) => t.day === null).length,
        projects: sortedProjects(data),
        tags: [...data.tags].sort((a, b) => a.localeCompare(b, 'tr')),
      };
    },

    /** Dated tasks before `today` that are not done (waiting included, backlog excluded), oldest day first. Read only. */
    async carryover(today) {
      const data = await load();
      return data.tasks
        .filter((t) => t.day !== null && t.day < today && t.status !== 'done')
        .sort((a, b) => (RANK[a.urgency] - RANK[b.urgency]) || (a.day === b.day ? a.order - b.order : a.day < b.day ? -1 : 1));
    },

    async projects() {
      const data = await load();
      return sortedProjects(data).map((p) => {
        const own = data.tasks.filter((t) => t.project === p.name);
        return { ...p, tasks: own.length, open: own.filter((t) => t.status !== 'done').length };
      });
    },

    async counts(from, to) {
      const data = await load();
      // Day dots count dated tasks only; the backlog has its own number.
      const out = { backlog: data.tasks.filter((t) => t.day === null).length };
      for (const t of data.tasks) {
        if (t.day === null || t.day < from || t.day > to) continue;
        out[t.day] ??= { open: 0, done: 0 };
        out[t.day][t.status === 'done' ? 'done' : 'open'] += 1;
      }
      return out;
    },

    add({ day, title, project, urgency = 'normal' }) {
      return mutate((data) => {
        const now = new Date().toISOString();
        const task = { id: randomUUID(), day, title, project: known(data, project), urgency, status: 'not_started', order: nextOrder(data, day), description: '', subtasks: [], tags: [], createdAt: now, updatedAt: now };
        data.tasks.push(task);
        return task;
      });
    },

    update(id, patch) {
      return mutate((data) => {
        const t = find(data, id);
        if (patch.title !== undefined) t.title = patch.title;
        if (patch.project !== undefined) t.project = known(data, patch.project);
        if (patch.status !== undefined) t.status = patch.status;
        if (patch.urgency !== undefined) t.urgency = patch.urgency;
        if (patch.description !== undefined) t.description = patch.description;
        if (patch.tags !== undefined) t.tags = keepTags(data, patch.tags);
        if (patch.day !== undefined && patch.day !== t.day) { t.order = nextOrder(data, patch.day); t.day = patch.day; }
        return touch(t);
      });
    },

    remove(id) {
      return mutate((data) => {
        find(data, id);
        data.tasks = data.tasks.filter((t) => t.id !== id);
        return { ok: true };
      });
    },

    reorder(day, ids) {
      return mutate((data) => {
        const tasks = dayTasks(data, day);
        if (ids.length !== tasks.length || !tasks.every((t) => ids.includes(t.id))) throw new InputError('Sıra listesi bu günün görevleriyle eşleşmiyor.');
        ids.forEach((id, i) => { find(data, id).order = i; });
        return { ok: true };
      });
    },

    addSub(taskId, title) {
      return mutate((data) => {
        const t = find(data, taskId);
        if (t.subtasks.length >= 100) throw new InputError('Bir görevde en fazla 100 alt görev olur.');
        t.subtasks.push({ id: randomUUID(), title, status: 'not_started' });
        return touch(t);
      });
    },

    updateSub(taskId, id, patch) {
      return mutate((data) => {
        const t = find(data, taskId);
        const s = findSub(t, id);
        if (patch.title !== undefined) s.title = patch.title;
        if (patch.status !== undefined) s.status = patch.status;
        return touch(t);
      });
    },

    removeSub(taskId, id) {
      return mutate((data) => {
        const t = find(data, taskId);
        findSub(t, id);
        t.subtasks = t.subtasks.filter((s) => s.id !== id);
        return touch(t);
      });
    },

    reorderSubs(taskId, ids) {
      return mutate((data) => {
        const t = find(data, taskId);
        if (ids.length !== t.subtasks.length || !t.subtasks.every((s) => ids.includes(s.id))) throw new InputError('Sıra listesi alt görevlerle eşleşmiyor.');
        t.subtasks = ids.map((id) => findSub(t, id));
        return touch(t);
      });
    },
  };
}

// Boundary validation for the page's input.
/** A day, or the backlog: 'backlog' (or null) means no date and returns null. */
export function checkDayOrBacklog(v) {
  if (v === null || v === 'backlog') return null;
  return checkDay(v);
}
export function checkDay(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new InputError('Geçersiz tarih.');
  return v;
}
export function checkTitle(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new InputError('Başlık boş olamaz.');
  if (s.length > 300) throw new InputError('Başlık en fazla 300 karakter.');
  return s;
}
export function checkProject(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > 40) throw new InputError('Geçersiz proje.');
  return v;
}
export function checkDescription(v) {
  if (typeof v !== 'string') throw new InputError('Geçersiz açıklama.');
  if (v.length > 20000) throw new InputError('Açıklama en fazla 20.000 karakter.');
  return v;
}
export function checkTags(v) {
  if (!Array.isArray(v) || v.length > 20) throw new InputError('Bir görevde en fazla 20 etiket olur.');
  const out = [];
  for (const raw of v) {
    if (typeof raw !== 'string') throw new InputError('Geçersiz etiket.');
    const tag = raw.replace(/\s+/g, ' ').trim().replace(/^#/, '');
    if (!tag) continue;
    if (tag.length > 30) throw new InputError('Etiket en fazla 30 karakter.');
    if (!out.some((x) => x.toLocaleLowerCase('tr') === tag.toLocaleLowerCase('tr'))) out.push(tag);
  }
  return out;
}
export function checkUrgency(v) {
  if (v === undefined) return 'normal';
  if (!URGENCIES.includes(v)) throw new InputError('Geçersiz aciliyet.');
  return v;
}
export function checkStatus(v) {
  if (!STATUSES.includes(v)) throw new InputError('Geçersiz durum.');
  return v;
}
export function checkId(v) {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) throw new InputError('Geçersiz kimlik.');
  return v;
}
