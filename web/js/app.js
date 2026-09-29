import * as store from './store.js';
import {
  AREAS, TARGETS, ALL_TYPES, BOXING_TYPES, INSIGHTS,
  scoreSession, feedback, updateMemory, nextCombo, comboToSpeech, weekSummary, outputPpm,
} from './coach.js';
import { FormAnalyzer, combineRounds, PUNCH_NAMES } from './form.js';
import { requestMotionPermission, startMotion, motionSupported } from './motion.js';
import { RoundTimer, fmt } from './timer.js';
import * as audio from './audio.js';
import { lineChart } from './chart.js';
import {
  DAY_NAMES, buildWeek, planStatus, rebalance, weekCompletion, weekKey, weightStats, localDay,
} from './plan.js';
import { CONSTRAINTS, OPPONENTS, HIT_REASONS, POSITIVES } from './library.js';
import { buildContext, trainToday, aiObservations, generateRounds, rankProblems, priorities } from './engine.js';
import { stepHypothesis } from './hypotheses.js';
import { recoveryStatus, readinessOf, baselineHr } from './recovery.js';
import { fatigueMap } from './analysis.js';
import { $, $$, esc, fmtDate, shortDate, toast, scoreClass, scoreChip, subnav, subOf, pageHead } from './ui.js';
import { reviewFieldsHTML, bindReview, readReview } from './views/review.js';
import { buildReport, reportSize } from './report.js';
import { renderBoxer } from './views/boxer.js';
import { renderCoach } from './views/coach.js';
import { renderVideo } from './views/video.js';
import { renderCombos, comboHTML } from './views/combos.js';
import { parseCombo, comboText, comboLabel, comboSpeech, comboKey, punchDigits, pickCombo, judgeCalls, sessionCombos } from './combos.js';

let state = store.load();
const view = $('#view');

// Model cache: recomputed only when data changes.
let version = 0;
let modelCache = null;
function persist() {
  version++;
  if (!store.save(state)) toast('Could not save — storage is full or blocked.');
}

export const APP_VERSION = '2026.09.29-8';

const app = {
  version: APP_VERSION,
  get state() { return state; },
  set state(v) { state = v; version++; },
  persist,
  rerender: () => route(),
  model() {
    if (!modelCache || modelCache.version !== version) modelCache = { version, ctx: buildContext(state) };
    return modelCache.ctx;
  },
  rebuildPlan: () => rebuildPlan(currentPlan().gymDays),
  showSummary: (s) => { s.scores = scoreSession(s, state.profile); renderSummary(s); },
  // Open the live-session setup with your combos (or just some of them) being called.
  drillCombos: (ids) => {
    draft = { ...(draft || {}), type: draft?.type || 'shadow', combos: true, comboLevel: ids ? 'only' : 'mine', comboIds: ids };
    if (!draft.rounds) Object.assign(draft, { rounds: 3, roundSec: 180, restSec: 60, tracking: state.settings.tracking, constraints: false });
    if (location.hash === '#train/session') renderTrain(); else location.hash = '#train/session';
  },
};

// ---------------------------------------------------------------------------
// Routing

const routes = {
  home: renderHome, plan: renderPlan, train: renderTrain, log: renderLog,
  boxer: () => renderBoxer(view, app), coach: () => renderCoach(view, app),
  progress: () => { location.hash = '#boxer/charts'; },
};

function route() {
  const name = (location.hash.slice(1) || 'home').split('/')[0];
  const fn = routes[name] || renderHome;
  $$('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  fn();
  renderStreak();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function renderStreak() {
  const s = state.memory.streak;
  const today = localDay(new Date());
  const alive = s.lastDay && (new Date(today) - new Date(s.lastDay)) / 86400000 <= 1;
  const phase = app.model().phase;
  $('#streak').innerHTML = `${phase.camp ? `<span class="camp-pill">🥊 ${phase.weeksOut}w out</span>` : ''}${alive && s.count > 0 ? ` 🔥 ${s.count}` : ''}`;
}

// ---------------------------------------------------------------------------
// Today

let showToday = false;

const STATUS_WORD = { fresh: 'Fresh', normal: 'Ready to train', strained: 'Go lighter today', deload: 'Deload needed' };

function renderHome() {
  const { profile, sessions } = state;
  const ctx = app.model();
  const wk = weekSummary(sessions);
  const plan = currentPlan();
  const status = planStatus(plan, sessions);
  const today = localDay(new Date());
  const todays = plan.items.filter((i) => i.date === today && !i.moved);
  const tomorrow = localDay(new Date(Date.now() + 86400000));
  const nextPlan = plan.items.filter((i) => i.date === tomorrow);
  const ws = weightStats(state.weights, profile);
  const checkin = state.checkins.find((c) => c.date === today);
  const rec = ctx.recovery;
  const day = trainToday(state, ctx, { planItems: todays, tomorrowItems: nextPlan });
  const phase = ctx.phase;
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // Short, prioritised notes from the coach.
  const notes = [];
  if (phase.camp) notes.push(['🥊', `${phase.name}`, phase.priorities.join(' · '), '#plan']);
  if (day.priorities.congested) notes.push(['⚠️', 'Too many priorities at once', `${day.priorities.all.length - (state.paused || []).length} active — focus on the top 3`, '#coach/priorities']);
  if (ctx.proposals.length) notes.push(['🧪', 'I have a hypothesis to test', ctx.proposals[0].text, '#coach/hypotheses']);
  if (ws?.status === 'fast' || ws?.status === 'behind') notes.push(['⚖️', ws.status === 'fast' ? 'Cutting weight too fast' : 'Weight trending above target', ws.message, '#plan/weight']);
  const decay = ctx.decay[0];
  if (decay) notes.push(['📉', decay.kind === 'fatigue' ? 'Breaks down under fatigue' : 'Technical weakness', decay.text, '#boxer/analysis']);

  view.innerHTML = `
    ${pageHead('Today', { eyebrow: esc(dateLine) })}

    ${!sessions.length ? `
      <section class="card hero">
        <h2>Welcome${profile.name ? `, ${esc(profile.name)}` : ''} 👊</h2>
        <p>Every session, sparring round and coach note becomes evidence about your boxing. The plan is built from that.</p>
        <ol class="steps">
          <li>Do the check-in below.</li>
          <li>Run a camera session from <a href="#train">Train</a> so I can measure you.</li>
          <li>Log sparring and your coach's feedback.</li>
        </ol>
      </section>` : ''}

    <section class="card">
      ${checkin ? `
        <div class="ready-row">
          <div class="ring ${rec.status}" style="--v:${rec.readiness ?? 0}"><b>${rec.readiness ?? '–'}</b></div>
          <div class="ready-text"><b>${esc(STATUS_WORD[rec.status])}</b><span>${esc(rec.advice)}</span></div>
        </div>
        ${rec.reasons.length ? `<ul class="small">${rec.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        <div class="card-head" style="margin-top:10px"><span class="muted small">Load ${rec.load.acute} this week${rec.load.ratio != null ? ` · ${rec.load.ratio}× usual` : ''}</span><button class="linkbtn small" id="redoCheckin">Edit check-in</button></div>`
        : `<div class="card-head"><h2>Morning check-in</h2><span class="muted small">30 seconds</span></div>${checkinForm()}`}
    </section>

    <section class="card objective">
      <div class="eyebrow">What should I train today?</div>
      <h2>${esc(day.objective)}</h2>
      ${day.why[0] ? `<p class="small muted">${esc(day.why[0])}</p>` : ''}
      <div class="meta"><span>${day.minutes} min</span>${day.priorityOrder.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      ${showToday ? todayHTML(day) : ''}
      <div class="row2" style="margin-top:12px">
        <button class="btn ghost" id="whatToday">${showToday ? 'Hide plan' : 'Session plan'}</button>
        <button class="btn primary" id="startToday">Start rounds</button>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Scheduled</h2><a href="#plan">Week →</a></div>
      ${todays.map((it) => planItemHTML(it, status[it.id] === 'today' ? '' : status[it.id])).join('') || '<p class="muted small">Nothing scheduled today.</p>'}
    </section>

    ${notes.length ? `
    <section class="card">
      <h2>Coach notes</h2>
      <ul class="rows notes-list">${notes.slice(0, 4).map(([ico, title, sub, href]) => `
        <li><span class="row-ico">${ico}</span><a class="row-main" href="${href}" style="color:inherit;font-weight:400"><b>${esc(title)}</b><span>${esc(sub)}</span></a><span class="chev">›</span></li>`).join('')}</ul>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>This week</h2><span class="muted small">${wk.days} of ${profile.weeklyGoal} days</span></div>
      <div class="stats4">
        <div><b>${wk.sessions}</b><span>sessions</span></div>
        <div><b>${wk.minutes}</b><span>minutes</span></div>
        <div><b>${wk.punches.toLocaleString()}</b><span>punches</span></div>
        <div><b>${ws ? ws.avg7 : '–'}</b><span>${esc(profile.unit)} avg</span></div>
      </div>
      <div class="bar"><div style="width:${Math.min(100, (wk.days / profile.weeklyGoal) * 100)}%"></div></div>
    </section>`;

  $('#whatToday').addEventListener('click', () => { showToday = !showToday; renderHome(); });
  $('#startToday').addEventListener('click', () => {
    startSession({
      type: 'shadow', rounds: day.rounds.length, roundSec: 180, restSec: 60, tracking: state.settings.tracking === 'motion' ? 'camera' : state.settings.tracking,
      combos: true, comboLevel: 3, focus: state.memory.focus?.area || null, rounds_: day.rounds,
    });
  });
  $('#redoCheckin')?.addEventListener('click', () => {
    state.checkins = state.checkins.filter((c) => c.date !== today);
    persist();
    renderHome();
  });
  bindCheckin();
}

function todayHTML(d) {
  return `
    <div class="today">
      ${d.why.length > 1 ? `<p class="small"><b>Why:</b> ${d.why.slice(1).map(esc).join(' ')}</p>` : ''}
      <ol class="blocks">${d.blocks.map((b) => `<li><b>${esc(b.name)}</b> <span class="muted small">· ${b.minutes} min</span><br><span class="small muted">${esc(b.detail)}</span></li>`).join('')}</ol>
      ${d.avoid.length ? `<h3>Do not add</h3><ul class="avoid">${d.avoid.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </div>`;
}

function checkinForm() {
  const chips = (name, labels) => `<div class="seg wide" role="radiogroup">${labels.map((l, i) => `<label><input type="radio" name="${name}" value="${i + 1}"><span>${l}</span></label>`).join('')}</div>`;
  return `
    <form id="checkin" class="form">
      <div class="row2">
        <label>Sleep (hours)<input type="number" name="sleep" min="0" max="14" step="0.5" inputmode="decimal" required></label>
        <label>Resting HR<input type="number" name="hr" min="30" max="120" inputmode="numeric" placeholder="optional"></label>
      </div>
      <label>Soreness</label>${chips('soreness', ['None', 'Mild', 'Some', 'Sore', 'Very'])}
      <label>Motivation</label>${chips('motivation', ['Low', 'Meh', 'OK', 'Good', 'Fired up'])}
      <button class="btn primary" type="submit">Save check-in</button>
    </form>`;
}

function bindCheckin() {
  const f = $('#checkin');
  if (!f) return;
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (n) => f.querySelector(`[name=${n}]:checked`)?.value;
    const c = {
      date: localDay(new Date()), sleep: +f.sleep.value,
      soreness: val('soreness') ? +val('soreness') : 2, motivation: val('motivation') ? +val('motivation') : 3,
      hr: +f.hr.value || null,
    };
    state.checkins = state.checkins.filter((x) => x.date !== c.date).concat(c).slice(-120);
    persist();
    const r = readinessOf(c, baselineHr(state.checkins));
    toast(`Readiness ${r}/100.`);
    renderHome();
  });
}

// ---------------------------------------------------------------------------
// Train

let draft = null;

function renderTrain() {
  const sub = subOf('session');
  view.innerHTML = `${pageHead('Train', { nav: subnav('train', [['session', 'Live session'], ['combos', 'Combos'], ['video', 'Video']], sub) })}<div id="trainBody"></div>`;
  if (sub === 'video') return renderVideo($('#trainBody'), app);
  if (sub === 'combos') return renderCombos($('#trainBody'), app);
  const body = $('#trainBody');
  const ctx = app.model();
  const f = state.profile.fight;
  draft = draft || { type: 'shadow', rounds: 5, roundSec: 180, restSec: 60, tracking: state.settings.tracking, combos: state.settings.combos, comboLevel: 3, constraints: true };
  const types = ['shadow', 'bag', 'mitts', 'sparring', 'rope', 'conditioning'];
  const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  const secs = [20, 30, 60, 90, 120, 150, 180, 240, 300];
  const onlyCombos = state.combos.filter((c) => draft.comboIds?.includes(c.id));
  if (['mine', 'mix'].includes(draft.comboLevel) && !state.combos.length) draft.comboLevel = 3;
  const rests = [0, 10, 15, 30, 45, 60, 90, 120];

  body.innerHTML = `
    <div class="chips">
        <button class="chip" data-preset="fight">Fight sim ${f.rounds}×${fmt(f.roundSec)}</button>
        <button class="chip" data-preset="6x3">6×3</button>
        <button class="chip" data-preset="12x3">12×3</button>
        <button class="chip" data-preset="3x2">3×2</button>
        <button class="chip" data-preset="tabata">Tabata 8×20s</button>
    </div>
    <form id="setup" class="form">
      <section class="card form">
        <h2>Session</h2>
        <label>Workout<select name="type">${types.map((t) => opt(t, draft.type, ALL_TYPES[t])).join('')}</select></label>
        <div class="row3">
          <label>Rounds<select name="rounds">${Array.from({ length: 15 }, (_, i) => opt(i + 1, draft.rounds, i + 1)).join('')}</select></label>
          <label>Round<select name="roundSec">${secs.map((s) => opt(s, draft.roundSec, fmt(s))).join('')}</select></label>
          <label>Rest<select name="restSec">${rests.map((s) => opt(s, draft.restSec, fmt(s))).join('')}</select></label>
        </div>
      </section>
      <section class="card form">
        <h2>Rounds</h2>
        <label class="switch"><input type="checkbox" name="constraints" ${draft.constraints ? 'checked' : ''}> <span>Constraint rounds</span></label>
        <p class="muted small" style="margin:-4px 0 0">A problem to solve each round, built from your weaknesses and opponent exposure.</p>
        <div id="roundPreview"></div>
        <label class="switch"><input type="checkbox" name="combos" ${draft.combos ? 'checked' : ''}> <span>Call out combos</span></label>
        <label>Combos to call<select name="comboLevel">
          ${draft.comboLevel === 'only' && onlyCombos.length ? opt('only', 'only', `Only ${onlyCombos.map((c) => comboLabel(c.tokens)).join(', ')}`) : ''}
          ${state.combos.length ? `${opt('mine', draft.comboLevel, `My combos (${state.combos.length})`)}${opt('mix', draft.comboLevel, 'My combos + built-in')}` : ''}
          ${opt(1, draft.comboLevel, 'Built-in: basic')}${opt(2, draft.comboLevel, 'Built-in: intermediate')}${opt(3, draft.comboLevel, 'Built-in: advanced')}</select></label>
        ${state.combos.length ? '' : '<p class="muted small" style="margin:-4px 0 0">Build your own in <a href="#train/combos">Combos</a>.</p>'}
      </section>
      <section class="card form">
        <fieldset>
          <legend>Tracking</legend>
          <label class="radio"><input type="radio" name="tracking" value="camera" ${draft.tracking === 'camera' ? 'checked' : ''}>
            <span><b>Camera coach</b> — phone 2–3 m away, whole body in frame. Measures punches, guard, stance, footwork, head movement.</span></label>
          <label class="radio"><input type="radio" name="tracking" value="motion" ${draft.tracking === 'motion' ? 'checked' : ''} ${motionSupported() ? '' : 'disabled'}>
            <span><b>Phone in hand / on wrist</b> — counts punches with the motion sensor.</span></label>
          <label class="radio"><input type="radio" name="tracking" value="none" ${draft.tracking === 'none' ? 'checked' : ''}>
            <span><b>Timer only</b> — rounds and effort, optional tap counting.</span></label>
        </fieldset>
      </section>
      <button class="btn primary block big" type="submit">Start · <span id="totalTime"></span></button>
    </form>`;

  const form = $('#setup');
  let rounds = [];
  const sync = () => {
    const fd = new FormData(form);
    draft = {
      type: fd.get('type'), rounds: +fd.get('rounds'), roundSec: +fd.get('roundSec'), restSec: +fd.get('restSec'),
      tracking: fd.get('tracking'), combos: fd.get('combos') === 'on', comboLevel: /^\d$/.test(fd.get('comboLevel')) ? +fd.get('comboLevel') : fd.get('comboLevel'),
      comboIds: draft.comboIds, constraints: fd.get('constraints') === 'on',
    };
    $('#totalTime').textContent = fmt(draft.rounds * draft.roundSec + (draft.rounds - 1) * draft.restSec);
    const usable = draft.constraints && ['shadow', 'bag', 'mitts'].includes(draft.type);
    rounds = usable ? generateFor(draft.rounds, ctx) : [];
    $('#roundPreview').innerHTML = rounds.length ? `<ol class="blocks">${rounds.map((r) => `<li><b>${esc(CONSTRAINTS[r.constraint].name)}</b>${r.opponent ? ` <span class="muted small">vs ${esc(OPPONENTS[r.opponent].name.toLowerCase())}</span>` : ''}<br><span class="small muted">${esc(r.why)}</span></li>`).join('')}</ol>` : '';
  };
  form.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sync();
    state.settings.tracking = draft.tracking;
    state.settings.combos = draft.combos;
    persist();
    startSession({ ...draft, focus: state.memory.focus?.area || null, rounds_: rounds });
  });
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const presets = {
      fight: { type: 'bag', ...f, comboLevel: 3 },
      '3x2': { rounds: 3, roundSec: 120, restSec: 60 },
      '6x3': { rounds: 6, roundSec: 180, restSec: 60 },
      '12x3': { rounds: 12, roundSec: 180, restSec: 60 },
      tabata: { rounds: 8, roundSec: 20, restSec: 10, combos: false, constraints: false },
    };
    draft = { ...draft, ...presets[b.dataset.preset] };
    renderTrain();
  }));
}

// Constraint rounds from the engine, sized to the chosen number of rounds.
function generateFor(n, ctx) {
  return generateRounds({
    n, active: priorities(rankProblems(ctx, state), state).active, exposure: ctx.exposure,
    phase: ctx.phase, profile: state.profile, recovery: ctx.recovery,
  });
}

// ---------------------------------------------------------------------------
// Live session

let live = null;

async function startSession(plan) {
  if (live) return;
  audio.unlockAudio();
  audio.setVoice(state.settings.voice);
  let tracking = plan.tracking;
  if (tracking === 'motion') {
    try {
      if (!(await requestMotionPermission())) throw new Error();
    } catch {
      toast('Motion sensor permission denied — using timer only.');
      tracking = 'none';
    }
  }

  $('#live').hidden = false;
  document.body.classList.add('in-live');
  $('#camBox').hidden = tracking !== 'camera';
  $('#tapCount').hidden = tracking !== 'none' || !(plan.type in BOXING_TYPES);
  $('#liveCombo').textContent = '';
  $('#liveCue').textContent = '';
  $('#liveConstraint').hidden = true;
  $('#livePunches').textContent = '0';
  ['#livePpm', '#liveGuard', '#liveStance'].forEach((s) => { $(s).textContent = '–'; });
  $('#liveGuard').parentElement.hidden = tracking !== 'camera';
  $('#liveStance').parentElement.hidden = tracking !== 'camera';

  const med = app.model().med;
  live = {
    plan, tracking, startedAt: new Date().toISOString(), t0: performance.now(),
    total: 0, roundPunches: 0, perRound: [], formRounds: [], intensity: [],
    byType: tracking === 'camera' ? { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 } : null,
    completedRounds: 0, comboTimer: null, burstTimers: [], stopMotion: null, analyzer: null, tracker: null, wakeLock: null,
    medThreshold: med?.threshold || null, medCued: false, calls: [], callResults: [], lastComboId: null,
  };

  try { live.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }

  const countPunch = (type) => {
    if (!live || live.timer?.phase !== 'work') return;
    live.total++;
    live.roundPunches++;
    if (type && live.byType) live.byType[type]++;
    $('#livePunches').textContent = live.total;
    if (live.medThreshold && !live.medCued && live.byType?.jab >= live.medThreshold) {
      live.medCued = true;
      showCue(`Jab quality cap reached (${live.medThreshold}). Switch focus.`);
      audio.say('Jab quality cap reached. Switch focus.', { interrupt: true });
    }
  };

  if (tracking === 'camera') {
    live.analyzer = new FormAnalyzer({
      stance: state.profile.stance,
      sensitivity: state.profile.sensitivity,
      onCue: (key, text) => {
        if (!state.settings.cues) return;
        showCue(text);
        audio.say(text, { interrupt: true });
      },
      onPunch: (type) => countPunch(type),
    });
    try {
      const { PoseTracker } = await import('./pose.js');
      live.tracker = new PoseTracker($('#camVideo'), $('#camCanvas'));
      live.tracker.onFrame = (world, image, t) => {
        const m = live?.analyzer.update(world, image, t);
        $('#camStatus').textContent = image ? '' : 'Step into frame';
        if (m && live.timer?.phase === 'work') {
          $('#liveGuard').textContent = m.guard != null ? `${m.guard}%` : '–';
          $('#liveStance').textContent = m.stance != null ? `${m.stance}%` : '–';
        }
      };
      $('#camStatus').textContent = 'Loading coach vision…';
      await live.tracker.start();
      $('#camStatus').textContent = '';
    } catch (err) {
      console.warn(err);
      toast(`Camera coach unavailable: ${err.message || 'check camera permission and connection'}. Timer continues.`);
      $('#camBox').hidden = true;
      live.tracking = 'none';
      live.analyzer = null;
      $('#tapCount').hidden = false;
    }
  } else if (tracking === 'motion') {
    live.stopMotion = startMotion({
      sensitivity: state.profile.sensitivity,
      onPunch: (hit) => {
        if (live?.timer?.phase === 'work') live.intensity.push(hit.peak);
        countPunch(null);
      },
    });
  }
  if (!live) return; // ended while loading

  live.timer = new RoundTimer({
    rounds: plan.rounds, roundSec: plan.roundSec, restSec: plan.restSec, prepSec: 10,
    onPhase, onTick,
  });
  live.timer.start();
  updateClock();
}

function showCue(text) {
  const c = $('#liveCue');
  c.textContent = text;
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
  audio.vibrate(80);
}

function updateClock() {
  if (!live) return;
  const t = live.timer;
  $('#liveClock').textContent = fmt(Math.ceil(t.remainingMs / 1000));
  const workMin = t.workMs / 60000;
  if (workMin > 0.15 && (live.tracking !== 'none' || live.total)) $('#livePpm').textContent = Math.round(live.total / workMin);
}

function roundPlan(n) {
  return live?.plan.rounds_?.[n - 1] || null;
}

function closeRound() {
  if (!live) return;
  live.perRound.push(live.roundPunches);
  if (live.analyzer) {
    live.formRounds.push(live.analyzer.endRound());
    live.callResults.push(...judgeCalls(live.calls, live.analyzer.round.punchLog));
  }
  live.calls = [];
  live.roundPunches = 0;
  clearInterval(live.comboTimer);
  live.burstTimers.forEach(clearTimeout);
  live.burstTimers = [];
  $('#liveCombo').textContent = '';
}

function roundReport(n) {
  const punches = live.perRound[live.perRound.length - 1];
  const f = live.formRounds[live.formRounds.length - 1];
  const bits = [`Round ${n} done.`];
  if (live.tracking !== 'none' && punches != null) bits.push(`${punches} punches.`);
  const rp = roundPlan(n);
  const auto = rp && f && CONSTRAINTS[rp.constraint]?.auto?.(f);
  if (auto != null && f?.frames > 30) bits.push(`${CONSTRAINTS[rp.constraint].name}: ${auto} percent.`);
  if (f && f.frames > 30) {
    const issues = [];
    if (f.guard != null && f.guard < TARGETS.guard) issues.push([TARGETS.guard - f.guard, `Guard was up ${f.guard} percent. Keep your hands home.`]);
    if (f.crossedPct >= 5) issues.push([20, 'You crossed your feet. Step with the near foot.']);
    if (f.stance != null && f.stance < TARGETS.stance) issues.push([TARGETS.stance - f.stance, 'Hold your stance width when you move.']);
    if (f.footwork != null && f.footwork < 30) issues.push([15, 'Move your feet more.']);
    if (f.head != null && f.head < 25) issues.push([12, 'Move your head after you punch.']);
    issues.sort((a, b) => b[0] - a[0]);
    bits.push(issues.length ? issues[0][1] : 'Good form that round.');
  }
  const next = roundPlan(n + 1);
  if (next) bits.push(`Next round: ${CONSTRAINTS[next.constraint].name}.`);
  return bits.join(' ');
}

function onPhase(phase, round) {
  if (!live) return;
  const t = live.timer;
  $('#livePhase').textContent = { prep: 'PREP', work: 'FIGHT', rest: 'REST', done: 'DONE' }[phase];
  $('#live').dataset.phase = phase;
  $('#liveRound').textContent = phase === 'prep' ? 'Get ready' : `Round ${round} / ${t.rounds}`;
  if (phase === 'prep') {
    const first = roundPlan(1);
    audio.say(`Get ready.${first ? ` Round one: ${CONSTRAINTS[first.constraint].name}.` : live.plan.focus ? ` Focus: ${AREAS[live.plan.focus]}.` : ''}`, { interrupt: true });
    showConstraint(first);
  }
  if (phase === 'work') {
    audio.bell(1);
    audio.vibrate([200]);
    live.roundPunches = 0;
    live.analyzer?.startRound();
    const rp = roundPlan(round);
    showConstraint(rp);
    if (rp) setTimeout(() => audio.say(`${CONSTRAINTS[rp.constraint].name}.${rp.opponent ? ` Opponent: ${OPPONENTS[rp.opponent].name}.` : ''}`, { interrupt: true }), 600);
    if (rp && CONSTRAINTS[rp.constraint].burst) scheduleBursts();
    if (live.plan.combos && live.plan.type !== 'rope') scheduleCombos(rp);
  }
  if (phase === 'rest') {
    audio.bell(1);
    audio.vibrate([200, 100, 200]);
    live.completedRounds = round;
    closeRound();
    const msg = roundReport(round);
    showCue(msg);
    showConstraint(roundPlan(round + 1));
    setTimeout(() => audio.say(msg, { interrupt: true }), 1500);
  }
  if (phase === 'done') {
    audio.bell(3);
    live.completedRounds = round;
    closeRound();
    audio.say('Time! Great work.', { interrupt: true });
    finishSession();
  }
  updateClock();
}

function showConstraint(rp) {
  const el = $('#liveConstraint');
  if (!rp) { el.hidden = true; return; }
  const c = CONSTRAINTS[rp.constraint];
  el.hidden = false;
  el.innerHTML = `<b>R${rp.round}: ${esc(c.name)}</b>${rp.opponent ? `<span> vs ${esc(OPPONENTS[rp.opponent].name)}</span>` : ''}<p>${esc(c.text)}</p>`;
}

function onTick(phase, secLeft) {
  updateClock();
  if (phase === 'work' && secLeft === 10) audio.clap();
  if ((phase === 'rest' || phase === 'prep') && secLeft <= 3 && secLeft > 0) audio.tick();
}

function scheduleCombos(rp) {
  const every = state.settings.comboInterval * 1000;
  const c = rp ? CONSTRAINTS[rp.constraint] : null;
  const opp = rp?.opponent ? OPPONENTS[rp.opponent] : null;
  const call = () => {
    if (!live || live.timer.phase !== 'work' || live.timer.paused || live.bursting) return;
    const level = live.plan.comboLevel;
    const mine = level === 'only' ? state.combos.filter((x) => live.plan.comboIds?.includes(x.id)) : state.combos;
    const useMine = mine.length && (level === 'mine' || level === 'only' || (level === 'mix' && Math.random() < 0.5));
    let tokens = null, text, speech;
    if (useMine) {
      const pick = pickCombo(mine, live.lastComboId);
      live.lastComboId = pick.id;
      tokens = pick.tokens;
    } else {
      if (opp && Math.random() < 0.3) text = opp.prompts[Math.floor(Math.random() * opp.prompts.length)];
      else if (c?.combos) text = c.combos[Math.floor(Math.random() * c.combos.length)];
      else text = nextCombo(typeof level === 'number' ? level : 3, live.plan.focus);
      tokens = parseCombo(text);
    }
    if (tokens) { text = comboText(tokens); speech = comboSpeech(tokens); } else speech = comboToSpeech(text);
    $('#liveCombo').innerHTML = tokens ? comboHTML(tokens) : esc(text);
    audio.say(speech, { rate: 1.3 });
    // With the camera on, remember the call so we can check what was actually thrown.
    if (tokens && live.analyzer) live.calls.push({ t: performance.now(), key: comboKey(tokens), digits: punchDigits(tokens) });
  };
  setTimeout(call, 2500);
  live.comboTimer = setInterval(call, every);
}

// Fatigue simulation: 10-second all-out bursts every 30 seconds.
function scheduleBursts() {
  const roundMs = live.plan.roundSec * 1000;
  for (let at = 20000; at + 10000 < roundMs; at += 30000) {
    live.burstTimers.push(setTimeout(() => {
      if (!live || live.timer.phase !== 'work') return;
      live.bursting = true;
      $('#liveCombo').textContent = 'BURST! All out!';
      audio.say('Burst! All out!', { interrupt: true });
    }, at));
    live.burstTimers.push(setTimeout(() => {
      if (!live) return;
      live.bursting = false;
      $('#liveCombo').textContent = 'Back to clean technique';
      audio.say('Back to technique. Hands home.', { interrupt: true });
    }, at + 10000));
  }
}

function teardownLive() {
  if (!live) return;
  live.timer?.stop();
  clearInterval(live.comboTimer);
  live.burstTimers.forEach(clearTimeout);
  live.stopMotion?.();
  live.tracker?.stop();
  live.wakeLock?.release?.();
  window.speechSynthesis?.cancel();
  $('#live').hidden = true;
  document.body.classList.remove('in-live');
}

function finishSession() {
  if (!live) return;
  const l = live;
  const t = l.timer;
  const constraints = (l.plan.rounds_ || []).slice(0, l.completedRounds).map((r, i) => {
    const f = l.formRounds[i];
    const auto = f && f.frames > 30 ? CONSTRAINTS[r.constraint]?.auto?.(f) ?? null : null;
    return { round: r.round, key: r.constraint, opponent: r.opponent || null, compliance: auto, auto: auto != null };
  });
  const session = {
    id: store.newId(), date: l.startedAt, type: l.plan.type, tracking: l.tracking, source: 'live',
    plan: { rounds: l.plan.rounds, roundSec: l.plan.roundSec, restSec: l.plan.restSec },
    completedRounds: l.completedRounds,
    workSec: Math.round((t?.workMs || 0) / 1000),
    totalSec: Math.round((performance.now() - l.t0) / 1000),
    focus: l.plan.focus,
    punches: l.total || l.tracking !== 'none' ? { total: l.total, perRound: l.perRound, byType: l.byType } : null,
    intensity: l.intensity.length ? Math.round(l.intensity.reduce((a, b) => a + b, 0) / l.intensity.length) : null,
    form: l.formRounds.some((r) => r.frames > 30) ? combineRounds(l.formRounds) : null,
    constraints: constraints.length ? constraints : undefined,
    calib: l.analyzer?.calib.frames ? l.analyzer.calib : undefined,
    comboCalls: l.callResults.length ? l.callResults.slice(0, 400) : undefined,
    rpe: 7, notes: '',
  };
  teardownLive();
  live = null;
  if (session.workSec < 15) {
    toast('Session too short to save.');
    route();
    return;
  }
  session.scores = scoreSession(session, state.profile);
  renderSummary(session);
}

$('#livePause').addEventListener('click', () => {
  if (!live?.timer) return;
  const p = live.timer.togglePause();
  $('#livePause').textContent = p ? 'Resume' : 'Pause';
  if (p) window.speechSynthesis?.cancel();
});
$('#liveSkip').addEventListener('click', () => live?.timer?.skip());
$('#liveEnd').addEventListener('click', () => {
  if (!live) return;
  if (!confirm('End this session?')) return;
  if (!live.timer) { teardownLive(); live = null; route(); return; }
  if (live.timer.phase === 'work') closeRound();
  live.timer.stop();
  finishSession();
});
$('#tapCount').addEventListener('click', () => {
  if (!live || live.timer?.phase !== 'work') return;
  live.total++;
  live.roundPunches++;
  $('#livePunches').textContent = live.total;
  audio.vibrate(15);
});
$('#flipCam').addEventListener('click', () => live?.tracker?.flip().catch(() => toast('Could not switch camera.')));

// ---------------------------------------------------------------------------
// Summary & detail

function punchBreakdown(by) {
  if (!by) return '';
  const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  return `<div class="breakdown">${Object.entries(by).map(([k, v]) => `
    <div class="bd-row"><span>${PUNCH_NAMES[k]}</span><div class="bd-bar"><div style="width:${(v / total) * 100}%"></div></div><b>${v}</b></div>`).join('')}</div>`;
}

function fatigueTable(s) {
  const fm = fatigueMap(s, state.profile);
  if (!fm) return '';
  const dims = ['technique', 'pace', 'defense', 'footwork'];
  return `<h3>Fatigue map</h3><div class="tbl-wrap"><table class="tbl fmap"><thead><tr><th>Round</th><th>Technique</th><th>Pace</th><th>Defense</th><th>Footwork</th></tr></thead>
    <tbody>${fm.rows.map((r) => `<tr><td>R${r.round}</td>${dims.map((d) => `<td class="${scoreClass(r[d], 75)}${fm.breaks[d] === r.round ? ' brk' : ''}">${r[d] ?? '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="msg">${esc(fm.conclusion)}</div>`;
}

function roundsTable(s) {
  if (fatigueMap(s, state.profile)) return '';
  const pr = s.punches?.perRound || [];
  if (!pr.length) return '';
  return `<table class="tbl"><thead><tr><th>Round</th><th>Punches</th></tr></thead><tbody>${pr.map((n, i) => `<tr><td>R${i + 1}</td><td>${n}</td></tr>`).join('')}</tbody></table>`;
}

function combosHTML(s) {
  const { mine, calls } = sessionCombos(s, state.combos);
  if (!mine.length && !calls.called) return '';
  const judged = calls.exact + calls.close + calls.miss;
  return `<h3>Your combos</h3>
    ${calls.called ? `<p class="small">${calls.called} combos called${judged ? ` · <b>${calls.exact}</b> thrown clean · ${calls.close} one punch off · ${calls.miss} different` : ''}${calls.none ? ` · ${calls.none} with no punches seen` : ''}</p>` : ''}
    ${mine.length ? `<ul class="rows">${mine.map((m) => `<li>${comboHTML(m.combo.tokens)}<span class="grow"></span><b>×${m.exact}</b>${m.close ? `<span class="muted small">+${m.close} close</span>` : ''}</li>`).join('')}</ul>` : ''}`;
}

function sessionDetailHTML(s, fb) {
  const sc = s.scores || {};
  const areaChips = Object.keys(AREAS).filter((a) => sc[a] != null).map((a) => scoreChip(AREAS[a], sc[a], TARGETS[a])).join('');
  const hits = Object.entries(s.hits || {}).filter(([, n]) => n);
  return `
    <div class="scores">
      ${sc.overall != null ? scoreChip('Overall', sc.overall) : ''}
      ${s.punches?.total ? scoreChip('Punches', s.punches.total, -1) : ''}
      ${outputPpm(s) != null ? scoreChip('Per min', outputPpm(s), -1) : ''}
      ${s.completedRounds != null ? scoreChip('Rounds', `${s.completedRounds}/${s.plan?.rounds ?? s.completedRounds}`, -1) : ''}
    </div>
    ${s.source === 'video' ? `<p class="small muted">From video analysis${s.corrections ? ` · ${s.corrections} detections corrected by you` : ''}.</p>` : ''}
    ${areaChips ? `<h3>Breakdown</h3><div class="scores">${areaChips}</div>` : ''}
    ${fb ? `
      ${fb.wins.length ? `<h3>What went well</h3><ul class="fb good">${fb.wins.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${fb.fixes.length ? `<h3>Work on</h3><ul class="fb bad">${fb.fixes.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${fb.drills.length ? `<h3>Drills for next time</h3><ul class="fb">${fb.drills.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}` : ''}
    ${fatigueTable(s)}
    ${(s.constraints || []).length ? `<h3>Constraint rounds</h3><ul class="small">${s.constraints.map((c) => `<li>R${c.round} ${esc(CONSTRAINTS[c.key]?.name || c.key)}${c.opponent ? ` vs ${esc(OPPONENTS[c.opponent].name.toLowerCase())}` : ''}: ${c.compliance != null ? `${c.compliance}%${c.auto ? ' (camera)' : ''}` : 'not rated'}</li>`).join('')}</ul>` : ''}
    ${hits.length ? `<h3>Why you got hit</h3><ul class="small">${hits.map(([k, n]) => `<li>${esc(HIT_REASONS[k]?.name || k)}: ${n}</li>`).join('')}</ul>` : ''}
    ${(s.positives || []).length ? `<p class="small"><b>What worked:</b> ${s.positives.map((k) => esc(POSITIVES[k]?.name || k)).join(', ')}</p>` : ''}
    ${s.punches?.byType ? `<h3>Punch mix</h3>${punchBreakdown(s.punches.byType)}` : ''}
    ${s.form?.comboShare != null ? `<p class="small muted">${s.form.comboShare}% of punches thrown in combinations · average combo ${s.form.avgComboLen ?? '–'} punches</p>` : ''}
    ${combosHTML(s)}
    ${roundsTable(s)}
    ${s.form?.handReturnMs != null ? `<p class="small muted">Hand return: lead ${s.form.leadReturnMs ?? '–'} ms · rear ${s.form.rearReturnMs ?? '–'} ms · rear hand dropped on ${s.form.rearDropPct ?? 0}% of lead punches</p>` : ''}
    ${s.intensity ? `<p class="small muted">Average punch intensity: ${s.intensity} m/s²</p>` : ''}
    ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}`;
}

function renderSummary(session) {
  const { memory: preview, events } = updateMemory(state.memory, session, state.profile);
  const fb = feedback(session, state.sessions, preview, state.profile);
  $$('.tabs a').forEach((a) => a.classList.remove('active'));
  view.innerHTML = `
    <section class="card">
      <div class="eyebrow">Session complete · ${fmt(session.workSec)} of work</div>
      <h1>${ALL_TYPES[session.type]}</h1>
      ${events.newPRs.length ? `<div class="pr">🏆 New personal record: ${events.newPRs.map(esc).join(', ')}</div>` : ''}
      ${events.resolved.length ? `<div class="pr">✅ Habit fixed: ${events.resolved.map((k) => esc(INSIGHTS[k].text)).join(' ')}</div>` : ''}
      ${events.confirmed.length ? `<div class="pr warn">🧠 I'm noticing a pattern: ${events.confirmed.map((k) => esc(INSIGHTS[k].text)).join(' ')}</div>` : ''}
      ${sessionDetailHTML(session, fb)}
    </section>
    <section class="card">
      <form id="saveForm" class="form">
        ${reviewFieldsHTML(session, state)}
        <label><span>How hard was that? <b id="rpeOut">7</b>/10</span>
          <input type="range" name="rpe" min="1" max="10" value="7">
        </label>
        <div class="rpe-scale"><span>Easy</span><span>Max effort</span></div>
        <label>Notes (how you felt, what clicked)<textarea name="notes" rows="3" maxlength="1000"></textarea></label>
        <button class="btn primary block big" type="submit">Save session</button>
        <div class="row2" style="margin-top:0">
          <button class="btn ghost" type="button" id="copyReport">Copy report for coach</button>
          <button class="btn ghost" type="button" id="discard">Discard</button>
        </div>
      </form>
    </section>`;
  const f = $('#saveForm');
  bindReview(f);
  f.rpe.addEventListener('input', () => { $('#rpeOut').textContent = f.rpe.value; });
  $('#discard').addEventListener('click', () => {
    if (confirm('Discard this session?')) { location.hash = '#home'; route(); }
  });
  $('#copyReport').addEventListener('click', () => {
    readReview(f, session, state);
    session.rpe = +f.rpe.value;
    session.notes = f.notes.value.trim();
    copyReport(session);
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    readReview(f, session, state);
    session.rpe = +f.rpe.value;
    session.notes = f.notes.value.trim();
    saveSession(session);
    location.hash = '#home';
    route();
    toast('Saved. The model has been updated.');
  });
}

// Copies a text report to paste into a chat. Falls back to a selectable text box.
async function copyReport(session) {
  const text = buildReport(session, state, APP_VERSION);
  try {
    await navigator.clipboard.writeText(text);
    toast(`Report copied (${reportSize(text)}). Paste it into your chat with Claude.`);
    return;
  } catch { /* fall through to manual copy */ }
  let d = $('#reportDlg');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'reportDlg';
    document.body.appendChild(d);
  }
  d.innerHTML = `
    <div class="dialog-body">
      <h2>Coach report</h2>
      <p class="muted small">Select all and copy, then paste it into your chat with Claude. It contains measurements only, no video.</p>
      <textarea readonly rows="10" style="font-size:12px">${esc(text)}</textarea>
      <div class="row2">
        ${navigator.share ? '<button class="btn ghost" data-share>Share…</button>' : '<span></span>'}
        <button class="btn primary" data-close>Done</button>
      </div>
    </div>`;
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ title: 'BoxCoach report', text }).catch(() => {}));
  d.showModal();
  const ta = d.querySelector('textarea');
  ta.focus();
  ta.select();
}

function saveSession(session) {
  session.scores = session.type in BOXING_TYPES ? scoreSession(session, state.profile) : {};
  const { memory } = updateMemory(state.memory, session, state.profile);
  session.feedback = feedback(session, state.sessions, memory, state.profile);
  state.memory = memory;
  state.sessions.push(session);
  state.sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
  persist();
  afterDataChange();
}

// Keep derived knowledge current: step experiments and record AI observations.
function afterDataChange() {
  const now = new Date();
  let changed = false;
  state.hypotheses = state.hypotheses.map((h) => {
    const next = stepHypothesis(h, state, now);
    if (next.status !== h.status && next.result) {
      changed = true;
      state.observations.push({ id: store.newId(), date: now.toISOString(), source: 'ai', kind: 'note', key: `hyp:${h.id}`, text: `Hypothesis #${h.n} ${next.status}: ${next.result.text}.`, tags: [] });
    }
    return next;
  });
  if (changed) version++;
  const ctx = app.model();
  for (const o of aiObservations(ctx, state)) {
    const existing = state.observations.find((x) => x.source === 'ai' && x.key === o.key);
    if (existing) { existing.text = o.text; existing.lastSeen = now.toISOString(); } else {
      state.observations.push({ id: store.newId(), date: now.toISOString(), source: 'ai', kind: 'issue', status: 'open', ...o });
    }
  }
  persist();
}

function rebuildMemory() {
  let mem = store.defaultState().memory;
  for (const s of state.sessions) mem = updateMemory(mem, s, state.profile).memory;
  state.memory = mem;
}

// ---------------------------------------------------------------------------
// Weekly plan

const LOG_TYPE = { gym: 'sparring', intervals: 'run', easyRun: 'run', strength: 'strength', mobility: 'mobility', fightSim: 'bag', bagVolume: 'bag', shadowTech: 'shadow' };
const STATUS_LABEL = { done: '✓ done', missed: 'missed', moved: 'moved', today: 'today' };

function planInputs(gymDays, keep) {
  const prev = state.plans[weekKey(new Date(Date.now() - 7 * 86400000))];
  const ctx = app.model();
  return {
    profile: state.profile, memory: state.memory, sessions: state.sessions, weights: state.weights,
    gymDays, lastWeek: prev ? weekCompletion(prev, state.sessions) : null, fromDay: todayIndex(), keep,
    recovery: recoveryStatus(state), interventions: ctx.interventions,
  };
}

function currentPlan() {
  const key = weekKey();
  if (!state.plans[key]) {
    const prev = state.plans[weekKey(new Date(Date.now() - 7 * 86400000))];
    state.plans[key] = buildWeek(planInputs(prev?.gymDays || [], []));
    for (const k of Object.keys(state.plans).sort().slice(0, -8)) delete state.plans[k];
    persist();
  }
  const { plan, moves } = rebalance(state.plans[key], state.sessions);
  if (moves.length) {
    state.plans[key] = plan;
    persist();
    const m = moves[0];
    toast(`Missed ${m.title.split(' ·')[0].toLowerCase()} — moved it to ${DAY_NAMES[(new Date(m.to + 'T12:00:00').getDay() + 6) % 7]}.`);
  }
  return state.plans[key];
}

function rebuildPlan(gymDays) {
  const key = weekKey();
  state.plans[key] = buildWeek(planInputs(gymDays, state.plans[key]?.items || []));
  persist();
}

function todayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function planItemHTML(it, st) {
  const canStart = it.preset && st !== 'done' && st !== 'moved' && st !== 'missed';
  const canLog = it.kind !== 'rest' && st !== 'done' && st !== 'moved';
  return `
    <div class="plan-item ${st || ''}">
      <div>
        <b><span class="load ${it.load}"></span>${esc(it.title)}</b>${STATUS_LABEL[st] ? `<span class="st ${st}">${STATUS_LABEL[st]}</span>` : ''}
        <p>${esc(it.detail)}${it.rescheduled ? ` <i>(moved from ${DAY_NAMES[(new Date(it.from + 'T12:00:00').getDay() + 6) % 7]})</i>` : ''}</p>
      </div>
      ${canStart ? `<button class="btn primary" data-action="start-item" data-id="${it.id}">Start</button>`
        : canLog ? `<a class="btn ghost" href="#log/${LOG_TYPE[it.kind] || 'conditioning'}">Log</a>` : ''}
    </div>`;
}

function renderPlan() {
  const sub = subOf('week');
  const plan = currentPlan();
  const nav = subnav('plan', [['week', 'Week'], ['weight', 'Weight']], sub);
  const head = pageHead(sub === 'weight' ? 'Weight' : plan.phase.name, {
    eyebrow: sub === 'weight' ? esc(`Target ${state.profile.targetWeight ? `${state.profile.targetWeight} ${state.profile.unit}` : 'not set'}`) : esc(`Week of ${fmtDate(plan.week + 'T12:00:00')}${plan.phase.days != null ? ` · ${plan.phase.days} days to fight` : ''}`),
    nav,
  });
  if (sub === 'weight') return renderWeight(head);

  const status = planStatus(plan, state.sessions);
  const comp = weekCompletion(plan, state.sessions);
  const today = localDay(new Date());
  const { profile } = state;
  view.innerHTML = `
    ${head}
    <section class="card">
      <div class="card-head"><h2>${comp.done} of ${comp.planned} sessions done</h2><span class="muted small">${profile.fight.rounds} × ${fmt(profile.fight.roundSec)} fight</span></div>
      <div class="bar" style="margin-top:0"><div style="width:${comp.planned ? (comp.done / comp.planned) * 100 : 0}%"></div></div>
      <h3>Gym days</h3>
      <div class="daychips">${DAY_NAMES.map((n, d) => `<button type="button" data-gym="${d}" class="${plan.gymDays.includes(d) ? 'on' : ''}" aria-pressed="${plan.gymDays.includes(d)}">${n}</button>`).join('')}</div>
      <p class="muted small">Tap the days you'll be at the gym; the rest of the week is rebuilt around them.</p>
      ${plan.notes.length ? `<ul class="plan-notes">${plan.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </section>

    <section class="card">
      <ul class="week">${DAY_NAMES.map((name, d) => {
        const items = plan.items.filter((i) => i.day === d);
        const date = localDay(new Date(new Date(plan.week + 'T12:00:00').getTime() + d * 86400000));
        const cls = date === today ? 'today' : date < today ? 'past' : '';
        return `<li class="${cls}">
          <div class="week-day"><span>${name}</span><b>${new Date(date + 'T12:00:00').getDate()}</b></div>
          <div>${items.length ? items.map((it) => planItemHTML(it, status[it.id] === 'today' ? '' : status[it.id])).join('') : '<p class="muted small" style="margin:6px 0">Before this plan started.</p>'}</div>
        </li>`;
      }).join('')}</ul>
      <div class="legend"><span><span class="load hard"></span>Hard</span><span><span class="load moderate"></span>Moderate</span><span><span class="load easy"></span>Easy</span></div>
    </section>`;

  $$('[data-gym]').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.gym;
    rebuildPlan(plan.gymDays.includes(d) ? plan.gymDays.filter((x) => x !== d) : [...plan.gymDays, d]);
    renderPlan();
  }));
}

function renderWeight(head) {
  const { profile } = state;
  const ws = weightStats(state.weights, profile);
  const today = localDay(new Date());
  const logged = state.weights.find((w) => w.date === today)?.value;
  view.innerHTML = `
    ${head}
    <section class="card">
      <h2>Log today's weight</h2>
      <form id="weightForm" class="weight-row" style="margin-top:0">
        <label>Morning weight (${esc(profile.unit)})
          <input type="number" name="w" step="0.1" min="50" max="400" inputmode="decimal" required value="${logged ?? ''}" placeholder="e.g. 160.0">
        </label>
        <button class="btn primary" type="submit">Save</button>
      </form>
      <p class="muted small" style="margin-top:8px">Same time each day, after the bathroom, before food. The 7-day average matters, not single days.</p>
    </section>
    ${ws ? `
    <section class="card">
      <div class="stats4">
        <div><b>${ws.latest.value}</b><span>latest</span></div>
        <div><b>${ws.avg7}</b><span>7-day avg</span></div>
        <div><b>${ws.weeklyChange != null ? (ws.weeklyChange > 0 ? '+' : '') + ws.weeklyChange : '–'}</b><span>${esc(profile.unit)} / week</span></div>
        <div><b>${ws.toTarget != null ? ws.toTarget : '–'}</b><span>to target</span></div>
      </div>
      <div class="msg ${ws.status}">${esc(ws.message)}</div>
      <div id="c-weight" style="margin-top:12px"></div>
    </section>` : ''}
    ${profile.targetWeight ? '' : `<section class="card"><p class="small" style="margin:0">Pick your weight class in <a href="#coach/settings">Settings</a> to set a target.</p></section>`}`;

  if (ws) {
    const pts = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-30).map((w) => ({ x: shortDate(w.date + 'T12:00:00'), y: w.value }));
    const vals = pts.map((p) => p.y).concat(profile.targetWeight ? [profile.targetWeight] : []);
    lineChart($('#c-weight'), pts, { min: Math.floor(Math.min(...vals) - 2), max: Math.ceil(Math.max(...vals) + 2), unit: ` ${profile.unit}`, target: profile.targetWeight, label: 'Bodyweight' });
  }
  $('#weightForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = Math.round(+e.target.w.value * 10) / 10;
    if (!(value > 0)) return;
    state.weights = state.weights.filter((w) => w.date !== today).concat({ date: today, value });
    persist();
    toast('Weight saved.');
    renderPlan();
  });
}

// ---------------------------------------------------------------------------
// Log

const TYPE_ICON = { shadow: '🥊', bag: '🎯', mitts: '🧤', sparring: '⚔️', rope: '➰', run: '🏃', strength: '🏋️', conditioning: '🔥', mobility: '🧘' };

function renderLog() {
  const list = [...state.sessions].reverse();
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const groups = [];
  const wkStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const thisWeek = +wkStart(now);
  for (const s of list) {
    const w = +wkStart(s.date);
    const label = w === thisWeek ? 'This week' : w === thisWeek - 7 * 86400000 ? 'Last week' : `Week of ${new Date(w).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(s);
  }
  view.innerHTML = `
    ${pageHead('Log', { eyebrow: `${list.length} sessions` })}
    <section class="card">
      <details class="add">
        <summary class="btn primary block" style="margin-top:0">+ Log a session</summary>
        <form id="manual" class="form">
          <label>Type<select name="type">${Object.entries(ALL_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <div class="row2">
            <label>When<input type="datetime-local" name="date" value="${localNow}" required></label>
            <label>Minutes<input type="number" name="durationMin" min="1" max="600" value="45" required></label>
          </div>
          <div class="row2 boxing-only">
            <label>Rounds<input type="number" name="rounds" min="0" max="30" placeholder="optional"></label>
            <label>Punches<input type="number" name="punches" min="0" placeholder="optional"></label>
          </div>
          <div id="reviewBox"></div>
          <label>Effort (1–10)<input type="number" name="rpe" min="1" max="10" value="7"></label>
          <label>Notes<textarea name="notes" rows="2" maxlength="1000" placeholder="What the coach said, what clicked, distance, weights…"></textarea></label>
          <button class="btn primary block" type="submit">Add to log</button>
        </form>
      </details>
    </section>
    ${groups.map((g) => `
      <div class="section-label">${esc(g.label)}</div>
      <section class="card"><div class="rows">${g.items.map((s) => `
        <button class="row log-item" data-id="${s.id}">
          <span class="row-ico">${TYPE_ICON[s.type] || '•'}</span>
          <div class="log-main">
            <b>${ALL_TYPES[s.type] || esc(s.type)}${s.source === 'video' ? ' · video' : ''}</b>
            <span>${fmtDate(s.date)} · ${s.durationMin ? `${s.durationMin} min` : `${s.completedRounds ?? 0}/${s.plan?.rounds ?? 0} rds`}${s.punches?.total ? ` · ${s.punches.total} punches` : ''}${s.hits ? ` · ${Object.values(s.hits).reduce((a, b) => a + b, 0)} hits` : ''}${s.rpe ? ` · RPE ${s.rpe}` : ''}</span>
          </div>
          ${s.scores?.overall != null ? `<span class="badge ${scoreClass(s.scores.overall)}">${s.scores.overall}</span>` : '<span class="chev">›</span>'}
        </button>`).join('')}</div></section>`).join('') || '<p class="muted center">No sessions yet.</p>'}
    <dialog id="detail"></dialog>`;

  const mf = $('#manual');
  const pre = location.hash.split('/')[1];
  if (pre && pre in ALL_TYPES) {
    mf.type.value = pre;
    mf.closest('details').open = true;
  }
  const refresh = () => {
    mf.querySelector('.boxing-only').hidden = !(mf.type.value in BOXING_TYPES);
    $('#reviewBox').innerHTML = reviewFieldsHTML({ type: mf.type.value }, state);
    bindReview($('#reviewBox'));
  };
  mf.type.addEventListener('change', refresh);
  refresh();
  mf.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(mf);
    const type = fd.get('type');
    const mins = +fd.get('durationMin');
    const s = {
      id: store.newId(), manual: true, type, source: 'manual',
      date: new Date(fd.get('date')).toISOString(),
      durationMin: mins, workSec: mins * 60, rpe: +fd.get('rpe') || null,
      notes: String(fd.get('notes') || '').trim(),
    };
    if (type in BOXING_TYPES) {
      const rounds = +fd.get('rounds');
      const punches = +fd.get('punches');
      if (rounds) { s.completedRounds = rounds; s.plan = { rounds, roundSec: 180, restSec: 60 }; }
      if (punches) s.punches = { total: punches, perRound: [], byType: null };
    }
    readReview(mf, s, state);
    saveSession(s);
    toast('Logged. The model has been updated.');
    renderLog();
  });
  $$('.log-item').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
}

function openDetail(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const d = $('#detail');
  d.innerHTML = `
    <div class="dialog-body">
      <div class="eyebrow">${fmtDate(s.date)}</div>
      <h2>${ALL_TYPES[s.type] || esc(s.type)}</h2>
      ${sessionDetailHTML(s, s.feedback)}
      ${s.type in BOXING_TYPES ? '<button class="btn ghost block" data-report>Copy report for coach</button>' : ''}
      <div class="row2">
        <button class="btn danger" data-del>Delete</button>
        <button class="btn primary" data-close>Close</button>
      </div>
    </div>`;
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.querySelector('[data-report]')?.addEventListener('click', () => { d.close(); copyReport(s); });
  d.querySelector('[data-del]').addEventListener('click', () => {
    if (!confirm('Delete this session? The coach will recalculate everything.')) return;
    state.sessions = state.sessions.filter((x) => x.id !== id);
    rebuildMemory();
    persist();
    d.close();
    renderLog();
  });
  d.showModal();
}

// ---------------------------------------------------------------------------

view.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  if (a.dataset.action === 'start-item') {
    const it = currentPlan().items.find((x) => x.id === a.dataset.id);
    if (!it?.preset) return;
    const tracking = it.preset.tracking === 'motion' && !motionSupported() ? state.settings.tracking : it.preset.tracking;
    const ctx = app.model();
    // Technique sessions get constraint rounds from the engine.
    const rounds_ = it.kind === 'shadowTech' ? generateFor(it.preset.rounds, ctx) : null;
    startSession({ combos: state.settings.combos, focus: state.memory.focus?.area || null, ...it.preset, tracking, rounds_ });
  }
});

document.addEventListener('visibilitychange', async () => {
  if (live && document.visibilityState === 'visible' && live.wakeLock?.released) {
    try { live.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Reload once when a new version takes over, so the new code runs straight away.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded && !live) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}

afterDataChange();
route();
