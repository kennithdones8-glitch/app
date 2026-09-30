// Coach me: three questions, then a session built for today, and what's holding you back.
import { $, $$, esc, toast, pageHead, shortDate } from '../ui.js';
import { buildCoachSession, detectWeaknesses, adoption, levelOf, drillFor, benchmarkResults, personalCombos, EQUIPMENT, FEELINGS, METRICS, ROOTS } from '../coachme.js';
import { parseCombo, comboText, comboLabel } from '../combos.js';
import { newId } from '../store.js';

const TIMES = [15, 20, 30, 45, 60, 90];
let answers = null; // this visit's answers
let built = null;

export function renderCoachMe(el, app) {
  const st = app.state;
  st.coach ||= { equipment: [], levels: {}, overrides: [], assigned: {} };
  const ctx = app.model();
  answers ||= { minutes: st.coach.lastMinutes || 30, equipment: st.coach.equipment?.length ? [...st.coach.equipment] : ['none'], feel: 'good' };
  const weaknesses = detectWeaknesses(st, ctx);
  const bench = benchmarkResults(st.sessions);
  const combos = personalCombos(st, weaknesses, parseCombo, comboText);

  el.innerHTML = `
    ${pageHead('Coach me', { eyebrow: 'Answer three questions, I do the rest' })}
    <section class="card form" id="askCard">
      <label>How much time do you have?</label>
      <div class="chipset" data-q="minutes">${TIMES.map((m) => chip(m, `${m} min`, answers.minutes === m)).join('')}</div>
      <label>What do you have with you?</label>
      <div class="chipset" data-q="equipment">${Object.entries(EQUIPMENT).map(([k, n]) => chip(k, n, answers.equipment.includes(k))).join('')}</div>
      <label>How do you feel?</label>
      <div class="chipset" data-q="feel">${Object.entries(FEELINGS).map(([k, n]) => chip(k, n, answers.feel === k)).join('')}</div>
      <button class="btn primary block big" id="build" type="button" style="margin-top:12px">Build my session</button>
    </section>
    <div id="planOut">${built ? planHTML(built) : ''}</div>

    <section class="card">
      <h2>What's holding you back</h2>
      ${weaknesses.length ? weaknesses.map((w, i) => weaknessHTML(w, i, st)).join('') : `<p class="muted small">Not enough evidence yet. After a few camera sessions (or sparring logs with why you got hit) I'll name the root problems, not just the symptoms.</p>`}
      ${(st.coach.overrides || []).length ? `<details class="howto"><summary class="small">Your coach overruled ${st.coach.overrides.length}</summary><ul class="small">${st.coach.overrides.map((o, i) => `<li>${esc(ROOTS[o.key.replace('root:', '')]?.name || o.key)}: "${esc(o.note)}" <button class="linkbtn small" data-undo="${i}">Undo</button></li>`).join('')}</ul></details>` : ''}
    </section>

    ${combos.length ? `<section class="card">
      <h2>Combos built for you</h2>
      <p class="muted small">Built on the combination you already throw most, with the fix for your problems added.</p>
      ${combos.map((c, i) => `<div class="weak"><div class="card-head"><b>${esc(comboLabel(c.tokens))}</b><button class="btn ghost sm" data-savecombo="${i}" type="button">Save</button></div><p class="small muted" style="margin:2px 0 0">${esc(c.why)}</p></div>`).join('')}
    </section>` : ''}

    <section class="card">
      <h2>Benchmark</h2>
      <p class="muted small">The same 3 × 2-minute test every 4 weeks, so you can answer "am I better than 8 weeks ago?" with numbers. Camera on, whole body in frame.</p>
      ${bench ? benchHTML(bench) : ''}
      <button class="btn ${built?.benchmarkDue || (!bench && ctx) ? 'primary' : 'ghost'} block" id="bench" type="button">${bench ? 'Run the benchmark again' : 'Run your first benchmark'}</button>
    </section>`;

  $$('[data-q]', el).forEach((set) => set.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const q = set.dataset.q, v = b.dataset.v;
    if (q === 'minutes') answers.minutes = +v;
    else if (q === 'feel') answers.feel = v;
    else {
      const has = answers.equipment.includes(v);
      if (v === 'none') answers.equipment = ['none'];
      else answers.equipment = has ? answers.equipment.filter((x) => x !== v) : [...answers.equipment.filter((x) => x !== 'none'), v];
      if (!answers.equipment.length) answers.equipment = ['none'];
    }
    $$('[data-v]', set).forEach((c) => c.classList.toggle('on', q === 'equipment' ? answers.equipment.includes(c.dataset.v) : String(answers[q]) === c.dataset.v));
  }));

  $('#build', el).addEventListener('click', () => {
    st.coach.equipment = answers.equipment.filter((x) => x !== 'none');
    st.coach.lastMinutes = answers.minutes;
    app.persist();
    built = buildCoachSession({ state: st, ctx, minutes: answers.minutes, equipment: st.coach.equipment, feel: answers.feel });
    $('#planOut', el).innerHTML = planHTML(built);
    bindPlan(el, app);
    $('#planOut', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  bindPlan(el, app);

  $$('[data-override]', el).forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.override;
    const note = prompt(`Your coach disagrees with "${ROOTS[key].name}"? What did they say? (e.g. "That's intentional for this drill")`);
    if (!note?.trim()) return;
    st.coach.overrides = [...(st.coach.overrides || []), { key: `root:${key}`, note: note.trim(), date: new Date().toISOString() }];
    // Also kept as a coach note, so the memory has it.
    st.observations.push({ id: `ov${Date.now()}`, date: new Date().toISOString(), source: 'coach', kind: 'note', text: `Not a problem: ${ROOTS[key].name.toLowerCase()}. ${note.trim()}`, tags: [] });
    app.persist();
    built = null;
    toast("Got it. I won't flag that again.");
    app.rerender();
  }));
  $$('[data-undo]', el).forEach((b) => b.addEventListener('click', () => {
    st.coach.overrides.splice(+b.dataset.undo, 1);
    app.persist();
    app.rerender();
  }));
  $('#bench', el).addEventListener('click', () => app.startBenchmark());
  $$('[data-savecombo]', el).forEach((b) => b.addEventListener('click', () => {
    const c = combos[+b.dataset.savecombo];
    st.combos.push({ id: newId(), tokens: c.tokens, name: '', created: new Date().toISOString() });
    app.persist();
    toast(`Saved ${comboLabel(c.tokens)}: it'll be called in your rounds.`);
    app.rerender();
  }));
}

const chip = (v, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${v}">${esc(label)}</button>`;

function planHTML(p) {
  return `
    <section class="card objective">
      <div class="eyebrow">${p.minutes} min · ${esc(p.equipment.map((e) => EQUIPMENT[e]).join(', '))}</div>
      <h2>${esc(p.headline)}</h2>
      ${p.adjust.length ? `<ul class="small">${p.adjust.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${p.top ? `<div class="dnt"><div><b>Do this</b><span>${esc(p.top.do)}</span></div><div><b>Not that</b><span>${esc(p.top.not)}</span></div></div>` : ''}
      <ol class="blocks">${p.blocks.map((b) => `
        <li><b>${esc(b.name)}</b> <span class="muted small">${b.minutes} min</span><br>
          <span class="small">${esc(b.detail)}</span>
          <details class="why"><summary class="small">Why?</summary><div class="small muted">
            ${esc(b.purpose)}${b.why ? `<br>${esc(b.why)}` : ''}
            ${b.success ? `<br><b>Success:</b> ${esc(b.success)}<br><b>Too easy?</b> ${esc(b.progression)}<br><b>Too hard?</b> ${esc(b.regression)}` : ''}
          </div></details></li>`).join('')}</ol>
      ${p.live.coach && p.live.combos ? `<p class="small muted">During the rounds I'll call combos that end with "${esc(p.live.coach.finisher || 'your fix')}", and after each round I'll make the next one easier or harder from what the camera sees.</p>` : ''}
      <button class="btn primary block big" id="goCoached" type="button">Start</button>
    </section>`;
}

function bindPlan(el, app) {
  $('#goCoached', el)?.addEventListener('click', () => {
    const p = built;
    built = null;
    // The warm-up and drill come first on your own; the timer runs the rounds.
    toast(`Warm up and do the drill (${p.blocks.filter((b) => b.kind === 'warmup' || b.kind === 'drill').reduce((a, b) => a + b.minutes, 0)} min), then the rounds start.`);
    app.startCoached({ ...p.live, rounds_: p.live.rounds_.map((r) => ({ ...r })) });
  });
}

function weaknessHTML(w, i, st) {
  const lvl = levelOf(st, w.key);
  const d = drillFor(w.key, lvl);
  const a = adoption(st, w.key);
  const head = `<b>${i + 1}. ${esc(w.name)}</b><span class="badge ${w.sources >= 2 ? 'warn' : ''}">${w.sources >= 2 ? `${w.sources} kinds of evidence` : 'early signal'}</span>`;
  const body = `
      <p class="small" style="margin:4px 0">${esc(w.explain)}</p>
      <div class="dnt"><div><b>Do this</b><span>${esc(w.do)}</span></div><div><b>Not that</b><span>${esc(w.not)}</span></div></div>
      <p class="small muted" style="margin:6px 0">Drill level ${lvl}/4: ${esc(d.name)}. Success = ${esc(d.success.text)}.${a ? ` ${esc(a.text)}` : ''}</p>
      <details class="howto"><summary class="small">Evidence (${w.symptoms.length})</summary><ul class="small">${w.symptoms.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ul></details>
      <button class="linkbtn small" data-override="${w.key}" type="button">My coach disagrees</button>`;
  // The biggest one in full; the others one tap away.
  return i === 0
    ? `<div class="weak"><div class="card-head">${head}</div>${body}</div>`
    : `<details class="weak options"><summary class="card-head">${head}</summary>${body}</details>`;
}

function benchHTML(b) {
  const cols = [['First', b.first], ...(b.previous ? [['Previous', b.previous]] : []), ...(b.count > 1 ? [['Latest', b.latest]] : [])];
  const name = { ppm: 'Punches / min', ...Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, m.name])) };
  const unit = (k) => (k === 'ppm' ? '' : METRICS[k].unit);
  return `<div class="tbl-wrap"><table class="tbl cmp"><thead><tr><th></th>${cols.map(([n, r]) => `<th>${n}<br><span class="muted small">${esc(shortDate(r.date))}</span></th>`).join('')}</tr></thead>
    <tbody>${b.keys.map((k) => `<tr><td class="left">${esc(name[k])}</td>${cols.map(([, r]) => `<td>${r[k] == null ? '–' : `${r[k]}${unit(k)}`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
