// The side panel: one task's page. Status, title, project, day, tags, subtasks, and the description
// that fills the rest of the panel and renders as you type (stored as Markdown).
import { URGENCIES, $, el, api, ICONS, statusOf, statusVars, openStatusMenu, menuOpen, toast, sortable, moveId, fillProjectSelect, addDays, todayIso, BACKLOG } from './shared.js';
import { createEditor } from './vendor/editor.js';
import { createTagInput } from './tags.js';

/**
 * deps.task(id) → the task in the page's state, deps.projects() → [{name, color}], deps.tags() → [string],
 * deps.changed(task) after any save, deps.removed(id) after a delete,
 * deps.moved(task, fromDay) after the task left the shown day.
 */
export function createPanel(deps) {
  const panel = $('panel');
  const scrim = $('scrim');
  const titleBox = $('p-title');
  const statusBtn = $('p-status');
  const project = $('p-project');
  const day = $('p-day');
  const subs = $('p-subs');
  const subInput = $('p-sub-input');
  const doc = $('p-doc');
  let id = null;
  let returnFocus = null;

  const task = () => (id ? deps.task(id) : null);
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };

  async function save(patch, taskId = id) {
    if (!taskId) return null;
    try {
      const updated = await api('POST', '/api/tasks/update', { id: taskId, ...patch });
      deps.changed(updated);
      return updated;
    } catch (err) {
      toast(err.message);
      if (taskId === id) fill();
      return null;
    }
  }
  async function saveSub(path, body) {
    const t = task();
    if (!t) return null;
    try {
      const updated = await api('POST', path, { taskId: t.id, ...body });
      deps.changed(updated);
      renderSubs();
      return updated;
    } catch (err) {
      toast(err.message);
      renderSubs();
      return null;
    }
  }

  // ---------- description: saved a moment after typing stops, and on close ----------
  let pending = null; // { taskId, markdown }
  let timer = null;
  const flushDescription = () => {
    clearTimeout(timer);
    if (!pending) return Promise.resolve();
    const { taskId, markdown } = pending;
    pending = null;
    const t = deps.task(taskId);
    if (t && (t.description || '') === markdown) return Promise.resolve();
    return save({ description: markdown }, taskId);
  };
  const editor = createEditor(doc, {
    placeholder: 'Yaz… “# ” başlık, “- ” madde, “[] ” kutu, “> ” alıntı, ``` kod',
    onChange: (markdown) => {
      if (!id) return;
      pending = { taskId: id, markdown };
      clearTimeout(timer);
      timer = setTimeout(flushDescription, 500);
    },
  });
  // A click on the empty page below the text puts the cursor at the end, like a document.
  $('p-doc-wrap').addEventListener('mousedown', (e) => {
    if (e.target === $('p-doc-wrap')) { e.preventDefault(); editor.focus('end'); }
  });

  // The window can close without the panel closing: save what is typed when it hides.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDescription(); });

  // ---------- tags ----------
  const tags = createTagInput($('p-tags'), {
    known: () => deps.tags(),
    onChange: (list) => save({ tags: list }),
  });

  // ---------- fill ----------
  function fill() {
    const t = task();
    if (!t) { close(); return; }
    if (document.activeElement !== titleBox) { titleBox.value = t.title; grow(titleBox); }
    const s = statusOf(t.status);
    statusBtn.style.cssText = statusVars(s.id);
    statusBtn.replaceChildren(el('span', { className: 'micon', innerHTML: ICONS[s.id] }), s.label, el('span', { className: 'caret', textContent: '▾' }));
    statusBtn.setAttribute('aria-label', `Durum: ${s.label}. Değiştir`);
    fillProjectSelect(project, deps.projects(), t.project);
    project.dataset.color = t.project ? (deps.projects().find((p) => p.name === t.project)?.color || 'sand') : '';
    const undated = t.day === null;
    day.value = undated ? '' : t.day;
    $('p-undated').setAttribute('aria-pressed', String(undated));
    const past = !undated && t.day < todayIso();
    $('p-tomorrow').textContent = undated || past ? 'Bugüne al' : t.day === todayIso() ? 'Yarına at' : 'Ertesi güne';
    $('p-tomorrow').hidden = t.status === 'done' && !undated;
    tags.set(t.tags || []);
    for (const b of $('p-urgency').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.urgency === (t.urgency || 'normal')));
    renderSubs();
  }

  function renderSubs() {
    const t = task();
    if (!t) return;
    const list = t.subtasks || [];
    const done = list.filter((s) => s.status === 'done').length;
    $('p-sub-count').textContent = list.length ? `${done}/${list.length}` : '';
    if (subs.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return; // keep a title being typed
    subs.replaceChildren(...list.map((s) => subRow(t, s)));
  }

  function subRow(t, s) {
    const li = el('li', { className: `sub${s.status === 'done' ? ' is-done' : ''}` });
    li.dataset.id = s.id;
    li.style.cssText = statusVars(s.status);
    const handle = el('button', { type: 'button', className: 'handle', textContent: '⋮⋮', title: 'Sürükle ya da Alt + ↑/↓' });
    handle.setAttribute('aria-label', `Sırala: ${s.title}`);
    handle.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const ids = t.subtasks.map((x) => x.id);
      const i = ids.indexOf(s.id);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= ids.length) return;
      saveSub('/api/subtasks/reorder', { ids: moveId(ids, s.id, ids[j], j > i) }).then(() => subs.querySelector(`[data-id="${s.id}"] .handle`)?.focus());
    });
    const circle = el('button', { type: 'button', className: 'circle small', innerHTML: ICONS[statusOf(s.status).id] });
    circle.setAttribute('aria-haspopup', 'menu');
    circle.setAttribute('aria-label', `Durum: ${statusOf(s.status).label}. Değiştir`);
    circle.title = statusOf(s.status).label;
    circle.addEventListener('click', () => openStatusMenu(s.status, circle, (status) => saveSub('/api/subtasks/update', { id: s.id, status })));
    const title = el('textarea', { className: 'sub-title', rows: 1, value: s.title, maxLength: 300 });
    title.setAttribute('aria-label', 'Alt görev');
    title.addEventListener('input', () => grow(title));
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); title.value = s.title; title.blur(); }
    });
    title.addEventListener('blur', () => {
      const v = title.value.trim();
      if (!v) { title.value = s.title; grow(title); return; }
      if (v !== s.title) saveSub('/api/subtasks/update', { id: s.id, title: v });
    });
    const del = el('button', { type: 'button', className: 'act icon del', textContent: '✕', title: 'Alt görevi sil' });
    del.setAttribute('aria-label', `Sil: ${s.title}`);
    del.addEventListener('click', () => {
      if (confirm(`“${s.title}” alt görevi silinsin mi?`)) saveSub('/api/subtasks/delete', { id: s.id });
    });
    li.append(handle, circle, title, del);
    sortable(li, `subs:${t.id}`, (dragId, target, after) =>
      saveSub('/api/subtasks/reorder', { ids: moveId(t.subtasks.map((x) => x.id), dragId, target, after) }));
    requestAnimationFrame(() => grow(title));
    return li;
  }

  // ---------- open / close ----------
  function open(taskId, from) {
    if (id && id !== taskId) commit();
    id = taskId;
    returnFocus = from || null;
    fill();
    editor.setMarkdown(task().description || '');
    scrim.hidden = false;
    panel.hidden = false;
    grow(titleBox); // measured once the panel is laid out
    panel.scrollTop = 0;
    void panel.offsetWidth; // one reflow so the slide-in animates; no rAF, which a hidden window never runs
    panel.classList.add('open');
    scrim.classList.add('open');
    panel.setAttribute('aria-label', task().title);
    titleBox.focus();
    titleBox.setSelectionRange(titleBox.value.length, titleBox.value.length);
  }
  /** Saves what is typed but not yet saved (title, description). */
  function commit() {
    const t = task();
    if (!t) return;
    tags.flush();
    const v = titleBox.value.trim();
    if (v && v !== t.title) save({ title: v });
    flushDescription();
  }
  function close() {
    if (!id) return;
    commit();
    id = null;
    tags.closeSuggestions();
    panel.classList.remove('open');
    scrim.classList.remove('open');
    setTimeout(() => { if (!id) { panel.hidden = true; scrim.hidden = true; } }, 200);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  // ---------- wiring ----------
  scrim.addEventListener('click', close);
  $('p-close').addEventListener('click', close);
  // Esc closes the panel unless something inside used it first (a menu, a suggestion list, a field reset).
  document.addEventListener('keydown', (e) => {
    // The editor consumes Esc itself (preventDefault) but has no use for it here: it closes the panel too.
    if (e.key === 'Escape' && !e.isComposing && id && !menuOpen() && (!e.defaultPrevented || doc.contains(e.target))) close();
  });
  titleBox.addEventListener('input', () => grow(titleBox));
  titleBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleBox.blur(); } });
  titleBox.addEventListener('blur', () => {
    const t = task();
    if (!t) return;
    const v = titleBox.value.trim();
    if (!v) { titleBox.value = t.title; grow(titleBox); return; }
    if (v !== t.title) save({ title: v });
  });
  statusBtn.addEventListener('click', () => {
    const t = task();
    if (t) openStatusMenu(t.status, statusBtn, (status) => save({ status }).then(fill));
  });
  // Urgency: four levels, one click each.
  $('p-urgency').replaceChildren(...URGENCIES.map((u) => {
    const b = el('button', { type: 'button', className: 'u-pick' }, el('span', { className: 'u-flag' }), u.label);
    b.dataset.urgency = u.id;
    b.addEventListener('click', () => { const t = task(); if (t && (t.urgency || 'normal') !== u.id) save({ urgency: u.id }).then(fill); });
    return b;
  }));
  project.addEventListener('change', () => save({ project: project.value }).then(fill));
  day.addEventListener('change', () => { if (day.value) moveTo(day.value); });
  $('p-tomorrow').addEventListener('click', () => { const t = task(); if (t) moveTo(t.day === null || t.day < todayIso() ? todayIso() : addDays(t.day, 1)); });
  // "Tarihsiz": the task goes to the backlog; pressed again on an undated task it takes today.
  $('p-undated').addEventListener('click', () => { const t = task(); if (t) moveTo(t.day === null ? todayIso() : BACKLOG); });
  async function moveTo(target) {
    const t = task();
    if (!t || !target || target === t.day) return;
    await flushDescription();
    const from = t.day;
    const updated = await save({ day: target }, t.id);
    if (updated) deps.moved(updated, from);
  }

  $('p-sub-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = subInput.value.trim();
    if (!v) return;
    subInput.value = '';
    await saveSub('/api/subtasks', { title: v });
    subInput.focus();
  });

  $('p-delete').addEventListener('click', async () => {
    const t = task();
    if (!t || !confirm(`“${t.title}” silinsin mi? Alt görevleri ve açıklaması da gider. Bu geri alınamaz.`)) return;
    try {
      await api('POST', '/api/tasks/delete', { id: t.id });
      clearTimeout(timer);
      pending = null;
      id = null;
      panel.classList.remove('open');
      scrim.classList.remove('open');
      panel.hidden = true;
      scrim.hidden = true;
      deps.removed(t.id);
    } catch (err) {
      toast(err.message);
    }
  });

  return {
    open,
    close,
    refresh: () => { if (id) fill(); },
    get openId() { return id; },
  };
}
