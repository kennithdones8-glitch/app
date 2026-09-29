// Video intelligence: analyse an uploaded shadowboxing/sparring/bag video on-device,
// show every detection with a confidence score, let the boxer correct it, then save.
import { FormAnalyzer, combineRounds, sequencesFrom, comboStats, PUNCH_NAMES } from '../form.js';
import { ALL_TYPES } from '../coach.js';
import { $, $$, esc, opt, toast } from '../ui.js';
import { newId } from '../store.js';

let job = null; // { analyzer, events, rounds, meta } after analysis

const fmtT = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export function renderVideo(el, app) {
  if (job?.done) return renderReview(el, app);
  el.innerHTML = `
    <section class="card">
      <h2>Analyse a video</h2>
      <p class="muted small">Pick a shadowboxing, bag or sparring video. It's analysed on your phone and never uploaded. Works best with only you in frame, full body visible, facing the camera.</p>
      <div class="msg" style="margin:0 0 12px">📋 Want Claude to review it? After saving, open the session in <b>Log</b> and tap <b>Copy report for coach</b>, then paste it into your chat. Only the measurements are shared, never the video.</div>
      <form id="vidForm" class="form">
        <label>Video<input type="file" name="file" accept="video/*" required></label>
        <label>Type<select name="type">${['shadow', 'bag', 'sparring', 'mitts'].map((t) => opt(t, 'shadow', ALL_TYPES[t])).join('')}</select></label>
        <div class="row2">
          <label>Rounds of<select name="roundSec">${opt(0, 180, 'Whole video')}${opt(120, 180, '2 min')}${opt(180, 180, '3 min')}</select></label>
          <label>Detail<select name="fps">${opt(10, 15, 'Fast')}${opt(15, 15, 'Normal')}${opt(24, 15, 'Precise')}</select></label>
        </div>
        <button class="btn primary block" type="submit">Analyse</button>
      </form>
      <div id="vidProgress" hidden>
        <div class="bar"><div id="vidBar" style="width:0%"></div></div>
        <p class="small muted" id="vidStatus">Loading…</p>
        <button class="btn ghost" id="vidCancel" type="button">Cancel</button>
      </div>
    </section>`;
  $('#vidForm', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    analyse(f.file.files[0], { type: f.type.value, roundSec: +f.roundSec.value, fps: +f.fps.value, stance: app.state.profile.stance, sensitivity: app.state.profile.sensitivity }, el, app);
  });
}

async function analyse(file, opts, el, app) {
  if (!file) return;
  $('#vidForm', el).hidden = true;
  $('#vidProgress', el).hidden = false;
  const status = $('#vidStatus', el);
  let cancelled = false;
  $('#vidCancel', el).addEventListener('click', () => { cancelled = true; });
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('Could not read that video.')); });
    status.textContent = 'Loading pose model…';
    const { getLandmarker } = await import('../pose.js');
    const lm = await getLandmarker();
    const analyzer = new FormAnalyzer({ stance: opts.stance, sensitivity: opts.sensitivity });
    const durMs = video.duration * 1000;
    const roundMs = opts.roundSec ? opts.roundSec * 1000 : durMs + 1;
    const rounds = [];
    const step = 1000 / opts.fps;
    let roundEnd = roundMs;
    let visFrames = 0, frames = 0;
    analyzer.startRound();
    for (let t = 0; t < durMs; t += step) {
      if (cancelled) throw new Error('cancelled');
      if (t >= roundEnd) {
        rounds.push(analyzer.endRound());
        analyzer.startRound();
        roundEnd += roundMs;
      }
      video.currentTime = t / 1000;
      await new Promise((res) => { video.onseeked = res; });
      let r = null;
      try { r = lm.detectForVideo(video, Math.round(t) + 1); } catch { r = null; }
      const image = r?.landmarks?.[0] || null;
      frames++;
      if (image) visFrames++;
      analyzer.update(r?.worldLandmarks?.[0] || null, image, t);
      if (frames % 10 === 0) {
        $('#vidBar', el).style.width = `${(t / durMs) * 100}%`;
        status.textContent = `Analysing ${fmtT(t)} / ${fmtT(durMs)} · ${analyzer.events.filter((e) => e.kind === 'punch').length} punches so far`;
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    rounds.push(analyzer.endRound());
    job = {
      done: true, url, type: opts.type, roundSec: opts.roundSec || Math.round(durMs / 1000), durMs,
      rounds, events: analyzer.events.map((e, i) => ({ ...e, i, keep: e.conf >= 50, fix: e.type })),
      calib: analyzer.calib,
      tracked: frames ? Math.round((visFrames / frames) * 100) : 0, date: new Date(file.lastModified || Date.now()).toISOString(),
    };
    app.rerender();
  } catch (err) {
    URL.revokeObjectURL(url);
    if (err.message !== 'cancelled') toast(err.message || 'Video analysis failed.');
    app.rerender();
  }
}

function renderReview(el, app) {
  const j = job;
  const punches = j.events.filter((e) => e.kind === 'punch');
  const others = j.events.filter((e) => e.kind !== 'punch');
  const stance = combineRounds(j.rounds).leftLeadPct;
  const stanceTxt = stance == null ? 'unknown' : stance >= 50 ? `orthodox (${stance}% of frames)` : `southpaw (${100 - stance}% of frames)`;
  const avgConf = punches.length ? Math.round(punches.reduce((a, e) => a + e.conf, 0) / punches.length) : null;
  const uncertainOnly = el.dataset.uncertain === '1';
  const shown = [...punches, ...others].sort((a, b) => a.t - b.t).filter((e) => !uncertainOnly || e.conf < 70);
  el.innerHTML = `
    <section class="card">
      <h2>Video review</h2>
      <video id="vidPreview" src="${j.url}" controls playsinline muted class="vid-preview"></video>
      <ul class="small">
        <li>Body tracked in ${j.tracked}% of frames${j.tracked < 70 ? ' — low; results are less reliable' : ''}</li>
        <li>Stance detected: ${esc(stanceTxt)}</li>
        <li>${punches.length} punches detected, average confidence ${avgConf ?? '–'}%</li>
        <li>${others.filter((e) => e.kind === 'guardDrop').length} guard drops · ${others.filter((e) => e.kind === 'crossedFeet').length} crossed-feet moments</li>
      </ul>
      <p class="muted small">Computer vision isn't perfect. Tap a time to jump there, fix the punch type, or untick anything that's wrong. Low-confidence detections start unticked.</p>
      <label class="switch"><input type="checkbox" id="uncertain" ${uncertainOnly ? 'checked' : ''}> <span>Only show uncertain (&lt;70%)</span></label>
    </section>
    <section class="card">
      <ul class="events">${shown.map((e) => `
        <li class="${e.keep ? '' : 'off'}">
          <input type="checkbox" data-keep="${e.i}" ${e.keep ? 'checked' : ''} aria-label="Keep detection">
          <button class="linkbtn" data-seek="${e.t}">${fmtT(e.t)}</button>
          ${e.kind === 'punch'
            ? `<select data-fix="${e.i}">${Object.entries(PUNCH_NAMES).map(([k, n]) => opt(k, e.fix, n)).join('')}</select>`
            : `<span>${e.kind === 'guardDrop' ? 'Guard drop' : 'Crossed feet'}</span>`}
          <span class="badge ${e.conf >= 80 ? 'good' : e.conf >= 60 ? 'warn' : 'bad'}">${e.conf}%</span>
        </li>`).join('')}</ul>
    </section>
    <section class="card">
      <div class="row2"><button class="btn ghost" id="vidDiscard">Discard</button><button class="btn primary" id="vidSave">Save session</button></div>
    </section>`;

  $('#uncertain', el).addEventListener('change', (e) => { el.dataset.uncertain = e.target.checked ? '1' : ''; renderReview(el, app); });
  $$('[data-seek]', el).forEach((b) => b.addEventListener('click', () => {
    const v = $('#vidPreview', el);
    v.currentTime = Math.max(0, +b.dataset.seek / 1000 - 0.5);
    v.play().catch(() => {});
    setTimeout(() => v.pause(), 1500);
  }));
  $$('[data-keep]', el).forEach((c) => c.addEventListener('change', () => {
    j.events[+c.dataset.keep].keep = c.checked;
    c.closest('li').classList.toggle('off', !c.checked);
  }));
  $$('[data-fix]', el).forEach((s) => s.addEventListener('change', () => { j.events[+s.dataset.fix].fix = s.value; }));
  $('#vidDiscard', el).addEventListener('click', () => {
    if (!confirm('Discard this analysis?')) return;
    URL.revokeObjectURL(j.url);
    job = null;
    app.rerender();
  });
  $('#vidSave', el).addEventListener('click', () => {
    const session = buildSession(j);
    URL.revokeObjectURL(j.url);
    job = null;
    app.showSummary(session);
  });
}

// Apply the boxer's corrections to the per-round metrics and build a session.
export function buildSession(j) {
  const rounds = j.rounds.map((r, idx) => {
    const kept = j.events.filter((e) => e.kind === 'punch' && e.round === idx + 1 && e.keep);
    const punches = { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 };
    for (const e of kept) punches[e.fix]++;
    const sequences = sequencesFrom(kept.map((e) => ({ t: e.t, type: e.fix })));
    return { ...r, punches, totalPunches: kept.length, sequences, ...comboStats(sequences) };
  });
  const form = combineRounds(rounds);
  return {
    id: newId(), date: j.date, type: j.type, tracking: 'camera', source: 'video',
    plan: { rounds: rounds.length, roundSec: j.roundSec, restSec: 60 }, completedRounds: rounds.length,
    workSec: Math.round(j.durMs / 1000), totalSec: Math.round(j.durMs / 1000),
    punches: { total: form.totalPunches, perRound: rounds.map((r) => r.totalPunches), byType: form.punches },
    form: form.perRound.some((r) => r.frames > 30) ? form : null,
    corrections: j.events.filter((e) => !e.keep || (e.kind === 'punch' && e.fix !== e.type)).length,
    // Your corrections are the ground truth: [detected type, corrected type or 0 if rejected, confidence].
    calib: { ...j.calib, fixes: j.events.filter((e) => e.kind === 'punch' && (!e.keep || e.fix !== e.type)).slice(0, 200).map((e) => [e.type, e.keep ? e.fix : 0, e.conf]) },
    rpe: 7, notes: '',
  };
}

