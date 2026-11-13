// Günlük: the day list. Only the user changes anything here; every change goes to the backend first.
import { dc } from '/__dc/sdk.js';
import {
  STATUSES, ICONS, statusOf, statusVars, $, el, api, parse, addDays, todayIso, fmtDate, fmtYear, fmtWeekday, fmtShort,
  weekStart, dayName, movedText, BACKLOG, URGENCIES, urgencyRank, urgencyLabel, byUrgency, urgencyFromTitle, fillProjectSelect, projectColor, projectTag, openStatusMenu, menuOpen, toast, sortable, moveId,
} from './shared.js';
import { createPanel } from './panel.js';

// ---------- state ----------
const saved = JSON.parse(localStorage.getItem('gunluk.filters') || '{}');
const state = {
  day: todayIso(),
  tasks: [],
  projects: [],
  tags: [],
  backlog: 0,
  carry: [], // unfinished tasks from earlier days, shown on today's tab only (never moved by the app)
  carryOpen: saved.carryOpen !== false,
  addUrgency: 'normal', // the quick-add level; back to Normal after each add
  counts: {},
  load: 'loading', // loading | ready | error
  project: typeof saved.project === 'string' ? saved.project : '', // '' all, '—' no project, else a name
  status: typeof saved.status === 'string' ? saved.status : '',
  addProject: typeof saved.addProject === 'string' ? saved.addProject : '',
};
/** The day the strip shows: the chosen day, or today while the backlog is open. */
const stripDay = () => (state.day === BACKLOG ? todayIso() : state.day);
/** Does a task with this day (null = backlog) belong to the list on screen? */
const sameView = (day) => (state.day === BACKLOG ? day === null : day === state.day);
const saveFilters = () => localStorage.setItem('gunluk.filters', JSON.stringify({ project: state.project, status: state.status, addProject: state.addProject, carryOpen: state.carryOpen }));
const isToday = () => state.day === todayIso();
/** Left over: dated before today and not done, while today's tab is open. */
const isCarry = (t) => isToday() && t.day !== null && t.day < state.day && t.status !== 'done';
const byDay = (a, b) => (urgencyRank(a) - urgencyRank(b)) || (a.day === b.day ? a.order - b.order : a.day < b.day ? -1 : 1);
/** One place that puts a saved task where it now belongs: the day list, the carry-over list, or neither. */
function applyUpdate(u) {
  // state.tasks is kept in screen order: urgency, then the order the user gave.
  if (sameView(u.day)) state.tasks = byUrgency(state.tasks.some((t) => t.id === u.id) ? state.tasks.map((t) => (t.id === u.id ? u : t)) : [...state.tasks, u]);
  else state.tasks = state.tasks.filter((t) => t.id !== u.id);
  if (isCarry(u)) state.carry = (state.carry.some((t) => t.id === u.id) ? state.carry.map((t) => (t.id === u.id ? u : t)) : [...state.carry, u]).sort(byDay);
  else state.carry = state.carry.filter((t) => t.id !== u.id);
}

const panel = createPanel({
  task: (id) => state.tasks.find((t) => t.id === id) || state.carry.find((t) => t.id === id),
  projects: () => state.projects,
  tags: () => state.tags,
  changed: (updated) => {
    applyUpdate(updated);
    for (const tag of updated.tags || []) if (!state.tags.includes(tag)) state.tags.push(tag);
    refreshCounts();
    renderDay();
    renderFilters();
    renderList();
  },
  removed: (id) => { state.tasks = state.tasks.filter((t) => t.id !== id); state.carry = state.carry.filter((t) => t.id !== id); refreshCounts(); render(); },
  moved: (updated, from) => {
    panel.close();
    applyUpdate(updated);
    render();
    toast(movedText(updated.day), () => change(updated.id, { day: from ?? BACKLOG }).then(load));
  },
});

// ---------- backend ----------
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  if (state.load !== 'ready') { state.load = 'loading'; render(); }
  try {
    const from = weekStart(stripDay());
    const [day, counts, carry] = await Promise.all([
      api('GET', `/api/day?date=${state.day}`),
      api('GET', `/api/counts?from=${from}&to=${addDays(from, 6)}`),
      isToday() ? api('GET', `/api/carryover?today=${state.day}`) : Promise.resolve({ tasks: [] }),
    ]);
    if (seq !== loadSeq) return;
    state.tasks = day.tasks;
    state.carry = carry.tasks;
    state.backlog = day.backlog;
    state.projects = day.projects;
    state.tags = day.tags || [];
    state.counts = counts;
    state.load = 'ready';
    // A filter on a project that left the file falls back to all.
    if (state.project && state.project !== '—' && !state.projects.some((p) => p.name === state.project)) { state.project = ''; saveFilters(); }
  } catch {
    if (seq !== loadSeq) return;
    state.load = 'error';
  }
  render();
  panel.refresh();
}

async function refreshCounts() {
  const from = weekStart(stripDay());
  try { state.counts = await api('GET', `/api/counts?from=${from}&to=${addDays(from, 6)}`); state.backlog = state.counts.backlog; renderDay(); } catch { /* the strip keeps its last dots */ }
}

function goTo(day) {
  if (!day || day === state.day) return;
  panel.close();
  state.day = day;
  state.load = 'loading';
  load();
}

async function change(id, patch) {
  try {
    const updated = await api('POST', '/api/tasks/update', { id, ...patch });
    applyUpdate(updated);
    refreshCounts();
    render();
    panel.refresh();
    return updated;
  } catch (err) {
    toast(err.message);
    load();
    return null;
  }
}

async function saveOrder(ids) {
  const before = state.tasks;
  // The server stores order = position; keep the same numbers here so both sort alike.
  state.tasks = ids.map((id, i) => ({ ...before.find((t) => t.id === id), order: i }));
  renderList();
  try {
    await api('POST', '/api/tasks/reorder', { day: state.day, ids });
  } catch (err) {
    state.tasks = before;
    toast(err.message);
    load();
  }
}

// ---------- render ----------
function render() {
  renderDay();
  renderFilters();
  renderList();
}

function renderDay() {
  const today = todayIso();
  const backlog = state.day === BACKLOG;
  if (backlog) {
    $('title-date').textContent = 'Backlog';
    $('title-weekday').textContent = 'Tarihsiz';
  } else {
    const d = parse(state.day);
    $('title-date').textContent = (d.getFullYear() === new Date().getFullYear() ? fmtDate : fmtYear).format(d);
    $('title-weekday').textContent = state.day === today ? 'Bugün' : state.day === addDays(today, 1) ? 'Yarın' : state.day === addDays(today, -1) ? 'Dün' : fmtWeekday.format(d);
  }
  $('date').value = backlog ? '' : state.day;
  $('today').disabled = state.day === today;
  const tab = $('backlog-tab');
  tab.setAttribute('aria-pressed', String(backlog));
  $('backlog-count').textContent = String(state.backlog ?? state.counts.backlog ?? 0);
  $('add-title').placeholder = backlog ? 'Backlog’a ne eklensin?' : 'Bugün ne yapacaksın?';

  const week = $('week');
  week.replaceChildren();
  const start = weekStart(stripDay());
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const c = state.counts[day] || { open: 0, done: 0 };
    const dots = el('span', { className: 'dots' });
    for (let k = 0; k < Math.min(c.open, 3); k++) dots.append(el('span', { className: 'dot' }));
    if (c.open === 0 && c.done > 0) dots.append(el('span', { className: 'dot done' }));
    const btn = el('button', { type: 'button', className: [day === today && 'is-today', day === state.day && 'is-selected'].filter(Boolean).join(' ') },
      el('span', { className: 'wd', textContent: fmtShort.format(parse(day)) }),
      el('span', { className: 'dn', textContent: String(parse(day).getDate()) }),
      dots);
    btn.setAttribute('aria-label', `${fmtYear.format(parse(day))}, ${c.open} açık, ${c.done} biten görev`);
    if (day === state.day) btn.setAttribute('aria-current', 'date');
    btn.addEventListener('click', () => goTo(day));
    week.append(el('li', {}, btn));
  }

  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.status === 'done').length;
  $('progress').hidden = state.load !== 'ready' || total === 0;
  $('progress-fill').style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
  $('progress-text').textContent = done === total && total > 0 ? `${total} görevin hepsi bitti 🎉` : `${total} görevden ${done} tanesi bitti`;
}

function renderFilters() {
  const chips = $('projects');
  chips.replaceChildren();
  const chip = (value, label, n, color) => {
    const b = el('button', { type: 'button', className: 'chip' },
      color ? el('span', { className: 'pdot' }) : null, label, el('span', { className: 'n', textContent: String(n) }));
    if (color) b.dataset.color = color;
    b.classList.toggle('is-zero', n === 0 && state.project !== value);
    b.setAttribute('aria-pressed', String(state.project === value));
    b.addEventListener('click', () => {
      state.project = value;
      if (value && value !== '—') state.addProject = value;
      saveFilters();
      renderAddProject();
      render();
    });
    return b;
  };
  chips.append(chip('', 'Tümü', state.tasks.length));
  for (const p of state.projects) chips.append(chip(p.name, p.name, state.tasks.filter((t) => t.project === p.name).length, p.color));
  chips.append(chip('—', 'Projesiz', state.tasks.filter((t) => !t.project).length));

  const sel = $('status-filter');
  sel.replaceChildren(el('option', { value: '', textContent: 'Tüm durumlar' }),
    ...STATUSES.map((s) => el('option', { value: s.id, textContent: `${s.label} (${state.tasks.filter((t) => t.status === s.id).length})` })));
  sel.value = state.status;
  sel.classList.toggle('is-set', !!state.status);
  renderAddProject();
}

function renderAddProject() {
  const sel = $('add-project');
  fillProjectSelect(sel, state.projects, state.addProject);
  sel.dataset.color = sel.value ? projectColor(state.projects, sel.value) : '';
}

const filtered = (tasks) => tasks.filter((t) =>
  (!state.project || (state.project === '—' ? !t.project : t.project === state.project)) &&
  (!state.status || t.status === state.status));
const visible = () => filtered(state.tasks);

const shortDay = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
/** "Per 12 Kas": the day a carried-over task was left on. */
const leftOn = (day) => `${fmtShort.format(parse(day))} ${shortDay.format(parse(day))}`;

function renderCarry() {
  const box = $('carry');
  const rows = state.load === 'ready' && isToday() ? filtered(state.carry) : [];
  box.hidden = rows.length === 0;
  if (box.hidden) { $('carry-list').replaceChildren(); return; }
  const toggle = $('carry-toggle');
  toggle.setAttribute('aria-expanded', String(state.carryOpen));
  $('carry-count').textContent = String(rows.length);
  $('carry-all').textContent = rows.length < state.carry.length ? 'Görünenleri bugüne al' : 'Hepsini bugüne al';
  $('carry-list').hidden = !state.carryOpen;
  $('carry-list').replaceChildren();
  appendGrouped($('carry-list'), rows, { carry: true });
}

let takingAll = false;
async function takeAllToday() {
  if (takingAll) return;
  takingAll = true;
  $('carry-all').disabled = true;
  const rows = filtered(state.carry);
  const moved = [];
  for (const t of rows) {
    const u = await change(t.id, { day: state.day });
    if (!u) break;
    moved.push({ id: t.id, from: t.day });
  }
  takingAll = false;
  $('carry-all').disabled = false;
  if (moved.length === rows.length) toast(`${moved.length} görev bugüne alındı.`, async () => { for (const m of moved) await change(m.id, { day: m.from }); load(); });
}

function renderList() {
  renderCarry();
  const list = $('list');
  const box = $('state');
  list.replaceChildren();
  box.hidden = true;

  if (state.load === 'loading') {
    box.hidden = false;
    box.replaceChildren(el('span', { textContent: 'Yükleniyor…' }));
    return;
  }
  if (state.load === 'error') {
    box.hidden = false;
    const retry = el('button', { type: 'button', className: 'quiet', textContent: 'Tekrar dene' });
    retry.addEventListener('click', load);
    box.replaceChildren(el('strong', { textContent: 'Görevler yüklenemedi.' }), el('span', { textContent: 'Uygulamanın arka tarafına ulaşılamadı.' }), el('br'), retry);
    return;
  }
  if (state.tasks.length === 0) {
    box.hidden = false;
    box.replaceChildren(
      el('span', { className: 'big', textContent: '🌱' }),
      el('strong', { textContent: state.day === BACKLOG ? 'Backlog boş.' : state.day === todayIso() ? 'Bugün henüz boş.' : 'Bu gün boş.' }),
      el('span', { textContent: 'Yukarıdaki satıra yaz, Enter’a bas.' }));
    return;
  }
  const rows = byUrgency(visible());
  if (rows.length === 0) {
    box.hidden = false;
    const clear = el('button', { type: 'button', className: 'quiet', textContent: 'Filtreyi temizle' });
    clear.addEventListener('click', () => { state.project = ''; state.status = ''; saveFilters(); render(); });
    box.replaceChildren(el('strong', { textContent: 'Bu filtrede görev yok.' }), el('span', { textContent: `Bu günde ${state.tasks.length} görev var, filtre hepsini gizliyor.` }), el('br'), clear);
    return;
  }
  appendGrouped(list, rows, {});
}

/** Rows grouped by urgency, a thin heading per level, only when more than one level is present. */
function appendGrouped(list, rows, opts) {
  const levels = new Set(rows.map((t) => t.urgency || 'normal'));
  let last = null;
  for (const t of rows) {
    const u = t.urgency || 'normal';
    if (levels.size > 1 && u !== last) {
      const n = rows.filter((x) => (x.urgency || 'normal') === u).length;
      const head = el('li', { className: 'u-head' }, el('span', { className: 'u-flag' }), urgencyLabel(u), el('span', { className: 'n', textContent: String(n) }));
      head.dataset.urgency = u;
      head.setAttribute('role', 'presentation');
      list.append(head);
    }
    last = u;
    list.append(row(t, opts));
  }
}

function row(t, { carry = false } = {}) {
  const s = statusOf(t.status);
  const li = el('li', { className: `task${t.status === 'done' ? ' is-done' : ''}${panel.openId === t.id ? ' is-open' : ''}` });
  li.dataset.id = t.id;
  li.dataset.urgency = t.urgency || 'normal';
  li.style.cssText = statusVars(s.id);

  const handle = el('button', { type: 'button', className: 'handle', textContent: '⋮⋮', title: 'Sürükle ya da Alt + ↑/↓' });
  handle.setAttribute('aria-label', `Sırala: ${t.title}`);
  handle.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    moveBy(t.id, e.key === 'ArrowUp' ? -1 : 1);
  });

  const circle = el('button', { type: 'button', className: 'circle', innerHTML: ICONS[s.id] });
  circle.setAttribute('aria-haspopup', 'menu');
  circle.setAttribute('aria-label', `Durum: ${s.label}. Değiştir`);
  circle.title = `${s.label} · değiştirmek için tıkla`;
  circle.addEventListener('click', () => openStatusMenu(t.status, circle, (status) => change(t.id, { status })));

  const title = el('button', { type: 'button', className: 't-title', textContent: t.title, title: 'Detayı aç' });
  title.addEventListener('click', () => panel.open(t.id, title));
  const subs = t.subtasks || [];
  const subDone = subs.filter((x) => x.status === 'done').length;
  const sub = subs.length ? el('span', { className: `subcount${subDone === subs.length ? ' all' : ''}`, textContent: `${subDone}/${subs.length}`, title: `${subs.length} alt görevden ${subDone} tanesi bitti` }) : null;
  const note = t.description?.trim() ? el('span', { className: 'note', textContent: '¶', title: 'Açıklaması var' }) : null;
  const main = el('div', { className: 't-main' }, title, ' ',
    t.status !== 'not_started' && t.status !== 'done' ? el('span', { className: 'label', textContent: s.label }) : null, ' ',
    t.urgency && t.urgency !== 'normal' ? el('span', { className: 'u-sr sr', textContent: `Aciliyet: ${urgencyLabel(t.urgency)}` }) : null,
    carry ? el('span', { className: 'leftover', textContent: leftOn(t.day), title: `${fmtYear.format(parse(t.day))} gününden kaldı` }) : null, carry ? ' ' : null,
    sub, ' ', note, ' ', projectTag(state.projects, t.project), ' ',
    ...(t.tags || []).flatMap((tag) => [el('span', { className: 'htag', textContent: `#${tag}` }), ' ']));

  const actions = el('div', { className: 't-actions' });
  const moveBtn = (label, target) => {
    const b = el('button', { type: 'button', className: 'act move', textContent: label });
    b.addEventListener('click', async () => {
      const from = t.day ?? BACKLOG;
      const moved = await change(t.id, { day: target });
      if (moved) toast(movedText(moved.day), () => change(t.id, { day: from }).then(load));
    });
    return b;
  };
  if (state.day === BACKLOG || carry) {
    actions.append(moveBtn('Bugüne al', todayIso()));
    if (carry) actions.append(moveBtn('Backlog’a at', BACKLOG));
  } else {
    if (t.status !== 'done') actions.append(moveBtn(state.day === todayIso() ? 'Yarına at' : 'Ertesi güne', addDays(state.day, 1)));
    actions.append(moveBtn('Backlog’a at', BACKLOG));
  }

  if (carry) { li.append(circle, main, actions); return li; } // ordered by day; it is not this list's to sort
  li.append(handle, circle, main, actions);
  sortable(li, 'tasks', (dragId, target, after) => dropOn(dragId, target, after));
  return li;
}

/** A drop: inside its urgency it only reorders; onto a row of another urgency it takes that urgency too. */
async function dropOn(dragId, targetId, after) {
  const dragged = state.tasks.find((t) => t.id === dragId);
  const target = state.tasks.find((t) => t.id === targetId);
  if (!dragged || !target) return;
  if ((dragged.urgency || 'normal') !== (target.urgency || 'normal')) {
    const u = await change(dragId, { urgency: target.urgency || 'normal' });
    if (!u) return;
  }
  await saveOrder(moveId(state.tasks.map((t) => t.id), dragId, targetId, after));
}

function moveBy(id, delta) {
  // Moves within what is on screen: past the next visible neighbour, hidden ones stay put.
  const shown = byUrgency(visible()).map((t) => t.id);
  const target = shown[shown.indexOf(id) + delta];
  if (!target) return;
  dropOn(id, target, delta > 0).then(() => document.querySelector(`.task[data-id="${id}"] .handle`)?.focus());
}

// ---------- add ----------
let adding = false;
$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titleInput = $('add-title');
  const parsed = urgencyFromTitle(titleInput.value);
  const title = parsed.title.trim();
  const urgency = parsed.urgency || state.addUrgency;
  const err = $('add-error');
  err.hidden = true;
  if (!title || adding) { titleInput.focus(); return; }
  adding = true;
  try {
    const task = await api('POST', '/api/tasks', { day: state.day, title, project: $('add-project').value, urgency });
    applyUpdate(task);
    state.addUrgency = 'normal';
    renderAddUrgency();
    // A new task hidden by a filter would look lost: show it.
    if (state.status && state.status !== task.status) state.status = '';
    if (state.project && (state.project === '—' ? task.project : task.project !== state.project)) state.project = '';
    saveFilters();
    titleInput.value = '';
    refreshCounts();
    render();
    titleInput.focus();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    adding = false;
  }
});
/** The quick-add urgency button: one click steps Normal → Yüksek → Acil → Düşük → Normal. */
const CYCLE = ['normal', 'high', 'urgent', 'low'];
function renderAddUrgency() {
  const b = $('add-urgency');
  b.dataset.urgency = state.addUrgency;
  b.querySelector('.u-text').textContent = urgencyLabel(state.addUrgency);
  b.setAttribute('aria-label', `Aciliyet: ${urgencyLabel(state.addUrgency)}. Değiştirmek için tıkla`);
}
$('add-urgency').addEventListener('click', () => {
  state.addUrgency = CYCLE[(CYCLE.indexOf(state.addUrgency) + 1) % CYCLE.length];
  renderAddUrgency();
});
renderAddUrgency();
$('add-project').addEventListener('change', (e) => { state.addProject = e.target.value; saveFilters(); renderAddProject(); });

// ---------- day navigation ----------
$('prev').addEventListener('click', () => goTo(addDays(stripDay(), -1)));
$('next').addEventListener('click', () => goTo(addDays(stripDay(), 1)));
$('backlog-tab').addEventListener('click', () => goTo(BACKLOG));
$('carry-toggle').addEventListener('click', () => { state.carryOpen = !state.carryOpen; saveFilters(); renderCarry(); });
$('carry-all').addEventListener('click', takeAllToday);
$('today').addEventListener('click', () => goTo(todayIso()));
$('date').addEventListener('change', (e) => goTo(e.target.value));
$('status-filter').addEventListener('change', (e) => { state.status = e.target.value; saveFilters(); render(); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || menuOpen() || panel.openId) return;
  if (e.key === 'ArrowLeft' && !e.altKey) goTo(addDays(stripDay(), -1));
  if (e.key === 'ArrowRight' && !e.altKey) goTo(addDays(stripDay(), 1));
  if (e.key === 'n') { e.preventDefault(); $('add-title').focus(); }
});

// Follow dreamcontext's light/dark.
function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
try { applyTheme(await dc.theme()); } catch { applyTheme('system'); }
window.addEventListener('dc-theme', (e) => applyTheme(e.detail?.theme ?? e.detail));

load();
