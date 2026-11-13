// A free tag field: chips plus a text input that suggests tags used before. No groups, no colours.
import { el } from './shared.js';

const lower = (s) => s.toLocaleLowerCase('tr');

/**
 * createTagInput(host, { known() → [string], onChange(list) }) → { set(list), flush(), closeSuggestions() }
 * Enter or comma adds (the highlighted suggestion, else the typed text); ✕ removes;
 * Backspace on an empty input removes the last tag; Esc closes the suggestions.
 */
export function createTagInput(host, { known, onChange }) {
  let tags = [];
  let active = -1;
  let shown = [];
  const chips = el('span', { className: 'tag-chips' });
  const input = el('input', { className: 'tag-input', maxLength: 30, placeholder: 'Etiket ekle' });
  input.setAttribute('aria-label', 'Etiket ekle');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const list = el('ul', { className: 'tag-suggest', id: `${host.id}-list` });
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  host.append(chips, input, list);
  host.addEventListener('mousedown', (e) => { if (e.target === host || e.target === chips) { e.preventDefault(); input.focus(); } });

  function renderChips() {
    chips.replaceChildren(...tags.map((tag) => {
      const x = el('button', { type: 'button', className: 'tag-x', textContent: '✕' });
      x.setAttribute('aria-label', `Etiketi çıkar: ${tag}`);
      x.addEventListener('click', () => commit(tags.filter((t) => t !== tag)));
      return el('span', { className: 'tchip' }, el('span', { textContent: `#${tag}` }), x);
    }));
    input.placeholder = tags.length ? '' : 'Etiket ekle';
  }

  function commit(next) {
    tags = next;
    renderChips();
    onChange(tags);
  }

  function add(raw) {
    const tag = raw.replace(/\s+/g, ' ').trim().replace(/^#/, '');
    input.value = '';
    closeSuggestions();
    if (!tag || tags.some((t) => lower(t) === lower(tag))) return;
    const spelled = known().find((t) => lower(t) === lower(tag)) || tag;
    commit([...tags, spelled]);
  }

  function suggest() {
    const q = lower(input.value.trim().replace(/^#/, ''));
    const pool = known().filter((t) => !tags.some((x) => lower(x) === lower(t)));
    shown = (q ? pool.filter((t) => lower(t).includes(q)).sort((a, b) => lower(b).startsWith(q) - lower(a).startsWith(q)) : pool).slice(0, 8);
    active = q && shown.length ? 0 : -1;
    if (!shown.length || document.activeElement !== input) { closeSuggestions(); return; }
    list.replaceChildren(...shown.map((t, i) => {
      const li = el('li', { textContent: `#${t}`, id: `${list.id}-${i}` });
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); add(t); input.focus(); });
      return li;
    }));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? `${list.id}-${active}` : '');
  }
  function highlight(i) {
    active = (i + shown.length) % shown.length;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === active)));
    input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
  }
  function closeSuggestions() {
    list.hidden = true;
    shown = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  input.addEventListener('input', () => {
    if (input.value.includes(',')) { input.value.split(',').forEach((part, i, all) => { if (i < all.length - 1) add(part); else input.value = part; }); }
    suggest();
  });
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); closeSuggestions(); });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); add(active >= 0 ? shown[active] : input.value); suggest(); }
    else if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); closeSuggestions(); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { e.preventDefault(); commit(tags.slice(0, -1)); }
  });

  return {
    set(next) { tags = [...next]; renderChips(); },
    /** Adds what is typed but not yet added (the panel calls this before it closes). */
    flush() { if (input.value.trim()) add(input.value); },
    closeSuggestions,
  };
}
