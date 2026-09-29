// Train → Combos: build your own combinations, see how often you throw them, and drill them.
import {
  PUNCH_WORDS, DEFENSE, STARTERS, isPunch, parseCombo, comboText, comboLabel, comboSpeech, comboHistory, spottedCombos,
} from '../combos.js';
import * as audio from '../audio.js';
import { $, $$, esc, shortDate, toast } from '../ui.js';
import { newId } from '../store.js';

let building = [];
let bodyNext = false;

export function comboHTML(tokens) {
  return `<span class="cmb">${tokens.map((t) => (isPunch(t)
    ? `<span class="cp${t.endsWith('b') ? ' body' : ''}" title="${PUNCH_WORDS[t[0]]}${t.endsWith('b') ? ' to the body' : ''}">${t[0]}${t.endsWith('b') ? '<i>body</i>' : ''}</span>`
    : `<span class="cd">${esc(t)}</span>`)).join('')}</span>`;
}

export function renderCombos(el, app) {
  const state = app.state;
  const combos = state.combos;
  const spotted = spottedCombos(state.sessions, combos);
  el.innerHTML = `
    <section class="card form">
      <h2>Build a combo</h2>
      <div class="cb-display" id="cbDisplay"></div>
      <div class="cb-keys">${Object.entries(PUNCH_WORDS).map(([d, w]) => `<button type="button" data-p="${d}"><b>${d}</b><span>${w}</span></button>`).join('')}</div>
      <div class="chipset">
        <button type="button" class="chip" id="cbBody" aria-pressed="false">Next punch to the body</button>
        ${DEFENSE.map((d) => `<button type="button" class="chip" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}
      </div>
      <div class="row2"><button type="button" class="btn ghost sm" id="cbUndo">Undo</button><button type="button" class="btn ghost sm" id="cbClear">Clear</button></div>
      <label>Name (optional)<input id="cbName" maxlength="40" placeholder="e.g. Pad round finisher"></label>
      <div class="row2"><button type="button" class="btn ghost" id="cbHear">🔊 Hear it</button><button type="button" class="btn primary" id="cbSave">Save combo</button></div>
      <details class="cb-type"><summary class="small muted">Or type it</summary>
        <input id="cbText" placeholder="e.g. 1-3(body)-2 roll 2" autocapitalize="off" autocomplete="off">
      </details>
    </section>

    <section class="card">
      <div class="card-head"><h2>My combos</h2>${combos.length ? '<button class="linkbtn" id="drillAll">Drill all →</button>' : ''}</div>
      ${combos.length ? `<ul class="rows">${combos.map((c) => comboRow(c, state)).join('')}</ul>
        <p class="muted small">Counted automatically from camera sessions and analysed videos. Body shots count as the punch itself: the camera can't tell head from body yet.</p>`
        : '<p class="muted small">Build one above or tap a quick add below. Then drill it: the coach calls it out, and with the camera on it checks whether you threw it.</p>'}
    </section>

    ${spotted.length ? `<section class="card">
      <h2>Spotted in your training</h2>
      <p class="muted small">Combos you threw a lot on camera in the last 30 days.</p>
      <ul class="rows">${spotted.map((s, i) => `<li>${comboHTML(s.tokens)}<span class="grow muted small">×${s.n}</span><button class="btn sm ghost" data-spot="${i}">Save</button></li>`).join('')}</ul>
    </section>` : ''}

    <section class="card">
      <h2>Quick add</h2>
      <div class="chipset">${STARTERS.map((s, i) => `<button class="chip" data-start="${i}">${esc(comboLabel(parseCombo(s)))}</button>`).join('')}</div>
    </section>`;

  const show = () => {
    $('#cbDisplay', el).innerHTML = building.length ? comboHTML(building) : '<span class="muted">Tap punches and moves below</span>';
    $('#cbBody', el).setAttribute('aria-pressed', String(bodyNext));
    $('#cbBody', el).classList.toggle('on', bodyNext);
  };
  const push = (t) => {
    if (building.length >= 24) return toast('That is a long one: 24 moves max.');
    building.push(t);
    show();
  };
  $$('[data-p]', el).forEach((b) => b.addEventListener('click', () => {
    push(b.dataset.p + (bodyNext ? 'b' : ''));
    bodyNext = false;
    show();
  }));
  $$('[data-d]', el).forEach((b) => b.addEventListener('click', () => push(b.dataset.d)));
  $('#cbBody', el).addEventListener('click', () => { bodyNext = !bodyNext; show(); });
  $('#cbUndo', el).addEventListener('click', () => { building.pop(); show(); });
  $('#cbClear', el).addEventListener('click', () => { building = []; bodyNext = false; show(); });
  $('#cbHear', el).addEventListener('click', () => {
    if (!building.length) return;
    audio.setVoice(true);
    audio.say(comboSpeech(building), { interrupt: true, rate: 1.2 });
  });
  $('#cbText', el).addEventListener('input', (e) => {
    const t = parseCombo(e.target.value);
    if (t) { building = t; show(); }
  });
  $('#cbSave', el).addEventListener('click', () => {
    if (!building.some(isPunch)) return toast('Add at least one punch.');
    if (save(app, building, $('#cbName', el).value.trim())) { building = []; bodyNext = false; }
  });
  $$('[data-start]', el).forEach((b) => b.addEventListener('click', () => save(app, parseCombo(STARTERS[+b.dataset.start]))));
  $$('[data-spot]', el).forEach((b) => b.addEventListener('click', () => save(app, spotted[+b.dataset.spot].tokens)));
  $$('[data-drill]', el).forEach((b) => b.addEventListener('click', () => app.drillCombos([b.dataset.drill])));
  $('#drillAll', el)?.addEventListener('click', () => app.drillCombos(null));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => {
    const c = combos.find((x) => x.id === b.dataset.del);
    if (!c || !confirm(`Delete ${comboLabel(c.tokens)}?`)) return;
    state.combos = combos.filter((x) => x !== c);
    app.persist();
    app.rerender();
  }));
  show();
}

function comboRow(c, state) {
  const h = comboHistory(c, state.sessions);
  const bits = [];
  if (h.sessions) {
    bits.push(`<b>${h.exact}</b> on camera in 30 days${h.close ? ` · ${h.close} close` : ''}${h.lastSeen ? ` · last ${shortDate(h.lastSeen)}` : ''}`);
  } else bits.push('Not on camera yet');
  if (h.called) bits.push(`thrown clean ${h.calledClean}/${h.called} times when called`);
  return `<li class="combo-row">
    <div class="grow">${comboHTML(c.tokens)}${c.name ? `<div class="small">${esc(c.name)}</div>` : ''}<div class="small muted">${bits.join(' · ')}</div></div>
    <button class="btn sm ghost" data-drill="${c.id}">Drill</button>
    <button class="linkbtn" data-del="${c.id}" aria-label="Delete ${esc(comboLabel(c.tokens))}">✕</button>
  </li>`;
}

function save(app, tokens, name = '') {
  if (!tokens) return false;
  const text = comboText(tokens);
  if (app.state.combos.some((c) => comboText(c.tokens) === text)) {
    toast(`${comboLabel(tokens)} is already saved.`);
    return false;
  }
  app.state.combos.push({ id: newId(), tokens: [...tokens], name, created: new Date().toISOString() });
  app.persist();
  toast(`Saved ${comboLabel(tokens)}.`);
  app.rerender();
  return true;
}
