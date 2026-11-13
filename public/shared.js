// Pieces the list and the side panel share: statuses, icons, DOM helpers, the backend, dates,
// the status menu, the toast and drag-to-sort.

export const STATUSES = [
  { id: 'not_started', label: 'Başlamadı' },
  { id: 'in_progress', label: 'Devam ediyor' },
  { id: 'almost_done', label: 'Bitmek üzere' },
  { id: 'waiting', label: 'Bekliyor' },
  { id: 'done', label: 'Bitti' },
];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const statusOf = (id) => STATUS_BY_ID[id] || STATUS_BY_ID.not_started;
/** The CSS variables one status paints with. */
export const statusVars = (id) => { const s = statusOf(id).id; return `--bg: var(--s-${s}-bg); --ink-s: var(--s-${s}-ink); --dot: var(--s-${s}-dot);`; };

// The round status mark: ring (not started), filling pie (in progress, almost done), pause (waiting), tick (done).
const pie = (frac) => {
  const a = frac * 2 * Math.PI;
  const x = 12 + 7 * Math.sin(a), y = 12 - 7 * Math.cos(a);
  return `<path class="solid" d="M12 12 L12 5 A7 7 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z"/>`;
};
export const ICONS = {
  not_started: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="10"/></svg>',
  in_progress: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="10"/>${pie(0.5)}</svg>`,
  almost_done: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="10"/>${pie(0.75)}</svg>`,
  waiting: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="solid" cx="12" cy="12" r="11"/><path class="mark" d="M9.5 8v8M14.5 8v8"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="solid" cx="12" cy="12" r="11"/><path class="mark" d="M7.5 12.5l3 3 6-6.5"/></svg>',
};

export const $ = (id) => document.getElementById(id);
export const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
};

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Bir şey ters gitti (${res.status}).`);
  return data;
}

// ---------- dates (local, YYYY-MM-DD) ----------
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const todayIso = () => iso(new Date());
export const fmtDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' });
export const fmtYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
export const fmtWeekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'long' });
export const fmtShort = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });
export const weekStart = (s) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const BACKLOG = 'backlog';

// Urgency: the list's first sort key (Acil on top); the user's drag order applies inside each level.
export const URGENCIES = [
  { id: 'urgent', label: 'Acil' },
  { id: 'high', label: 'Yüksek' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Düşük' },
];
const URANK = { urgent: 0, high: 1, normal: 2, low: 3 };
export const urgencyRank = (t) => URANK[t.urgency] ?? 2;
export const urgencyLabel = (id) => (URGENCIES.find((u) => u.id === id) || URGENCIES[2]).label;
/** The server's rule exactly: urgency, then the saved order number. */
export const byUrgency = (list) => [...list].sort((a, b) => (urgencyRank(a) - urgencyRank(b)) || ((a.order ?? 0) - (b.order ?? 0)));
/** "!! title" = urgent, "! title" = high, "~ title" = low; the mark is removed from the title. */
export function urgencyFromTitle(raw) {
  const m = raw.match(/^\s*(!!|!|~)\s+/); // a space after the mark, so "~30 dk" stays text
  if (!m) return { title: raw, urgency: null };
  return { title: raw.slice(m[0].length), urgency: m[1] === '!!' ? 'urgent' : m[1] === '!' ? 'high' : 'low' };
}
/** "Yarın" for tomorrow, "Backlog" for no date, else "13 Kasım". */
export const dayName = (s) => (s === null || s === BACKLOG ? 'Backlog' : s === addDays(todayIso(), 1) ? 'Yarın' : s === todayIso() ? 'Bugün' : fmtDate.format(parse(s)));
/** Where a task now lives, as a toast. */
export const movedText = (day) => (day === null ? 'Backlog’a taşındı.' : `${dayName(day)} gününe taşındı.`);

// ---------- projects ----------
/** A project select: "Projesiz" first, then the file's projects. */
export function fillProjectSelect(select, projects, value) {
  select.replaceChildren(el('option', { value: '', textContent: 'Projesiz' }),
    ...projects.map((p) => el('option', { value: p.name, textContent: p.name })));
  select.value = projects.some((p) => p.name === value) ? value : '';
}
export const projectColor = (projects, name) => projects.find((p) => p.name === name)?.color || 'sand';
export function projectTag(projects, name) {
  if (!name) return null;
  const tag = el('span', { className: 'tag', textContent: name });
  tag.dataset.color = projectColor(projects, name);
  return tag;
}

// ---------- status menu ----------
const menu = $('status-menu');
let menuAnchor = null;
export const menuOpen = () => !menu.hidden;
/** Opens the five statuses under `anchor`; `onPick(id)` runs for a different choice. */
export function openStatusMenu(current, anchor, onPick) {
  if (menuAnchor === anchor) { closeMenu(); return; }
  closeMenu();
  menuAnchor = anchor;
  const pick = (id) => { closeMenu(); anchor.focus(); if (id !== current) onPick(id); };
  menu.replaceChildren(...STATUSES.map((s, i) => {
    const b = el('button', { type: 'button' }, el('span', { className: 'micon', innerHTML: ICONS[s.id] }), s.label, el('span', { className: 'key', textContent: String(i + 1) }));
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(s.id === current));
    b.style.cssText = statusVars(s.id);
    b.addEventListener('click', () => pick(s.id));
    return b;
  }));
  menu.onkeydown = (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (/^[1-5]$/.test(e.key)) pick(STATUSES[Number(e.key) - 1].id);
  };
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${r.bottom + 4 + h < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px`;
  (menu.querySelector('[aria-checked="true"]') || menu.firstChild).focus();
}
export function closeMenu() { menu.hidden = true; menuAnchor = null; }
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[aria-haspopup="menu"]')) closeMenu();
}, true);
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

// ---------- toast ----------
let toastTimer = null;
export function toast(text, undo) {
  const t = $('toast');
  const hide = () => { t.hidden = true; };
  $('toast-text').textContent = text;
  const btn = $('toast-undo');
  btn.hidden = !undo;
  btn.onclick = undo ? () => { hide(); undo(); } : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, undo ? 6000 : 4000);
}

// ---------- drag to sort ----------
/**
 * Makes `li` draggable by its `.handle` within its own group. `onDrop(dragId, targetId, after)`
 * computes and saves the new order.
 */
let drag = null; // { id, group }
export function sortable(li, group, onDrop) {
  const handle = li.querySelector('.handle');
  handle.addEventListener('pointerdown', () => { li.draggable = true; });
  li.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    drag = { id: li.dataset.id, group };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.id);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  li.addEventListener('dragend', () => { li.draggable = false; li.classList.remove('dragging'); drag = null; clearMarks(); });
  li.addEventListener('dragover', (e) => {
    if (!drag || drag.group !== group || li.dataset.id === drag.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
    clearMarks();
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', (e) => {
    if (!drag || drag.group !== group || li.dataset.id === drag.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = li.classList.contains('drop-after');
    const id = drag.id;
    clearMarks();
    onDrop(id, li.dataset.id, after);
  });
}
const clearMarks = () => document.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
document.addEventListener('pointerup', () => { if (!drag) document.querySelectorAll('[draggable="true"]').forEach((n) => { n.draggable = false; }); });

/** The new id order after moving `id` next to `target`. */
export function moveId(ids, id, target, after) {
  const rest = ids.filter((x) => x !== id);
  rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, id);
  return rest;
}
