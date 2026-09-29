import * as store from './store.js';
import {
  AREAS, TARGETS, ALL_TYPES, BOXING_TYPES, OTHER_TYPES, INSIGHTS, DRILLS,
  scoreSession, feedback, updateMemory, suggestWorkout, nextCombo, comboToSpeech,
  weekSummary, outputPpm,
} from './coach.js';
import { FormAnalyzer, combineRounds, PUNCH_NAMES } from './form.js';
import { requestMotionPermission, startMotion, motionSupported } from './motion.js';
import { RoundTimer, fmt } from './timer.js';
import * as audio from './audio.js';
import { lineChart } from './chart.js';
import {
  DAY_NAMES, buildWeek, planStatus, rebalance, weekCompletion, weekKey, weightStats, localDay,
} from './plan.js';

let state = store.load();
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const persist = () => {
  if (!store.save(state)) toast('Could not save — storage is full or blocked.');
};
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._id);
  toast._id = setTimeout(() => { t.hidden = true; }, 3200);
}

function scoreClass(v, target = 75) {
  if (v == null) return '';
  return v >= target ? 'good' : v >= target - 20 ? 'warn' : 'bad';
}

function scoreChip(label, v, target) {
  const cls = scoreClass(v, target);
  const icon = cls === 'good' ? '✓' : cls === 'warn' ? '!' : cls === 'bad' ? '✕' : '';
  return `<div class="score ${cls}"><span class="score-v">${v ?? '–'}</span><span class="score-l">${icon ? `<i>${icon}</i>` : ''}${label}</span></div>`;
}

// ---------------------------------------------------------------------------
// Routing

const routes = { home: renderHome, plan: renderPlan, train: renderTrain, log: renderLog, progress: renderProgress, coach: renderCoach };

function route() {
  const name = (location.hash.slice(1) || 'home').split('/')[0];
  const fn = routes[name] || renderHome;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  fn();
  renderStreak();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function renderStreak() {
  const s = state.memory.streak;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const alive = s.lastDay && (new Date(today) - new Date(s.lastDay)) / 86400000 <= 1;
  $('#streak').innerHTML = alive && s.count > 0 ? `🔥 ${s.count} day${s.count > 1 ? 's' : ''}` : '';
}

// ---------------------------------------------------------------------------
// Home

function renderHome() {
  const { profile, memory, sessions } = state;
  const sug = suggestWorkout(sessions, memory, profile);
  const wk = weekSummary(sessions);
  const focus = memory.focus?.area;
  const habits = Object.entries(memory.insights).filter(([, v]) => v.count >= 2).sort((a, b) => b[1].count - a[1].count);
  const last = sessions[sessions.length - 1];
  const plan = currentPlan();
  const status = planStatus(plan, sessions);
  const today = localDay(new Date());
  const todays = plan.items.filter((i) => i.date === today && !i.moved);
  const ws = weightStats(state.weights, profile);

  view.innerHTML = `
    ${!sessions.length ? `
      <section class="card hero">
        <h1>Welcome${profile.name ? `, ${esc(profile.name)}` : ''} 👊</h1>
        <p>I'm your pocket boxing coach. Prop your phone up, train, and I'll watch your guard, stance and footwork, count your punches, and remember your habits so every session builds on the last.</p>
        <ol class="steps">
          <li>Check your fight format and target weight in <a href="#coach">Coach</a>.</li>
          <li>Tap your gym days for this week in <a href="#plan">Plan</a>. I'll build the rest of the week around them.</li>
          <li>Train, then log gym sessions, runs and strength in <a href="#log">Log</a>.</li>
        </ol>
      </section>` : ''}

    <section class="card today-card">
      <div class="eyebrow">Today · ${esc(plan.phase.name)}</div>
      ${todays.map((it) => planItemHTML(it, status[it.id] === 'today' ? '' : status[it.id])).join('')}
      <a class="small" href="#plan">Full week →</a>
    </section>

    <section class="card coach-card">
      <div class="eyebrow">Technique focus</div>
      ${focus ? `
        <h2>${AREAS[focus]}</h2>
        <p class="muted">Your ${AREAS[focus].toLowerCase()} score is averaging <b>${memory.ema[focus]}</b> (target ${TARGETS[focus]}).</p>
        <ul class="drills">${DRILLS[focus].slice(0, 2).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
        : `<h2>Build your baseline</h2><p class="muted">Do a camera session and I'll find what to work on first.</p>`}
    </section>

    ${todays.some((i) => i.preset) ? '' : `
    <section class="card">
      <div class="eyebrow">Extra session?</div>
      <h2>${sug.rounds} × ${fmt(sug.roundSec)} ${ALL_TYPES[sug.type]}</h2>
      <p class="muted">${esc(sug.reason)}</p>
      <button class="btn primary block" data-action="start-suggested">Start this workout</button>
    </section>`}

    ${ws ? `
    <section class="card">
      <div class="eyebrow">Weight</div>
      <div class="stats4">
        <div><b>${ws.latest.value}</b><span>latest ${esc(profile.unit)}</span></div>
        <div><b>${ws.avg7}</b><span>7-day avg</span></div>
        <div><b>${ws.weeklyChange != null ? (ws.weeklyChange > 0 ? '+' : '') + ws.weeklyChange : '–'}</b><span>per week</span></div>
        <div><b>${ws.toTarget != null ? ws.toTarget : '–'}</b><span>to target</span></div>
      </div>
      <a class="small" href="#plan">Log weight →</a>
    </section>` : ''}

    <section class="card">
      <div class="eyebrow">This week</div>
      <div class="stats4">
        <div><b>${wk.days}/${profile.weeklyGoal}</b><span>training days</span></div>
        <div><b>${wk.minutes}</b><span>minutes</span></div>
        <div><b>${wk.punches.toLocaleString()}</b><span>punches</span></div>
        <div><b>${wk.sessions}</b><span>sessions</span></div>
      </div>
      <div class="bar"><div style="width:${Math.min(100, (wk.days / profile.weeklyGoal) * 100)}%"></div></div>
    </section>

    ${last ? `
      <section class="card">
        <div class="eyebrow">Last session · ${fmtDate(last.date)}</div>
        <h2>${ALL_TYPES[last.type] || last.type}</h2>
        ${last.scores?.overall != null ? `<div class="scores">${scoreChip('overall', last.scores.overall)}${last.punches?.total ? scoreChip('punches', last.punches.total, -1) : ''}${outputPpm(last) != null ? scoreChip('per min', outputPpm(last), -1) : ''}</div>` : ''}
        ${last.feedback?.fixes?.length ? `<p class="small"><b>Fix next time:</b> ${esc(last.feedback.fixes[0])}</p>` : ''}
        <a class="small" href="#log">See all sessions →</a>
      </section>` : ''}

    ${habits.length ? `
      <section class="card">
        <div class="eyebrow">Habits I'm watching</div>
        <ul class="habits">${habits.slice(0, 3).map(([k, v]) => `<li>${esc(INSIGHTS[k].text)} <span class="muted">· ${v.count}×</span></li>`).join('')}</ul>
        <a class="small" href="#coach">What I remember →</a>
      </section>` : ''}
  `;
}

// ---------------------------------------------------------------------------
// Train setup

let draft = null;

function renderTrain() {
  const sug = suggestWorkout(state.sessions, state.memory, state.profile);
  draft = draft || {
    type: sug.type, rounds: sug.rounds, roundSec: sug.roundSec, restSec: sug.restSec,
    tracking: state.settings.tracking, combos: state.settings.combos, comboLevel: sug.comboLevel,
  };
  const types = ['shadow', 'bag', 'mitts', 'sparring', 'rope', 'conditioning'];
  const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  const secs = [20, 30, 60, 90, 120, 150, 180, 240, 300];
  const rests = [0, 10, 15, 30, 45, 60, 90, 120];

  view.innerHTML = `
    <section class="card">
      <h1>Train</h1>
      <div class="chips">
        <button class="chip" data-preset="suggested">Suggested</button>
        <button class="chip" data-preset="fight">Fight sim ${state.profile.fight.rounds}×${fmt(state.profile.fight.roundSec)}</button>
        <button class="chip" data-preset="3x2">Beginner 3×2</button>
        <button class="chip" data-preset="6x3">Amateur 6×3</button>
        <button class="chip" data-preset="12x3">Pro 12×3</button>
        <button class="chip" data-preset="tabata">Tabata 8×20s</button>
      </div>
      <form id="setup" class="form">
        <label>Workout
          <select name="type">${types.map((t) => opt(t, draft.type, ALL_TYPES[t])).join('')}</select>
        </label>
        <div class="row3">
          <label>Rounds<select name="rounds">${Array.from({ length: 15 }, (_, i) => opt(i + 1, draft.rounds, i + 1)).join('')}</select></label>
          <label>Round<select name="roundSec">${secs.map((s) => opt(s, draft.roundSec, fmt(s))).join('')}</select></label>
          <label>Rest<select name="restSec">${rests.map((s) => opt(s, draft.restSec, fmt(s))).join('')}</select></label>
        </div>
        <fieldset>
          <legend>Tracking</legend>
          <label class="radio"><input type="radio" name="tracking" value="camera" ${draft.tracking === 'camera' ? 'checked' : ''}>
            <span><b>Camera coach</b> — prop the phone up 2–3 m away with your whole body in frame. Counts &amp; classifies punches, checks guard, stance, footwork, head movement.</span></label>
          <label class="radio"><input type="radio" name="tracking" value="motion" ${draft.tracking === 'motion' ? 'checked' : ''} ${motionSupported() ? '' : 'disabled'}>
            <span><b>Phone in hand / on wrist</b> — counts punches with the motion sensor. Great for bag work.</span></label>
          <label class="radio"><input type="radio" name="tracking" value="none" ${draft.tracking === 'none' ? 'checked' : ''}>
            <span><b>Timer only</b> — rounds and effort, with optional tap counting.</span></label>
        </fieldset>
        <label class="switch"><input type="checkbox" name="combos" ${draft.combos ? 'checked' : ''}> <span>Call out combos</span></label>
        <label>Combo difficulty
          <select name="comboLevel">${opt(1, draft.comboLevel, 'Basic (1-2s)')}${opt(2, draft.comboLevel, 'Intermediate (hooks, slips)')}${opt(3, draft.comboLevel, 'Advanced (pivots, rolls)')}</select>
        </label>
        <p class="muted small">Total time: <b id="totalTime"></b>${state.memory.focus ? ` · Focus: <b>${AREAS[state.memory.focus.area]}</b>` : ''}</p>
        <button class="btn primary block big" type="submit">Start</button>
      </form>
    </section>
    <section class="card tips">
      <h3>Camera setup tips</h3>
      <ul>
        <li>Phone upright at waist height, facing you, 2–3 m back.</li>
        <li>Head to feet in frame; good light in front of you, not behind.</li>
        <li>Face the camera the way you'd face an opponent.</li>
        <li>Video is analysed on your phone and never uploaded.</li>
      </ul>
    </section>`;

  const form = $('#setup');
  const sync = () => {
    const fd = new FormData(form);
    draft = {
      type: fd.get('type'), rounds: +fd.get('rounds'), roundSec: +fd.get('roundSec'), restSec: +fd.get('restSec'),
      tracking: fd.get('tracking'), combos: fd.get('combos') === 'on', comboLevel: +fd.get('comboLevel'),
    };
    const total = draft.rounds * draft.roundSec + (draft.rounds - 1) * draft.restSec;
    $('#totalTime').textContent = fmt(total);
  };
  form.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sync();
    state.settings.tracking = draft.tracking;
    state.settings.combos = draft.combos;
    persist();
    startSession({ ...draft, focus: state.memory.focus?.area || null });
  });
  view.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    const presets = {
      suggested: { type: sug.type, rounds: sug.rounds, roundSec: sug.roundSec, restSec: sug.restSec, comboLevel: sug.comboLevel },
      fight: { type: 'bag', ...state.profile.fight, comboLevel: 3 },
      '3x2': { rounds: 3, roundSec: 120, restSec: 60 },
      '6x3': { rounds: 6, roundSec: 180, restSec: 60 },
      '12x3': { rounds: 12, roundSec: 180, restSec: 60 },
      tabata: { rounds: 8, roundSec: 20, restSec: 10, combos: false },
    };
    draft = { ...draft, ...presets[p] };
    renderTrain();
  }));
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

  const el = $('#live');
  el.hidden = false;
  document.body.classList.add('in-live');
  $('#camBox').hidden = tracking !== 'camera';
  $('#tapCount').hidden = tracking !== 'none' || !(plan.type in BOXING_TYPES);
  $('#liveCombo').textContent = '';
  $('#liveCue').textContent = '';
  ['#livePunches'].forEach((s) => { $(s).textContent = '0'; });
  ['#livePpm', '#liveGuard', '#liveStance'].forEach((s) => { $(s).textContent = '–'; });
  $('#liveGuard').parentElement.hidden = tracking !== 'camera';
  $('#liveStance').parentElement.hidden = tracking !== 'camera';

  live = {
    plan, tracking, startedAt: new Date().toISOString(), t0: performance.now(),
    total: 0, roundPunches: 0, perRound: [], formRounds: [], intensity: [],
    byType: tracking === 'camera' ? { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 } : null,
    completedRounds: 0, comboTimer: null, stopMotion: null, analyzer: null, tracker: null, wakeLock: null,
  };

  try { live.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }

  const countPunch = (type) => {
    if (!live || live.timer?.phase !== 'work') return;
    live.total++;
    live.roundPunches++;
    if (type && live.byType) live.byType[type]++;
    $('#livePunches').textContent = live.total;
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
    onPhase: onPhase, onTick: onTick,
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
  if (workMin > 0.15 && (live.tracking !== 'none' || live.total)) {
    $('#livePpm').textContent = Math.round(live.total / workMin);
  }
}

function closeRound() {
  if (!live) return;
  live.perRound.push(live.roundPunches);
  if (live.analyzer) live.formRounds.push(live.analyzer.endRound());
  live.roundPunches = 0;
  clearInterval(live.comboTimer);
  $('#liveCombo').textContent = '';
}

function roundReport(n) {
  const punches = live.perRound[live.perRound.length - 1];
  const f = live.formRounds[live.formRounds.length - 1];
  const bits = [`Round ${n} done.`];
  if (live.tracking !== 'none' && punches != null) bits.push(`${punches} punches.`);
  if (f && f.frames > 30) {
    const issues = [];
    if (f.guard != null && f.guard < TARGETS.guard) issues.push([TARGETS.guard - f.guard, `Guard was up ${f.guard} percent. Keep your hands home.`]);
    if (f.crossedPct >= 5) issues.push([20, 'You crossed your feet. Step with the near foot.']);
    if (f.stance != null && f.stance < TARGETS.stance) issues.push([TARGETS.stance - f.stance, 'Hold your stance width when you move.']);
    if (f.footwork != null && f.footwork < 30) issues.push([15, 'Move your feet more.']);
    if (f.head != null && f.head < 25) issues.push([12, 'Move your head after you punch.']);
    issues.sort((a, b) => b[0] - a[0]);
    bits.push(issues.length ? issues[0][1] : 'Good form that round. Keep it up.');
  }
  return bits.join(' ');
}

function onPhase(phase, round) {
  if (!live) return;
  const t = live.timer;
  const label = { prep: 'PREP', work: 'FIGHT', rest: 'REST', done: 'DONE' }[phase];
  $('#livePhase').textContent = label;
  $('#live').dataset.phase = phase;
  $('#liveRound').textContent = phase === 'prep' ? 'Get ready' : `Round ${round} / ${t.rounds}`;
  if (phase === 'prep') audio.say(`Get ready. ${live.plan.focus ? `Today's focus: ${AREAS[live.plan.focus]}.` : ''}`, { interrupt: true });
  if (phase === 'work') {
    audio.bell(1);
    audio.vibrate([200]);
    live.roundPunches = 0;
    live.analyzer?.startRound();
    if (live.plan.combos && live.plan.type !== 'rope') scheduleCombos();
  }
  if (phase === 'rest') {
    audio.bell(1);
    audio.vibrate([200, 100, 200]);
    live.completedRounds = round;
    closeRound();
    const msg = roundReport(round);
    showCue(msg);
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

function onTick(phase, secLeft) {
  updateClock();
  if (phase === 'work' && secLeft === 10) audio.clap();
  if ((phase === 'rest' || phase === 'prep') && secLeft <= 3 && secLeft > 0) audio.tick();
}

function scheduleCombos() {
  const every = state.settings.comboInterval * 1000;
  const call = () => {
    if (!live || live.timer.phase !== 'work' || live.timer.paused) return;
    const combo = nextCombo(live.plan.comboLevel, live.plan.focus);
    $('#liveCombo').textContent = combo;
    audio.say(comboToSpeech(combo), { rate: 1.3 });
  };
  setTimeout(call, 1500);
  live.comboTimer = setInterval(call, every);
}

function teardownLive() {
  if (!live) return;
  live.timer?.stop();
  clearInterval(live.comboTimer);
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
  const session = {
    id: store.newId(),
    date: l.startedAt,
    type: l.plan.type,
    tracking: l.tracking,
    plan: { rounds: l.plan.rounds, roundSec: l.plan.roundSec, restSec: l.plan.restSec },
    completedRounds: l.completedRounds,
    workSec: Math.round((t?.workMs || 0) / 1000),
    totalSec: Math.round((performance.now() - l.t0) / 1000),
    focus: l.plan.focus,
    punches: l.total || l.tracking !== 'none' ? { total: l.total, perRound: l.perRound, byType: l.byType } : null,
    intensity: l.intensity.length ? Math.round(l.intensity.reduce((a, b) => a + b, 0) / l.intensity.length) : null,
    form: l.formRounds.some((r) => r.frames > 30) ? combineRounds(l.formRounds) : null,
    rpe: 7,
    notes: '',
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
// Summary

function punchBreakdown(by) {
  if (!by) return '';
  const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  return `<div class="breakdown">${Object.entries(by).map(([k, v]) => `
    <div class="bd-row"><span>${PUNCH_NAMES[k]}</span><div class="bd-bar"><div style="width:${(v / total) * 100}%"></div></div><b>${v}</b></div>`).join('')}</div>`;
}

function roundsTable(s) {
  const pr = s.punches?.perRound || [];
  const fr = s.form?.perRound || [];
  const n = Math.max(pr.length, fr.length);
  if (!n) return '';
  const rows = Array.from({ length: n }, (_, i) => `<tr><td>R${i + 1}</td><td>${pr[i] ?? '–'}</td>${s.form ? `<td>${fr[i]?.guard ?? '–'}</td><td>${fr[i]?.stance ?? '–'}</td><td>${fr[i]?.footwork ?? '–'}</td>` : ''}</tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Round</th><th>Punches</th>${s.form ? '<th>Guard %</th><th>Stance %</th><th>Moving %</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

function sessionDetailHTML(s, fb) {
  const sc = s.scores || {};
  const areaChips = Object.keys(AREAS).filter((a) => sc[a] != null).map((a) => scoreChip(AREAS[a], sc[a], TARGETS[a])).join('');
  return `
    <div class="scores">
      ${sc.overall != null ? scoreChip('Overall', sc.overall) : ''}
      ${s.punches?.total ? scoreChip('Punches', s.punches.total, -1) : ''}
      ${outputPpm(s) != null ? scoreChip('Per min', outputPpm(s), -1) : ''}
      ${s.completedRounds != null ? scoreChip('Rounds', `${s.completedRounds}/${s.plan?.rounds ?? s.completedRounds}`, -1) : ''}
    </div>
    ${areaChips ? `<h3>Breakdown</h3><div class="scores">${areaChips}</div>` : ''}
    ${fb ? `
      ${fb.wins.length ? `<h3>What went well</h3><ul class="fb good">${fb.wins.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${fb.fixes.length ? `<h3>Work on</h3><ul class="fb bad">${fb.fixes.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${fb.drills.length ? `<h3>Drills for next time</h3><ul class="fb">${fb.drills.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}` : ''}
    ${s.punches?.byType ? `<h3>Punch mix</h3>${punchBreakdown(s.punches.byType)}` : ''}
    ${roundsTable(s)}
    ${s.form?.handReturnMs != null ? `<p class="small muted">Average hand return: ${s.form.handReturnMs} ms · Rear hand dropped on ${s.form.rearDropPct ?? 0}% of lead punches</p>` : ''}
    ${s.intensity ? `<p class="small muted">Average punch intensity: ${s.intensity} m/s²</p>` : ''}
    ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}`;
}

function renderSummary(session) {
  const { memory: preview, events } = updateMemory(state.memory, session, state.profile);
  const fb = feedback(session, state.sessions, preview, state.profile);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.remove('active'));
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
        <label><span>How hard was that? <b id="rpeOut">7</b>/10</span>
          <input type="range" name="rpe" min="1" max="10" value="7">
        </label>
        <div class="rpe-scale"><span>Easy</span><span>Max effort</span></div>
        <label>Notes (how you felt, what clicked)
          <textarea name="notes" rows="3" maxlength="1000"></textarea>
        </label>
        <button class="btn primary block big" type="submit">Save session</button>
        <button class="btn ghost block" type="button" id="discard">Discard</button>
      </form>
    </section>`;
  const f = $('#saveForm');
  f.rpe.addEventListener('input', () => { $('#rpeOut').textContent = f.rpe.value; });
  $('#discard').addEventListener('click', () => {
    if (confirm('Discard this session?')) { location.hash = '#home'; route(); }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    session.rpe = +f.rpe.value;
    session.notes = f.notes.value.trim();
    saveSession(session);
    location.hash = '#home';
    route();
    toast('Saved. I’ll remember this one.');
  });
}

function saveSession(session) {
  session.scores = session.type in BOXING_TYPES ? scoreSession(session, state.profile) : {};
  const { memory } = updateMemory(state.memory, session, state.profile);
  session.feedback = feedback(session, state.sessions, memory, state.profile);
  state.memory = memory;
  state.sessions.push(session);
  state.sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
  persist();
}

// Rebuild memory from scratch (after deleting or importing sessions).
function rebuildMemory() {
  let mem = store.defaultState().memory;
  for (const s of state.sessions) mem = updateMemory(mem, s, state.profile).memory;
  state.memory = mem;
}

// ---------------------------------------------------------------------------
// Weekly plan

const LOG_TYPE = { gym: 'sparring', intervals: 'run', easyRun: 'run', strength: 'strength', mobility: 'mobility', fightSim: 'bag', bagVolume: 'bag', shadowTech: 'shadow' };
const STATUS_LABEL = { done: '✓ done', missed: 'missed', moved: 'moved', today: 'today' };

function currentPlan() {
  const key = weekKey();
  if (!state.plans[key]) {
    const prev = state.plans[weekKey(new Date(Date.now() - 7 * 86400000))];
    state.plans[key] = buildWeek({
      profile: state.profile, memory: state.memory, sessions: state.sessions, weights: state.weights,
      gymDays: prev?.gymDays || [], lastWeek: prev ? weekCompletion(prev, state.sessions) : null, fromDay: todayIndex(),
    });
    // Keep ~8 weeks of plans.
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
  const prev = state.plans[weekKey(new Date(Date.now() - 7 * 86400000))];
  state.plans[key] = buildWeek({
    profile: state.profile, memory: state.memory, sessions: state.sessions, weights: state.weights,
    gymDays, lastWeek: prev ? weekCompletion(prev, state.sessions) : null,
    fromDay: todayIndex(), keep: state.plans[key]?.items || [],
  });
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
  const plan = currentPlan();
  const status = planStatus(plan, state.sessions);
  const comp = weekCompletion(plan, state.sessions);
  const today = localDay(new Date());
  const days = DAY_NAMES.map((name, d) => ({ name, d, items: plan.items.filter((i) => i.day === d) }));
  const { profile } = state;
  const ws = weightStats(state.weights, profile);

  view.innerHTML = `
    <section class="card">
      <div class="eyebrow">Week of ${fmtDate(plan.week + 'T12:00:00')}</div>
      <h1>${esc(plan.phase.name)}${plan.phase.days != null ? ` · ${plan.phase.days} days out` : ''}</h1>
      <p class="muted small">${esc(plan.phase.note)} Fight format: ${profile.fight.rounds} × ${fmt(profile.fight.roundSec)}.</p>
      <p class="small"><b>${comp.done}/${comp.planned}</b> sessions done</p>
      <div class="bar"><div style="width:${comp.planned ? (comp.done / comp.planned) * 100 : 0}%"></div></div>
      <h3>Gym days this week</h3>
      <div class="daychips">${DAY_NAMES.map((n, d) => `<button type="button" data-gym="${d}" class="${plan.gymDays.includes(d) ? 'on' : ''}" aria-pressed="${plan.gymDays.includes(d)}">${n}</button>`).join('')}</div>
      <p class="muted small">Tap the days you'll be at the gym. I'll rebuild the rest of the week around them.</p>
      ${plan.notes.length ? `<ul class="plan-notes">${plan.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <div class="legend"><span><span class="load hard"></span>hard</span><span><span class="load moderate"></span>moderate</span><span><span class="load easy"></span>easy</span></div>
    </section>

    ${days.map(({ name, d, items }) => {
      const date = items[0]?.date;
      const cls = date === today ? 'today' : date < today ? 'past' : '';
      return `<section class="card day ${cls}">
        <div class="day-head"><b>${name} ${date ? new Date(date + 'T12:00:00').getDate() : ''}</b>${date === today ? '<span class="st today">today</span>' : ''}</div>
        ${items.length ? items.map((it) => planItemHTML(it, status[it.id] === 'today' ? '' : status[it.id])).join('') : '<p class="muted small">Before this plan started.</p>'}
      </section>`;
    }).join('')}

    <section class="card">
      <h2>Weight</h2>
      ${ws ? `
        <div class="stats4">
          <div><b>${ws.latest.value}</b><span>latest</span></div>
          <div><b>${ws.avg7}</b><span>7-day avg</span></div>
          <div><b>${ws.weeklyChange != null ? (ws.weeklyChange > 0 ? '+' : '') + ws.weeklyChange : '–'}</b><span>${esc(profile.unit)}/week</span></div>
          <div><b>${ws.toTarget != null ? ws.toTarget : '–'}</b><span>to target</span></div>
        </div>
        <div class="msg ${ws.status}">${esc(ws.message)}</div>
        <div id="c-weight"></div>` : '<p class="muted small">Log your morning weight to see your trend.</p>'}
      ${profile.targetWeight ? '' : '<p class="muted small">Set a target weight in <a href="#coach">Coach</a>.</p>'}
      <form id="weightForm" class="weight-row">
        <label class="form-label">Today's weight (${esc(profile.unit)})
          <input type="number" name="w" step="0.1" min="20" max="400" inputmode="decimal" required value="${state.weights.find((w) => w.date === today)?.value ?? ''}">
        </label>
        <button class="btn primary" type="submit">Save</button>
      </form>
    </section>`;

  view.querySelectorAll('[data-gym]').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.gym;
    const gym = plan.gymDays.includes(d) ? plan.gymDays.filter((x) => x !== d) : [...plan.gymDays, d];
    rebuildPlan(gym);
    renderPlan();
  }));

  if (ws) {
    const pts = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
      .map((w) => ({ x: shortDate(w.date + 'T12:00:00'), y: w.value }));
    const vals = pts.map((p) => p.y).concat(profile.targetWeight ? [profile.targetWeight] : []);
    lineChart($('#c-weight'), pts, {
      min: Math.floor(Math.min(...vals) - 1), max: Math.ceil(Math.max(...vals) + 1),
      unit: ` ${profile.unit}`, target: profile.targetWeight, label: 'Bodyweight',
    });
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

function renderLog() {
  const list = [...state.sessions].reverse();
  const today = new Date();
  const localNow = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  view.innerHTML = `
    <section class="card">
      <h1>Workout log</h1>
      <details class="add">
        <summary class="btn primary block">+ Log a workout</summary>
        <form id="manual" class="form">
          <label>Type<select name="type">${Object.entries(ALL_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <div class="row2">
            <label>When<input type="datetime-local" name="date" value="${localNow}" required></label>
            <label>Minutes<input type="number" name="durationMin" min="1" max="600" value="30" required></label>
          </div>
          <div class="row2 boxing-only">
            <label>Rounds<input type="number" name="rounds" min="0" max="30" placeholder="optional"></label>
            <label>Punches<input type="number" name="punches" min="0" placeholder="optional"></label>
          </div>
          <label>Effort (1–10)<input type="number" name="rpe" min="1" max="10" value="6"></label>
          <label>Notes<textarea name="notes" rows="2" maxlength="1000" placeholder="Distance, weights, what the coach said…"></textarea></label>
          <button class="btn primary block" type="submit">Add to log</button>
        </form>
      </details>
    </section>
    ${list.length ? list.map((s) => `
      <button class="card log-item" data-id="${s.id}">
        <div class="log-main">
          <b>${ALL_TYPES[s.type] || esc(s.type)}</b>
          <span class="muted small">${fmtDate(s.date)} · ${s.durationMin ? `${s.durationMin} min` : `${s.completedRounds ?? 0}/${s.plan?.rounds ?? 0} rds`}${s.punches?.total ? ` · ${s.punches.total} punches` : ''}${s.rpe ? ` · RPE ${s.rpe}` : ''}</span>
        </div>
        ${s.scores?.overall != null ? `<span class="badge ${scoreClass(s.scores.overall)}">${s.scores.overall}</span>` : ''}
      </button>`).join('') : '<p class="muted center">No workouts yet.</p>'}
    <dialog id="detail"></dialog>`;

  const mf = $('#manual');
  const pre = location.hash.split('/')[1];
  if (pre && pre in ALL_TYPES) {
    mf.type.value = pre;
    mf.closest('details').open = true;
  }
  const toggleBoxing = () => { mf.querySelector('.boxing-only').hidden = !(mf.type.value in BOXING_TYPES); };
  mf.type.addEventListener('change', toggleBoxing);
  toggleBoxing();
  mf.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(mf);
    const type = fd.get('type');
    const mins = +fd.get('durationMin');
    const s = {
      id: store.newId(), manual: true, type,
      date: new Date(fd.get('date')).toISOString(),
      durationMin: mins, workSec: mins * 60, rpe: +fd.get('rpe') || null,
      notes: String(fd.get('notes') || '').trim(),
    };
    if (type in BOXING_TYPES) {
      const rounds = +fd.get('rounds');
      const punches = +fd.get('punches');
      if (rounds) { s.completedRounds = rounds; s.plan = { rounds, roundSec: 180, restSec: 60 }; s.workSec = rounds * 180; }
      if (punches) s.punches = { total: punches, perRound: [], byType: null };
    }
    saveSession(s);
    toast('Logged.');
    renderLog();
  });

  view.querySelectorAll('.log-item').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
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
      <div class="row2">
        <button class="btn danger" data-del>Delete</button>
        <button class="btn primary" data-close>Close</button>
      </div>
    </div>`;
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.querySelector('[data-del]').addEventListener('click', () => {
    if (!confirm('Delete this workout? The coach will recalculate its memory.')) return;
    state.sessions = state.sessions.filter((x) => x.id !== id);
    rebuildMemory();
    persist();
    d.close();
    renderLog();
  });
  d.showModal();
}

// ---------------------------------------------------------------------------
// Progress

function renderProgress() {
  const box = state.sessions.filter((s) => s.type in BOXING_TYPES && !s.manual).slice(-20);
  const pts = (fn) => box.map((s) => ({ x: shortDate(s.date), y: fn(s) })).filter((p) => p.y != null);
  const prs = Object.values(state.memory.prs);

  // Weekly minutes, last 8 weeks.
  const weeks = [];
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) {
    const start = new Date(monday);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const mins = state.sessions
      .filter((s) => new Date(s.date) >= start && new Date(s.date) < end)
      .reduce((a, s) => a + (s.durationMin || Math.round((s.totalSec || s.workSec || 0) / 60)), 0);
    weeks.push({ x: shortDate(start), y: mins });
  }

  view.innerHTML = `
    <section class="card"><h1>Progress</h1>
      ${prs.length ? `<div class="prs">${prs.map((p) => `<div><b>${p.value}</b><span>${esc(p.label)}</span><em>${shortDate(p.date)}</em></div>`).join('')}</div>` : '<p class="muted">Personal records show up after your first session.</p>'}
    </section>
    <section class="card"><h3>Overall score</h3><div id="c-overall"></div></section>
    <section class="card"><h3>Punches per minute</h3><div id="c-ppm"></div></section>
    <section class="card"><h3>Guard up %</h3><div id="c-guard"></div></section>
    <section class="card"><h3>Stance held %</h3><div id="c-stance"></div></section>
    <section class="card"><h3>Footwork score</h3><div id="c-foot"></div></section>
    <section class="card"><h3>Training minutes per week</h3><div id="c-weeks"></div></section>`;

  lineChart($('#c-overall'), pts((s) => s.scores?.overall), { max: 100, label: 'Overall score' });
  lineChart($('#c-ppm'), pts((s) => outputPpm(s)), { label: 'Punches per minute' });
  lineChart($('#c-guard'), pts((s) => s.form?.guard), { max: 100, unit: '%', target: TARGETS.guard, label: 'Guard up percent' });
  lineChart($('#c-stance'), pts((s) => s.form?.stance), { max: 100, unit: '%', target: TARGETS.stance, label: 'Stance percent' });
  lineChart($('#c-foot'), pts((s) => s.scores?.footwork), { max: 100, target: TARGETS.footwork, label: 'Footwork score' });
  lineChart($('#c-weeks'), weeks, { unit: ' min', label: 'Minutes per week' });
}

// ---------------------------------------------------------------------------
// Coach / profile

function renderCoach() {
  const { profile, settings, memory } = state;
  const habits = Object.entries(memory.insights).sort((a, b) => b[1].count - a[1].count);
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;

  view.innerHTML = `
    <section class="card">
      <h1>What I remember</h1>
      <p class="muted small">Built from ${memory.analyzed} tracked session${memory.analyzed === 1 ? '' : 's'}. Updated every time you train.</p>
      ${Object.keys(memory.ema).length ? `
        <div class="areas">${Object.keys(AREAS).filter((a) => memory.ema[a] != null).map((a) => `
          <div class="area"><span>${AREAS[a]}</span><div class="bd-bar"><div class="${scoreClass(memory.ema[a], TARGETS[a])}" style="width:${memory.ema[a]}%"></div><i style="left:${TARGETS[a]}%"></i></div><b>${memory.ema[a]}</b></div>`).join('')}
        </div>
        <p class="muted small">Bars are your recent average; the tick is the target.</p>` : '<p>Train with the camera coach and I\'ll start building a picture of your boxing.</p>'}
      ${habits.length ? `<h3>Habits</h3><ul class="habits">${habits.map(([k, v]) => `<li>${esc(INSIGHTS[k].text)} <span class="muted">· seen ${v.count}× · last ${shortDate(v.lastSeen)}${v.count < 2 ? ' · watching' : ''}</span></li>`).join('')}</ul>` : ''}
      ${memory.resolved.length ? `<h3>Fixed 💪</h3><ul class="habits good">${memory.resolved.slice(0, 5).map((r) => `<li>${esc(INSIGHTS[r.key]?.text || r.key)} <span class="muted">· ${shortDate(r.date)}</span></li>`).join('')}</ul>` : ''}
    </section>

    <section class="card">
      <h2>You</h2>
      <form id="profile" class="form">
        <label>Name<input name="name" value="${esc(profile.name)}" maxlength="40" placeholder="Optional"></label>
        <div class="row2">
          <label>Stance<select name="stance">${opt('orthodox', profile.stance, 'Orthodox')}${opt('southpaw', profile.stance, 'Southpaw')}</select></label>
          <label>Level<select name="level">${opt('beginner', profile.level, 'Beginner')}${opt('intermediate', profile.level, 'Intermediate')}${opt('advanced', profile.level, 'Advanced')}</select></label>
        </div>
        <label>Goal<select name="goal">${opt('compete', profile.goal, 'Compete')}${opt('technique', profile.goal, 'Technique')}${opt('fitness', profile.goal, 'Fitness')}${opt('self-defence', profile.goal, 'Self-defence')}</select></label>
        <div class="row2">
          <label>Fight rounds<select name="fightRounds">${[3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === profile.fight.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Round length<select name="fightRoundSec">${[120, 180].map((n) => `<option value="${n}" ${n === profile.fight.roundSec ? 'selected' : ''}>${n / 60} min</option>`).join('')}</select></label>
        </div>
        <label>Fight date (optional)<input type="date" name="fightDate" value="${esc(profile.fightDate)}"></label>
        <p class="muted small">Set a date and the plan runs build → camp → sharpen → taper toward it.</p>
        <div class="row2">
          <label>Target weight<input type="number" name="targetWeight" step="0.1" min="0" inputmode="decimal" value="${profile.targetWeight ?? ''}" placeholder="e.g. 72.5"></label>
          <label>Units<select name="unit">${opt('kg', profile.unit, 'kg')}${opt('lb', profile.unit, 'lb')}</select></label>
        </div>
        <label>Training days per week<input type="number" name="weeklyGoal" min="1" max="7" value="${profile.weeklyGoal}"></label>
        <label><span>Punch detection sensitivity <b id="sensOut">${profile.sensitivity}</b></span>
          <input type="range" name="sensitivity" min="0.5" max="2" step="0.1" value="${profile.sensitivity}"></label>
        <p class="muted small">Raise it if punches are missed, lower it if it counts too many.</p>
        <label class="switch"><input type="checkbox" name="voice" ${settings.voice ? 'checked' : ''}> <span>Voice coaching</span></label>
        <label class="switch"><input type="checkbox" name="cues" ${settings.cues ? 'checked' : ''}> <span>Live form cues ("Hands up!")</span></label>
        <label>Combo call every<select name="comboInterval">${[4, 5, 6, 8, 10, 15].map((s) => `<option value="${s}" ${s === settings.comboInterval ? 'selected' : ''}>${s} seconds</option>`).join('')}</select></label>
        <button class="btn primary block" type="submit">Save</button>
      </form>
    </section>

    <section class="card">
      <h2>Your data</h2>
      <p class="muted small">Everything is stored on this phone only. Back it up now and then.</p>
      <div class="row2">
        <button class="btn ghost" id="exportBtn">Export backup</button>
        <label class="btn ghost file">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
      </div>
      <button class="btn danger block" id="resetBtn">Erase everything</button>
    </section>

    <section class="card tips">
      <h3>Punch numbers</h3>
      <p class="small">1 jab · 2 cross · 3 lead hook · 4 rear hook · 5 lead uppercut · 6 rear uppercut</p>
      <h3>How I judge form</h3>
      <ul class="small">
        <li><b>Guard</b>: both hands at shoulder height or above whenever you're not punching.</li>
        <li><b>Stance</b>: feet roughly 1–2 shoulder-widths apart and never crossed.</li>
        <li><b>Bladed</b>: lead shoulder turned toward the camera, not squared up.</li>
        <li><b>Footwork</b>: how much of the round your hips are moving around the space.</li>
        <li><b>Head movement</b>: how often your head comes off the centre line.</li>
        <li><b>Hand return</b>: time from full extension back to your face.</li>
      </ul>
      <p class="muted small">Camera analysis is an estimate from one phone camera — use it as a mirror that remembers, not a judge.</p>
    </section>`;

  const f = $('#profile');
  f.sensitivity.addEventListener('input', () => { $('#sensOut').textContent = f.sensitivity.value; });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    state.profile = {
      ...profile,
      name: f.name.value.trim(), stance: f.stance.value, level: f.level.value,
      weeklyGoal: Math.min(7, Math.max(1, +f.weeklyGoal.value || 3)), sensitivity: +f.sensitivity.value,
      goal: f.goal.value,
      fight: { rounds: +f.fightRounds.value, roundSec: +f.fightRoundSec.value, restSec: 60 },
      fightDate: f.fightDate.value, targetWeight: +f.targetWeight.value > 0 ? +f.targetWeight.value : null, unit: f.unit.value,
    };
    rebuildPlan(currentPlan().gymDays);
    state.settings = { ...settings, voice: f.voice.checked, cues: f.cues.checked, comboInterval: +f.comboInterval.value };
    persist();
    toast('Saved.');
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `boxcoach-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state = store.importJSON(await file.text());
      persist();
      toast(`Imported ${state.sessions.length} sessions.`);
      renderCoach();
    } catch (err) {
      toast(err.message || 'Import failed.');
    }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Erase all sessions and everything the coach has learned? This cannot be undone.')) return;
    state = store.defaultState();
    persist();
    route();
  });
}

// ---------------------------------------------------------------------------

view.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  if (a.dataset.action === 'start-item') {
    const it = currentPlan().items.find((x) => x.id === a.dataset.id);
    if (it?.preset) {
      const tracking = it.preset.tracking === 'motion' && !motionSupported() ? state.settings.tracking : it.preset.tracking;
      startSession({ combos: state.settings.combos, focus: state.memory.focus?.area || null, ...it.preset, tracking });
    }
  }
  if (a.dataset.action === 'start-suggested') {
    const sug = suggestWorkout(state.sessions, state.memory, state.profile);
    startSession({
      type: sug.type, rounds: sug.rounds, roundSec: sug.roundSec, restSec: sug.restSec,
      tracking: state.settings.tracking, combos: state.settings.combos, comboLevel: sug.comboLevel, focus: sug.focus,
    });
  }
});

document.addEventListener('visibilitychange', async () => {
  if (live && document.visibilityState === 'visible' && live.wakeLock?.released) {
    try { live.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

route();
