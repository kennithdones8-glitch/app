// Coach tab: memory (by source), hypotheses, priorities, decision drills, settings.
import { SKILLS, HIT_REASONS, OBS_TAGS, SCENARIOS, OPPONENTS } from '../library.js';
import { AREAS, TARGETS, INSIGHTS } from '../coach.js';
import { memoryTrace, rankProblems, priorities } from '../engine.js';
import { startHypothesis, evaluateHypothesis } from '../hypotheses.js';
import * as store from '../store.js';
import { $, $$, esc, shortDate, subnav, subOf, toast, opt, scoreClass, pageHead } from '../ui.js';
import { aiKey, aiModel, setAi, AI_MODELS } from '../aicheck.js';
import { buildBugReport } from '../bugreport.js';
import { EQUIPMENT } from '../coachme.js';

const OWN = Object.fromEntries(Object.entries(EQUIPMENT).filter(([k]) => k !== 'none'));

const taughtText = (p) => {
  const all = p.punchLabels.length, spotted = p.punchLabels.filter((x) => x.ratio != null).length;
  return `You've taught it ${all} punches${spotted < all ? ` (${spotted} with the camera spot recorded)` : ''}. It uses them only when the camera is set up like it was then, and only where it beats the built-in reading. A punch test from each spot you use teaches it fastest.`;
};

const SUBS = [['memory', 'Memory'], ['hypotheses', 'Tests'], ['priorities', 'Priorities'], ['iq', 'Fight IQ']];

// Pro weight-class limits in pounds.
export const WEIGHT_CLASSES = [
  ['Flyweight', 112], ['Super flyweight', 115], ['Bantamweight', 118], ['Super bantamweight', 122], ['Featherweight', 126],
  ['Super featherweight', 130], ['Lightweight', 135], ['Super lightweight', 140], ['Welterweight', 147],
  ['Super welterweight', 154], ['Middleweight', 160], ['Super middleweight', 168], ['Light heavyweight', 175],
  ['Cruiserweight', 200], ['Heavyweight', 999],
];

export function renderCoach(view, app) {
  const sub = subOf('memory');
  view.innerHTML = sub === 'settings'
    ? `${pageHead('Settings', { eyebrow: '<a href="#coach">‹ Coach</a>' })}<div id="coachBody"></div>`
    : `${pageHead('Coach', { eyebrow: 'What I know and what I\'m testing', nav: subnav('coach', SUBS, sub) })}<div id="coachBody"></div>`;
  ({ memory, hypotheses, prioritiesView, iq, settings }[{ priorities: 'prioritiesView' }[sub] || sub] || memory)($('#coachBody'), app);
}

// ---------------------------------------------------------------------------
// Memory: coach feedback, your observations, AI observations and measured data are kept apart.

// A list card showing the newest few, the rest one tap away.
function listCard(title, items, render, empty = '', sub = '') {
  const first = items.slice(0, 3), rest = items.slice(3);
  return `<section class="card"><h2>${esc(title)}</h2>${sub && items.length ? `<p class="muted small" style="margin-top:0">${esc(sub)}</p>` : ''}
    ${items.length ? `<ul class="obs-list">${first.map(render).join('')}</ul>${rest.length ? `<details class="howto"><summary class="small">Show ${rest.length} more</summary><ul class="obs-list">${rest.map(render).join('')}</ul></details>` : ''}` : `<p class="muted small">${esc(empty)}</p>`}</section>`;
}

function memory(el, app) {
  const state = app.state;
  const ctx = app.model();
  const by = (src) => state.observations.filter((o) => o.source === src).sort((a, b) => b.date.localeCompare(a.date));
  const note = (o) => {
    const trace = memoryTrace(o, state, ctx);
    return `<li class="obs ${o.kind} ${o.status === 'resolved' ? 'resolved' : ''}">
      <div class="obs-top"><span class="muted small">${shortDate(o.date)}${o.kind && o.kind !== 'note' ? ` · ${o.kind}` : ''}${o.status === 'resolved' ? ' · resolved' : ''}</span>
        ${o.source !== 'ai' ? `<span class="obs-actions"><button class="linkbtn small" data-resolve="${o.id}">${o.status === 'resolved' ? 'Reopen' : 'Resolved'}</button><button class="linkbtn small" data-del="${o.id}">Delete</button></span>` : ''}</div>
      <p>${esc(o.text)}</p>
      ${(o.tags || []).length ? `<div class="tags">${o.tags.map((t) => `<span>${esc(OBS_TAGS[t] || t)}</span>`).join('')}</div>` : ''}
      ${trace ? `<p class="trace small">📈 ${esc(trace)}</p>` : ''}
    </li>`;
  };
  const measured = Object.keys(AREAS).filter((a) => state.memory.ema[a] != null);
  const strong = ctx.skills.filter((s) => s.confidence === 'high' || s.confidence === 'medium');

  el.innerHTML = `
    <details class="options card">
      <summary class="rowbtn"><b>+ Add a note</b><span>What your coach said, or what you noticed</span><span class="chev">›</span></summary>
      <form id="obsForm" class="form" style="margin-top:12px">
        <div class="seg wide" role="radiogroup" aria-label="Who said it">
          <label><input type="radio" name="source" value="coach" checked><span>Coach said</span></label>
          <label><input type="radio" name="source" value="self"><span>My observation</span></label>
        </div>
        <textarea name="text" rows="2" maxlength="400" required placeholder="e.g. &quot;You're backing straight up after combinations.&quot;"></textarea>
        <div class="row2">
          <label>Type<select name="kind">${opt('issue', 'issue', 'Something to fix')}${opt('positive', '', 'Something good')}${opt('note', '', 'Just a note')}</select></label>
          <label>About<select name="tag">${opt('', '', '—')}<optgroup label="Why I get hit">${Object.entries(HIT_REASONS).map(([k, r]) => opt(`hit:${k}`, '', r.name)).join('')}</optgroup><optgroup label="Skills">${Object.entries(SKILLS).map(([k, s]) => opt(k, '', s.name)).join('')}</optgroup></select></label>
        </div>
        <button class="btn primary" type="submit">Remember this</button>
      </form>
    </details>
    ${listCard('Coach said', by('coach'), note, "Log what your coach tells you. I'll track whether it improves.")}
    ${by('self').length ? listCard('Your notes', by('self'), note) : ''}
    ${listCard('What I noticed', by('ai'), note, 'Patterns from your data show up here after a few sessions.', 'Inferred from your data: treat as hypotheses, not facts.')}
    <section class="card"><h2>Measured</h2>
      ${measured.length ? `<div class="areas">${measured.map((a) => `<div class="area"><span>${AREAS[a]}</span><div class="bd-bar"><div class="${scoreClass(state.memory.ema[a], TARGETS[a])}" style="width:${state.memory.ema[a]}%"></div><i style="left:${TARGETS[a]}%"></i></div><b>${state.memory.ema[a]}</b></div>`).join('')}</div><p class="muted small">Camera-measured recent averages; the tick is the target.</p>` : '<p class="muted small">Camera sessions produce measured data.</p>'}
      ${Object.keys(state.memory.insights).length ? `<details class="howto"><summary class="small">Habits seen (${Object.keys(state.memory.insights).length})</summary><ul class="habits">${Object.entries(state.memory.insights).map(([k, v]) => `<li>${esc(INSIGHTS[k].text)} <span class="muted">· ${v.count}× · last ${shortDate(v.lastSeen)}</span></li>`).join('')}</ul></details>` : ''}
      ${state.memory.resolved.length ? `<h3>Fixed 💪</h3><ul class="habits good">${state.memory.resolved.slice(0, 5).map((r) => `<li>${esc(INSIGHTS[r.key]?.text || r.key)} <span class="muted">· ${shortDate(r.date)}</span></li>`).join('')}</ul>` : ''}
      ${strong.length ? `<p class="muted small">${strong.length} skills have enough evidence for a confident rating — see Progress → Skills.</p>` : ''}
    </section>`;

  $('#obsForm', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim();
    if (!text) return;
    state.observations.push({
      id: store.newId(), date: new Date().toISOString(), source: f.querySelector('[name=source]:checked').value,
      kind: f.kind.value, text, tags: f.tag.value ? [f.tag.value] : [], status: 'open',
    });
    app.persist();
    toast('Remembered.');
    app.rerender();
  });
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Delete this note?')) return;
    state.observations = state.observations.filter((o) => o.id !== b.dataset.del);
    app.persist();
    app.rerender();
  }));
  $$('[data-resolve]', el).forEach((b) => b.addEventListener('click', () => {
    const o = state.observations.find((x) => x.id === b.dataset.resolve);
    o.status = o.status === 'resolved' ? 'open' : 'resolved';
    app.persist();
    app.rerender();
  }));
}

// ---------------------------------------------------------------------------

function hypotheses(el, app) {
  const state = app.state;
  const ctx = app.model();
  const testing = state.hypotheses.filter((h) => h.status === 'testing');
  const done = state.hypotheses.filter((h) => !['testing', 'dismissed'].includes(h.status)).reverse();
  const verdictCls = { supported: 'good', refuted: 'bad', inconclusive: 'warn' };
  el.innerHTML = `
    <section class="card">
      <h2>Proposed</h2>
      <p class="muted small">I form hypotheses from your data, then test them: your last 3 weeks are the baseline, the next 2 weeks run the intervention, and I compare.</p>
      ${ctx.proposals.length ? ctx.proposals.map((p) => `
        <div class="hyp">
          <p><b>${esc(p.text)}</b></p>
          <p class="small"><b>Test:</b> ${esc(p.intervention)}</p>
          <div class="row2"><button class="btn primary" data-start="${p.key}">Test it</button><button class="btn ghost" data-dismiss="${p.key}">Not now</button></div>
        </div>`).join('') : '<p class="muted small">Nothing to propose yet — I need patterns in your data first.</p>'}
    </section>
    <section class="card">
      <h2>Testing</h2>
      ${testing.length ? testing.map((h) => {
        const ev = evaluateHypothesis(h, state, ctx.now);
        return `<div class="hyp">
          <div class="eyebrow">Hypothesis #${h.n} · ends ${shortDate(h.endsAt)}</div>
          <p><b>${esc(h.text)}</b></p>
          ${h.intervention ? `<p class="small"><b>Intervention:</b> ${esc(h.intervention)}</p>` : ''}
          <p class="small muted">Baseline: ${ev.baseline?.n ?? 0} sessions${ev.baseline?.mean != null ? ` (avg ${ev.baseline.mean})` : ''} · Test: ${ev.test?.n ?? 0} sessions${ev.test?.mean != null ? ` (avg ${ev.test.mean})` : ''}${ev.effect != null ? ` · effect so far ${ev.effect > 0 ? '+' : ''}${ev.effect}%` : ''}</p>
          <button class="linkbtn small" data-abandon="${h.id}">Abandon</button>
        </div>`;
      }).join('') : '<p class="muted small">No experiments running.</p>'}
    </section>
    <section class="card">
      <h2>Results</h2>
      ${done.length ? done.map((h) => `<div class="hyp">
        <div class="eyebrow">Hypothesis #${h.n} · ${shortDate(h.result?.date || h.created)}</div>
        <p>${esc(h.text)}</p>
        <p><span class="badge ${verdictCls[h.status] || ''}">${h.status}</span> ${h.result?.text ? esc(h.result.text[0].toUpperCase() + h.result.text.slice(1)) + '.' : ''}</p>
      </div>`).join('') : '<p class="muted small">Concluded experiments will show here.</p>'}
    </section>`;
  $$('[data-start]', el).forEach((b) => b.addEventListener('click', () => {
    state.hypotheses.push(startHypothesis(b.dataset.start, state.hypotheses));
    app.persist();
    toast('Experiment started. Your plan now includes the intervention.');
    app.rerender();
  }));
  $$('[data-dismiss]', el).forEach((b) => b.addEventListener('click', () => {
    state.hypotheses.push({ ...startHypothesis(b.dataset.dismiss, state.hypotheses), status: 'dismissed' });
    app.persist();
    app.rerender();
  }));
  $$('[data-abandon]', el).forEach((b) => b.addEventListener('click', () => {
    const h = state.hypotheses.find((x) => x.id === b.dataset.abandon);
    h.status = 'dismissed';
    app.persist();
    app.rerender();
  }));
}

// ---------------------------------------------------------------------------

function prioritiesView(el, app) {
  const state = app.state;
  const ctx = app.model();
  const pr = priorities(rankProblems(ctx, state), state);
  const row = (p, paused) => `<div class="prio ${paused ? 'paused' : ''}">
    <div><b>${esc(p.label)}</b><p class="small muted">${esc(p.why[0] || '')}</p><span class="src">${esc(p.source)}</span></div>
    <button class="btn ghost" data-toggle="${esc(p.key)}">${paused ? 'Resume' : 'Pause'}</button></div>`;
  el.innerHTML = `
    <section class="card">
      <h2>Active priorities</h2>
      ${pr.congested ? `<div class="msg behind">⚠️ ${esc(pr.message)}<br><button class="btn primary" id="applyTop3" style="margin-top:8px">Focus on the top 3</button></div>` : ''}
      ${pr.active.length ? pr.active.map((p, i) => `<div class="prio"><div><b>${i + 1}. ${esc(p.label)}</b><p class="small muted">${esc(p.why[0] || '')}</p><span class="src">${esc(p.source)}</span></div><button class="btn ghost" data-toggle="${esc(p.key)}">Pause</button></div>`).join('')
        : '<p class="muted small">No priorities yet. Train and log, and I\'ll rank what matters.</p>'}
    </section>
    ${pr.all.length > pr.active.length ? `<section class="card"><h2>Waiting</h2>${pr.all.filter((p) => !pr.active.includes(p)).map((p) => row(p, (state.paused || []).includes(p.key))).join('')}</section>` : ''}`;
  $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    state.paused = state.paused.includes(k) ? state.paused.filter((x) => x !== k) : [...state.paused, k];
    app.persist();
    app.rerender();
  }));
  $('#applyTop3', el)?.addEventListener('click', () => {
    const keep = new Set(pr.active.map((p) => p.key));
    state.paused = [...new Set([...state.paused, ...pr.all.filter((p) => !keep.has(p.key)).map((p) => p.key)])];
    app.persist();
    toast('Paused everything outside your top 3.');
    app.rerender();
  });
}

// ---------------------------------------------------------------------------
// Decision-making drills

let quiz = null;

function pickScenarios(decisions, n = 8) {
  const stats = {};
  for (const d of decisions) {
    const s = (stats[d.id] ||= { seen: 0, wrong: 0, last: '' });
    s.seen++;
    if (!d.correct) s.wrong++;
    s.last = d.date;
  }
  const scored = SCENARIOS.map((sc) => {
    const s = stats[sc.id];
    const priority = !s ? 2 : (s.wrong / s.seen) * 3 + (1 / (s.seen + 1));
    return { sc, priority: priority + Math.random() * 0.5 };
  }).sort((a, b) => b.priority - a.priority);
  return scored.slice(0, n).map((x) => x.sc);
}

function iq(el, app) {
  const state = app.state;
  const ctx = app.model();
  const decs = state.decisions;
  const recent = decs.slice(-30);
  const acc = recent.length ? Math.round((recent.filter((d) => d.correct).length / recent.length) * 100) : null;
  const rt = recent.length ? (recent.reduce((a, d) => a + d.ms, 0) / recent.length / 1000).toFixed(1) : null;
  const wrongCount = {};
  for (const d of decs) if (!d.correct) wrongCount[d.id] = (wrongCount[d.id] || 0) + 1;
  const repeated = Object.entries(wrongCount).filter(([, n]) => n >= 2).map(([id, n]) => ({ sc: SCENARIOS.find((s) => s.id === id), n })).filter((x) => x.sc);
  const iqRating = ctx.skills.find((s) => s.key === 'fightIQ');

  if (quiz) return renderQuestion(el, app);
  el.innerHTML = `
    <section class="card">
      <h2>Fight IQ</h2>
      <div class="stats4">
        <div><b>${iqRating.rating}</b><span>Fight IQ</span></div>
        <div><b>${acc ?? '–'}${acc != null ? '%' : ''}</b><span>accuracy (last 30)</span></div>
        <div><b>${rt ?? '–'}${rt ? 's' : ''}</b><span>avg decision</span></div>
        <div><b>${decs.length}</b><span>decisions</span></div>
      </div>
      <p class="muted small">Real fight situations, not trivia. Answer fast — reaction time counts. Scenarios you get wrong come back more often.</p>
      <button class="btn primary block big" id="startQuiz">Start 8 decisions</button>
    </section>
    ${repeated.length ? `<section class="card"><h2>Repeated mistakes</h2><ul class="habits">${repeated.map((r) => `<li>${esc(r.sc.text)} <span class="muted">· wrong ${r.n}×</span><br><span class="small">✔ ${esc(r.sc.options[r.sc.best[0]])}</span></li>`).join('')}</ul></section>` : ''}`;
  $('#startQuiz', el).addEventListener('click', () => {
    quiz = { items: pickScenarios(decs), i: 0, shownAt: 0, answered: null, score: 0 };
    renderQuestion(el, app);
  });
}

function renderQuestion(el, app) {
  const q = quiz;
  if (q.i >= q.items.length) {
    el.innerHTML = `<section class="card"><h2>Done: ${q.score}/${q.items.length}</h2><p class="muted small">Your Fight IQ rating updates from these decisions.</p><button class="btn primary block" id="quizDone">Back</button></section>`;
    $('#quizDone', el).addEventListener('click', () => { quiz = null; app.rerender(); });
    return;
  }
  const sc = q.items[q.i];
  const a = q.answered;
  el.innerHTML = `
    <section class="card quiz">
      <div class="eyebrow">Decision ${q.i + 1} of ${q.items.length}</div>
      <h2>${esc(sc.text)}</h2>
      <div class="options">${sc.options.map((o, i) => {
        let cls = '';
        if (a != null) cls = sc.best.includes(i) ? 'good' : sc.ok.includes(i) ? 'warn' : i === a ? 'bad' : '';
        return `<button class="opt ${cls}" data-opt="${i}" ${a != null ? 'disabled' : ''}><span>${'ABCD'[i]}</span>${esc(o)}</button>`;
      }).join('')}</div>
      ${a != null ? `<div class="msg ${sc.best.includes(a) ? 'ontrack' : sc.ok.includes(a) ? 'fast' : 'behind'}">${sc.best.includes(a) ? '✔ Best choice.' : sc.ok.includes(a) ? '≈ Defensible, but not the best.' : '✕ Not this time.'} ${esc(sc.why)} <span class="muted small">(${(q.lastMs / 1000).toFixed(1)}s)</span></div>
        <button class="btn primary block" id="nextQ">Next</button>` : ''}
    </section>`;
  if (a == null) {
    q.shownAt = performance.now();
    $$('[data-opt]', el).forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.opt;
      const ms = Math.round(performance.now() - q.shownAt);
      const correct = sc.best.includes(i);
      q.answered = i;
      q.lastMs = ms;
      if (correct) q.score++;
      app.state.decisions.push({ id: sc.id, date: new Date().toISOString(), choice: i, correct, ok: sc.ok.includes(i), ms });
      app.persist();
      renderQuestion(el, app);
    }));
  } else {
    $('#nextQ', el).addEventListener('click', () => { q.i++; q.answered = null; renderQuestion(el, app); });
  }
}

// ---------------------------------------------------------------------------

function settings(el, app) {
  const { profile, settings: st } = app.state;
  el.innerHTML = `
    <section class="card">
      <h2>Profile</h2>
      <form id="profile" class="form">
        <label>Name<input name="name" value="${esc(profile.name)}" maxlength="40" placeholder="Optional"></label>
        <div class="row2">
          <label>Stance<select name="stance">${opt('orthodox', profile.stance, 'Orthodox')}${opt('southpaw', profile.stance, 'Southpaw')}</select></label>
          <label>Level<select name="level">${opt('beginner', profile.level, 'Beginner')}${opt('intermediate', profile.level, 'Intermediate')}${opt('advanced', profile.level, 'Advanced')}</select></label>
        </div>
        <label>Goal<select name="goal">${opt('compete', profile.goal, 'Compete')}${opt('technique', profile.goal, 'Technique')}${opt('fitness', profile.goal, 'Fitness')}${opt('self-defence', profile.goal, 'Self-defence')}</select></label>
        <div class="row2">
          <label>Fight rounds<select name="fightRounds">${[3, 4, 5, 6, 8, 10, 12].map((n) => opt(n, profile.fight.rounds, n)).join('')}</select></label>
          <label>Round length<select name="fightRoundSec">${[120, 180].map((n) => opt(n, profile.fight.roundSec, `${n / 60} min`)).join('')}</select></label>
        </div>
        <fieldset><legend>Fight camp mode</legend>
          <label>Fight date<input type="date" name="fightDate" value="${esc(profile.fightDate)}"></label>
          <label>Opponent style<select name="opponentStyle">${opt('', profile.opponentStyle, 'Unknown')}${Object.entries(OPPONENTS).map(([k, o]) => opt(k, profile.opponentStyle, o.name)).join('')}</select></label>
          <p class="muted small">With a date set, the whole app switches into camp: 8 weeks out skill acquisition and volume, 5 weeks tactical work against your opponent's style, 3 weeks fight-specific intensity, fight week taper.</p>
        </fieldset>
        <label>Weight class<select name="weightClass">${opt('', '', 'Choose…')}${WEIGHT_CLASSES.filter(([, lb]) => lb < 999).map(([n, lb]) => opt(lb, profile.unit === 'lb' ? profile.targetWeight : '', `${n} · ${lb} lb`)).join('')}</select></label>
        <div class="row2">
          <label>Target weight (${esc(profile.unit)})<input type="number" name="targetWeight" step="0.1" min="0" inputmode="decimal" value="${profile.targetWeight ?? ''}" placeholder="${profile.unit === 'lb' ? 'e.g. 154' : 'e.g. 70'}"></label>
          <label>Units<select name="unit">${opt('lb', profile.unit, 'Pounds (lb)')}${opt('kg', profile.unit, 'Kilograms (kg)')}</select></label>
        </div>
        <label>Training days per week<input type="number" name="weeklyGoal" min="1" max="7" value="${profile.weeklyGoal}"></label>
        <fieldset><legend>What you train with (for the weekly plan)</legend>${Object.entries(OWN).map(([k, v]) => `<label class="switch"><input type="checkbox" name="own" value="${k}" ${(profile.equipment || []).includes(k) ? 'checked' : ''}> <span>${esc(v)}</span></label>`).join('')}</fieldset>
        <label><span>Punch detection sensitivity <b id="sensOut">${profile.sensitivity}</b></span>
          <input type="range" name="sensitivity" min="0.5" max="2" step="0.1" value="${profile.sensitivity}"></label>
        ${profile.punchCal?.acc >= 0.6 ? `<p class="small muted" style="margin:0">Punch reading tuned to you from ${profile.punchCal.n} punches (drilled-combo videos, ${Math.round(profile.punchCal.acc * 100)}% right). <button type="button" class="linkbtn" id="resetCal">Reset</button></p>` : ''}
        ${profile.punchLabels?.length ? `<p class="small muted" style="margin:0">${taughtText(profile)} <button type="button" class="linkbtn" id="resetLabels">Forget my labels</button></p>` : ''}
        <label class="switch"><input type="checkbox" name="voice" ${st.voice ? 'checked' : ''}> <span>Voice coaching</span></label>
        <label class="switch"><input type="checkbox" name="cues" ${st.cues ? 'checked' : ''}> <span>Live form cues ("Hands up!")</span></label>
        <label class="switch"><input type="checkbox" name="combos" ${st.combos ? 'checked' : ''}> <span>Call out combos</span></label>
        <label>Combo call every<select name="comboInterval">${[4, 5, 6, 8, 10, 15].map((s) => opt(s, st.comboInterval, `${s} seconds`)).join('')}</select></label>
        <button class="btn primary block" type="submit">Save</button>
        <button class="btn ghost block" id="shareApp" type="button">Share BoxCoach with a friend</button>
      </form>
    </section>
    <section class="card">
      <h2>Report a problem</h2>
      <p class="muted small" style="margin-top:0">Say what went wrong. The report adds the app version, your phone and the last errors the app hit, then you pick where to send it.</p>
      <textarea id="bugWhat" rows="3" maxlength="1000" placeholder="e.g. it counted punches when I was just bouncing"></textarea>
      <button class="btn ghost block" id="bugSend" type="button" style="margin-top:8px">Send report</button>
    </section>
    <section class="card">
      <h2>Claude punch check (optional)</h2>
      <p class="muted small">After a video is analysed on your phone, Claude can look at cropped frames of the boxer, check every punch type and add punches the tracker missed. It needs your own API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (pay as you go, roughly a few cents per 30 s of video). The key stays on this phone and only goes to Anthropic. It's never in backups or reports.</p>
      <form id="aiForm" class="form">
        <label>API key<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="${aiKey() ? 'Saved. Paste a new one to replace it.' : 'sk-ant-…'}"></label>
        <label>Model<select name="model">${Object.entries(AI_MODELS).map(([k, n]) => opt(k, aiModel(), n)).join('')}</select></label>
        <div class="row2"><button class="btn primary" type="submit">Save</button>${aiKey() ? '<button class="btn ghost" type="button" id="aiRemove">Remove key</button>' : ''}</div>
      </form>
    </section>
    <section class="card">
      <h2>Your data</h2>
      <p class="muted small">Everything is stored on this phone only. Back it up now and then: on iPhone choose <b>Save to Files → iCloud Drive</b> so a copy lives off the phone.${app.state.settings.lastBackup ? ` Last backup: ${esc(shortDate(app.state.settings.lastBackup))}.` : ' No backup yet.'}</p>
      <div class="row2">
        <button class="btn ghost" id="exportBtn">Export backup</button>
        <label class="btn ghost file">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
      </div>
      <button class="btn danger block" id="resetBtn">Erase everything</button>
    </section>
    <section class="card tips">
      <h3>Punch numbers</h3>
      <p class="small">1 jab · 2 cross · 3 lead hook · 4 rear hook · 5 lead uppercut · 6 rear uppercut</p>
      <h3>How ratings work</h3>
      <p class="small">Each skill starts at 50. Evidence moves it: camera measurements, sparring (why you got hit, what worked), constraint rounds, pattern usage, decision drills and coach/self notes. Recent evidence counts more (45-day half-life) and coach notes count more than self notes. Confidence reflects how much evidence there is.</p>
      <p class="muted small">Camera analysis is an estimate from one phone camera — use it as a mirror that remembers, not a judge.</p>
      <p class="muted small">BoxCoach version ${esc(app.version || '')}</p>
    </section>`;

  const f = $('#profile', el);
  f.weightClass.addEventListener('change', () => {
    if (!f.weightClass.value) return;
    const lb = +f.weightClass.value;
    f.targetWeight.value = f.unit.value === 'kg' ? (lb / 2.20462).toFixed(1) : lb;
  });
  f.sensitivity.addEventListener('input', () => { $('#sensOut').textContent = f.sensitivity.value; });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    // Switching lb ⇄ kg converts what's logged, not just the label.
    let target = +f.targetWeight.value > 0 ? +f.targetWeight.value : null;
    if (f.unit.value !== profile.unit) {
      const k = f.unit.value === 'kg' ? 1 / 2.20462 : 2.20462;
      const conv = (v) => Math.round(v * k * 10) / 10;
      app.state.weights = app.state.weights.map((w) => ({ ...w, value: conv(w.value) }));
      if (target != null && target === profile.targetWeight) target = conv(target);
    }
    app.state.profile = {
      ...profile,
      name: f.name.value.trim(), stance: f.stance.value, level: f.level.value, goal: f.goal.value,
      weeklyGoal: Math.min(7, Math.max(1, +f.weeklyGoal.value || 3)), sensitivity: +f.sensitivity.value,
      fight: { rounds: +f.fightRounds.value, roundSec: +f.fightRoundSec.value, restSec: 60 },
      fightDate: f.fightDate.value, opponentStyle: f.opponentStyle.value,
      targetWeight: target, unit: f.unit.value,
    };
    // Never asked and nothing ticked: leave it unset, so the plan stays as it was.
    const own = [...f.querySelectorAll('[name=own]:checked')].map((x) => x.value);
    if (own.length || profile.equipment) app.state.profile.equipment = own;
    app.state.settings = { ...st, voice: f.voice.checked, cues: f.cues.checked, combos: f.combos.checked, comboInterval: +f.comboInterval.value };
    app.rebuildPlan();
    app.persist();
    toast('Saved.');
  });
  $('#aiForm', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const key = e.target.key.value.trim();
    if (key && !key.startsWith('sk-')) return toast('That doesn\'t look like an Anthropic API key (they start with sk-ant-).');
    setAi(key || aiKey(), e.target.model.value);
    toast(key || aiKey() ? 'Saved. Switch on the Claude check when you analyse a video.' : 'Model saved. Add a key to use the check.');
    app.rerender();
  });
  $('#aiRemove', el)?.addEventListener('click', () => {
    setAi('', null);
    toast('Key removed from this phone.');
    app.rerender();
  });
  $('#exportBtn', el).addEventListener('click', async () => {
    const name = `boxcoach-backup-${new Date().toISOString().slice(0, 10)}.json`;
    app.state.settings.lastBackup = new Date().toISOString();
    app.persist();
    const file = new File([store.exportJSON(app.state)], name, { type: 'application/json' });
    // iPhone: the share sheet offers "Save to Files" (iCloud Drive keeps it off the phone).
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'BoxCoach backup' });
        toast('Backup saved.');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded.');
  });
  $('#importFile', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      app.state = store.importJSON(await file.text());
      app.persist();
      toast(`Imported ${app.state.sessions.length} sessions.`);
      app.rerender();
    } catch (err) {
      toast(err.message || 'Import failed.');
    }
  });
  $('#bugSend', el)?.addEventListener('click', async () => {
    const text = buildBugReport({ what: $('#bugWhat', el).value, version: app.version, state: app.state });
    try {
      if (navigator.share) await navigator.share({ title: 'BoxCoach problem report', text });
      else { await navigator.clipboard.writeText(text); toast('Report copied. Paste it in a message to whoever you are testing for.'); }
    } catch { /* closed the share sheet */ }
  });
  // A page that explains the app and how to install it, for other boxers.
  $('#shareApp', el)?.addEventListener('click', async () => {
    // Inside the store app the page address is internal to the phone; share the public one.
    const url = location.protocol.startsWith('http') ? new URL('about.html', location.href.split('#')[0]).href : 'https://kennithdones8-glitch.github.io/box-coach/about.html';
    try {
      if (navigator.share) await navigator.share({ title: 'BoxCoach', text: 'A boxing coach in your phone', url });
      else { await navigator.clipboard.writeText(url); toast('Link copied.'); }
    } catch { /* closed the share sheet */ }
  });
  $('#resetLabels', el)?.addEventListener('click', () => {
    if (!confirm('Forget every punch you labelled?')) return;
    delete app.state.profile.punchLabels;
    app.persist();
    app.rerender();
  });
  $('#resetCal', el)?.addEventListener('click', () => {
    if (!confirm('Forget what the camera learned about your punches?')) return;
    delete app.state.profile.punchCal;
    app.persist();
    toast('Punch reading reset to default.');
    app.rerender();
  });
  $('#resetBtn', el).addEventListener('click', () => {
    if (!confirm('Erase all sessions and everything the coach has learned? This cannot be undone.')) return;
    app.state = store.defaultState();
    app.persist();
    setAi('', null);
    location.hash = '#home';
  });
}

