// Small shared UI helpers.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._id);
  toast._id = setTimeout(() => { t.hidden = true; }, 3200);
}

export function scoreClass(v, target = 75) {
  if (v == null) return '';
  return v >= target ? 'good' : v >= target - 20 ? 'warn' : 'bad';
}

export function scoreChip(label, v, target) {
  const cls = scoreClass(v, target);
  const icon = cls === 'good' ? '✓' : cls === 'warn' ? '!' : cls === 'bad' ? '✕' : '';
  return `<div class="score ${cls}"><span class="score-v">${v ?? '–'}</span><span class="score-l">${icon ? `<i>${icon}</i>` : ''}${label}</span></div>`;
}

export const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;

// Segmented sub-navigation for a tab, driven by the hash (#tab/sub).
export function subnav(tab, items, current) {
  return `<nav class="subnav" style="--n:${items.length}">${items.map(([k, label]) => `<a href="#${tab}/${k}" class="${k === current ? 'on' : ''}" ${k === current ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

// Page header: eyebrow line, title, optional sub-navigation.
export function pageHead(title, { eyebrow = '', nav = '' } = {}) {
  return `<header class="page-head">${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${esc(title)}</h1>${nav}</header>`;
}

export function subOf(defaultSub) {
  return location.hash.split('/')[1] || defaultSub;
}

export function deltaHTML(d) {
  if (d == null || d === 0) return '';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}</span>`;
}

export function confDot(c) {
  const label = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence', none: 'no evidence yet' }[c];
  return `<span class="conf ${c}" title="${label}" aria-label="${label}"></span>`;
}
