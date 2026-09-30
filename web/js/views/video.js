// Video intelligence: analyse an uploaded shadowboxing/sparring/bag video on-device,
// show every detection with a confidence score, let the boxer correct it, then save.
import { FormAnalyzer, PUNCH_DIGIT, combineRounds, sequencesFrom, streamFrom, comboStats, PUNCH_NAMES, choosePose, PersonTracker, personAt } from '../form.js';
import { ALL_TYPES } from '../coach.js';
import { $, $$, esc, opt, toast } from '../ui.js';
import { newId } from '../store.js';
import { comboLabel, comboText, parseCombo, STARTERS } from '../combos.js';
import { calibrateFromCombo } from '../calibrate.js';
import { saveReference } from './study.js';

let job = null; // { analyzer, events, rounds, meta } after analysis
let busy = false;
// True while a video is being analysed or waits for review: an app update must not reload then.
export const videoBusy = () => busy || !!job;

// Quick adds not saved yet can be picked straight from the video form; picking one saves it.
const unsavedStarters = (app) => STARTERS.filter((t) => !app.state.combos.some((c) => comboText(c.tokens) === comboText(parseCombo(t))));
function drillCombo(app, value) {
  if (!value) return null;
  if (!value.startsWith('s:')) return app.state.combos.find((c) => c.id === value) || null;
  const c = { id: newId(), tokens: parseCombo(value.slice(2)), name: '', created: new Date().toISOString() };
  app.state.combos.push(c);
  app.persist();
  return c;
}

// A saved punch calibration is only used if it proved itself (60%+ against a drilled combo).
export const trustedCal = (cal) => (cal?.acc >= 0.6 ? cal : null);

const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const fmtT = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export function renderVideo(el, app) {
  if (job?.done) return renderReview(el, app);
  el.innerHTML = `
    <section class="card">
      <h2>Analyse a video</h2>
      <p class="muted small">Shadowboxing, pads, bag or sparring. It's analysed on your phone and never uploaded. Best results: whole body in frame, camera still, filmed from the front or a 45° angle.</p>
      <div class="msg" style="margin:0 0 12px">📋 Want Claude to review it? After saving, open the session in <b>Log</b> and tap <b>Copy report for coach</b>, then paste it into your chat. Only the measurements are shared, never the video.</div>
      <form id="vidForm" class="form">
        <label>Video<input type="file" name="file" accept="video/*" required></label>
        <label>Whose video?<select name="subject">${opt('me', 'me', 'Me')}${opt('pro', 'me', 'A pro to compare against')}</select></label>
        <label class="pro-only" hidden>Name<input name="proName" maxlength="60" placeholder="e.g. Floyd Mayweather"></label>
        <label>Type<select name="type">${['shadow', 'mitts', 'bag', 'sparring'].map((t) => opt(t, 'shadow', ALL_TYPES[t])).join('')}</select></label>
        <p class="muted small" style="margin:0">Someone else in the video (pads, sparring)? You'll tap yourself before the analysis starts, and it follows you even when you move around or swap sides.</p>
        <label>Drilling one combo on repeat? (optional)<select name="drill">${opt('', '', 'No / mixed punches')}${
          app.state.combos.map((c) => opt(c.id, '', comboLabel(c.tokens))).join('')}${
          unsavedStarters(app).map((t) => opt(`s:${t}`, '', comboLabel(parseCombo(t)))).join('')}</select></label>
        <p class="muted small" style="margin:0">Pick the whole sequence you repeated. Punch types then follow your combo, and the camera checks and trains itself against it. Build your own in Train → Combos.</p>
        <div class="row2">
          <label>Rounds of<select name="roundSec">${opt(0, 0, 'Whole video')}${opt(120, 0, '2 min')}${opt(180, 0, '3 min')}</select></label>
          <label>Detail<select name="fps">${opt(10, 15, 'Fast')}${opt(15, 15, 'Normal')}${opt(24, 15, 'Precise (slow)')}</select></label>
        </div>
        <button class="btn primary block" type="submit">Analyse</button>
      </form>
      <div id="vidProgress" hidden>
        <div class="vid-stage" id="vidStage"><canvas id="vidOverlay"></canvas></div>
        <div class="bar"><div id="vidBar" style="width:0%"></div></div>
        <p class="small muted" id="vidStatus">Loading…</p>
        <button class="btn ghost" id="vidCancel" type="button">Cancel</button>
      </div>
    </section>`;
  const vf = $('#vidForm', el);
  vf.subject.addEventListener('change', () => {
    const pro = vf.subject.value === 'pro';
    $('.pro-only', el).hidden = !pro;
    if (vf.drill) vf.drill.closest('label').hidden = pro;
  });
  $('#vidForm', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const file = f.file.files[0];
    if (!file) return;
    // Create and start the video inside the tap so iPhone allows playback.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.src = URL.createObjectURL(file);
    video.play().then(() => video.pause()).catch(() => {});
    analyse(file, video, {
      type: f.type.value, roundSec: +f.roundSec.value, fps: +f.fps.value,
      drill: f.subject.value === 'pro' ? null : drillCombo(app, f.drill?.value),
      subject: f.subject.value, proName: f.proName.value.trim(),
      stance: app.state.profile.stance, sensitivity: app.state.profile.sensitivity,
    }, el, app);
  });
}

// Average clothing colour over each person's torso: the tracker's main identity cue.
const sampler = document.createElement('canvas');
function sampleColors(video, people) {
  if (!people.length || !video.videoWidth) return [];
  const w = 96, h = Math.round((96 * video.videoHeight) / video.videoWidth);
  sampler.width = w;
  sampler.height = h;
  const g = sampler.getContext('2d', { willReadFrequently: true });
  try {
    g.drawImage(video, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    return people.map((pts) => {
      const xs = [pts[11].x, pts[12].x, pts[23].x, pts[24].x], ys = [pts[11].y, pts[12].y, pts[23].y, pts[24].y];
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const hw = Math.max(0.02, (x1 - x0) * 0.3), hh = Math.max(0.03, (y1 - y0) * 0.3);
      x0 = cx - hw; x1 = cx + hw; y0 = cy - hh; y1 = cy + hh;
      let r = 0, gr = 0, b = 0, n = 0;
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const px = Math.round((x0 + ((x1 - x0) * i) / 4) * (w - 1)), py = Math.round((y0 + ((y1 - y0) * j) / 4) * (h - 1));
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const k = (py * w + px) * 4;
          r += data[k]; gr += data[k + 1]; b += data[k + 2]; n++;
        }
      }
      return n ? [r / n, gr / n, b / n] : null;
    });
  } catch {
    return [];
  }
}

// Waits for the next decoded frame (play, then pause on the first frame shown).
function nextFrame(video) {
  return new Promise((res) => {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      video.addEventListener('seeked', () => res(), { once: true });
      video.currentTime = Math.min(video.duration, video.currentTime + 0.2);
      return;
    }
    video.requestVideoFrameCallback(() => { video.pause(); res(); });
    video.play().catch(() => res());
  });
}

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

function drawPeople(canvas, video, people, chosen) {
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  people.forEach((pts, i) => {
    g.strokeStyle = i === chosen ? '#ff4655' : 'rgba(255,255,255,0.45)';
    g.lineWidth = Math.max(3, canvas.width / 160);
    for (const [a, b] of BONES) {
      g.beginPath();
      g.moveTo(pts[a].x * canvas.width, pts[a].y * canvas.height);
      g.lineTo(pts[b].x * canvas.width, pts[b].y * canvas.height);
      g.stroke();
    }
  });
}

async function analyse(file, video, opts, el, app) {
  busy = true;
  $('#vidForm', el).hidden = true;
  $('#vidProgress', el).hidden = false;
  const status = $('#vidStatus', el);
  const stage = $('#vidStage', el);
  const overlay = $('#vidOverlay', el);
  stage.prepend(video);
  let cancelled = false;
  $('#vidCancel', el).addEventListener('click', () => { cancelled = true; video.pause(); });
  const url = video.src;
  try {
    if (video.readyState < 2) {
      await new Promise((res, rej) => {
        video.addEventListener('loadeddata', res, { once: true });
        video.addEventListener('error', () => rej(new Error('Could not read that video. Try a shorter clip or record in "Most Compatible" format.')), { once: true });
      });
    }
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    stage.style.width = `min(100%, ${Math.round((380 * video.videoWidth) / video.videoHeight)}px)`;
    // Bigger model for more detail: body tracking is what everything else rests on.
    const model = opts.fps >= 24 ? 'heavy' : opts.fps >= 15 ? 'full' : 'lite';
    status.textContent = model === 'heavy' ? 'Loading the precise pose model (30 MB, first time only)…' : 'Loading pose model…';
    const { getVideoLandmarker, detectVideoFrame } = await import('../pose.js');
    const lm = await getVideoLandmarker(model);
    const analyzer = new FormAnalyzer({ stance: opts.stance, sensitivity: opts.sensitivity, minVis: 0.3, cal: trustedCal(app.state.profile.punchCal), aspect: video.videoWidth / video.videoHeight || 1 });
    const durMs = video.duration * 1000;
    const roundMs = opts.roundSec ? opts.roundSec * 1000 : durMs + 1;
    const rounds = [];
    let roundEnd = roundMs, frames = 0, tracked = 0, multi = 0, lastT = -1;
    const tracker = new PersonTracker();
    let who = 'auto';

    // Find people in the first frames; with more than one, ask the boxer to tap themselves.
    status.textContent = 'Finding you in the video…';
    // Look through up to 5 s: people may walk into shot late, or one may be missed on a single frame.
    // Keep the frame showing the most people; stop as soon as two are seen.
    let first = [], colors = [];
    for (let i = 0; i < 90 && !cancelled && !video.ended; i++) {
      await nextFrame(video);
      let found = [];
      try { found = detectVideoFrame(lm, video)?.landmarks || []; } catch { found = []; }
      if (found.length > first.length) { first = found; colors = sampleColors(video, found); }
      if (first.length > 1 || (first.length === 1 && video.currentTime > 1.5) || video.currentTime > 5) break;
    }
    if (cancelled) throw new Error('cancelled');
    if (first.length > 1) {
      drawPeople(overlay, video, first, -1);
      const target = opts.subject === 'pro' ? 'the boxer' : 'yourself';
      status.innerHTML = `<b>Tap ${target}</b> in the video to start.`;
      stage.dataset.pick = `Tap ${target}`;
      stage.classList.add('pick');
      stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 'click' rather than 'pointerdown' so scrolling past the video with a finger doesn't pick anyone.
      const i = await new Promise((resolve) => {
        stage.addEventListener('click', (e) => {
          const r = overlay.getBoundingClientRect();
          resolve(personAt(first, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
        }, { once: true });
        $('#vidCancel', el).addEventListener('click', () => resolve(-1), { once: true });
      });
      stage.classList.remove('pick');
      if (cancelled || i < 0) throw new Error('cancelled');
      tracker.lockOn(first[i], colors[i]);
      who = 'tap';
      drawPeople(overlay, video, first, i);
    } else if (first.length === 1) {
      tracker.lockOn(first[0], colors[0]);
    }

    analyzer.startRound();

    const processFrame = (t) => {
      if (t <= lastT) return;
      lastT = t;
      while (t >= roundEnd) {
        rounds.push(analyzer.endRound());
        analyzer.startRound();
        roundEnd += roundMs;
      }
      let r = null;
      try { r = detectVideoFrame(lm, video); } catch { r = null; }
      const people = r?.landmarks || [];
      let idx = -1;
      if (tracker.locked) idx = tracker.pick(people, sampleColors(video, people), t);
      else if (people.length) {
        idx = choosePose(people, 'auto');
        tracker.lockOn(people[idx], sampleColors(video, people)[idx]);
      }
      const image = idx >= 0 ? people[idx] : null;
      const world = idx >= 0 ? r.worldLandmarks?.[idx] : null;
      if (image) tracked++;
      if (people.length > 1) multi++;
      frames++;
      analyzer.update(world || null, image, t);
      drawPeople(overlay, video, people, idx);
      if (frames % 5 === 0) {
        $('#vidBar', el).style.width = `${Math.min(100, (t / durMs) * 100)}%`;
        status.textContent = `Analysing ${fmtT(t)} / ${fmtT(durMs)} · ${analyzer.events.filter((e) => e.kind === 'punch').length} punches · body found in ${Math.round((tracked / frames) * 100)}% of frames`;
      }
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      // Play the video; on each shown frame we want, pause, analyse, then resume. Reliable on
      // iPhone, and no frames are lost however slow the phone is.
      const gap = 1000 / opts.fps - 5;
      await new Promise((resolve, reject) => {
        let gotFrame = false;
        const onFrame = (now, meta) => {
          if (cancelled) return reject(new Error('cancelled'));
          gotFrame = true;
          const t = meta.mediaTime * 1000;
          if (t - lastT >= gap) {
            video.pause();
            processFrame(t);
          }
          if (video.ended || t >= durMs - 40) return resolve();
          video.requestVideoFrameCallback(onFrame);
          if (video.paused) video.play().catch(() => {});
        };
        video.addEventListener('ended', resolve, { once: true });
        video.requestVideoFrameCallback(onFrame);
        video.currentTime = 0;
        video.play().catch(() => reject(new Error('The video would not play. Tap Analyse again.')));
        setTimeout(() => { if (!gotFrame && !cancelled) reject(new Error('The video did not start playing. Tap Analyse again.')); }, 15000);
        $('#vidCancel', el).addEventListener('click', () => reject(new Error('cancelled')));
      });
    } else {
      // Fallback: step through the video frame by frame.
      const step = 1000 / opts.fps;
      for (let t = 0; t < durMs; t += step) {
        if (cancelled) throw new Error('cancelled');
        video.currentTime = t / 1000;
        await new Promise((res) => video.addEventListener('seeked', res, { once: true }));
        processFrame(t);
        if (frames % 5 === 0) await new Promise((res) => setTimeout(res, 0));
      }
    }
    rounds.push(analyzer.endRound());
    video.pause();
    analyzer.reclassify();
    // Drilled a known combo: check the camera against it and learn this boxer's straight/hook boundary.
    let comboCheck = null;
    if (opts.drill) {
      const punchEvents = () => analyzer.events.filter((e) => e.kind === 'punch' && e.f);
      const prior = app.state.profile.punchCal || null;
      // 1) How the camera did on its own; this also pins forward from the known straights.
      comboCheck = calibrateFromCombo(punchEvents(), opts.drill.tokens, trustedCal(prior));
      comboCheck.combo = comboLabel(opts.drill.tokens);
      // 2) Re-read with the combo as a guide (forward pinned), current straight/hook boundary.
      analyzer.reclassify();
      comboCheck.guided = calibrateFromCombo(punchEvents(), opts.drill.tokens, prior).agree;
      // 3) Try the learned boundary; keep it only if the clip lined up well and it reads better.
      const lined = comboCheck.matched >= 0.6 * comboCheck.total;
      if (comboCheck.ratio != null && lined) {
        const cal = { ratio: comboCheck.ratio, n: comboCheck.n, updated: new Date().toISOString() };
        analyzer.cal = cal;
        analyzer.reclassify();
        const tuned = calibrateFromCombo(punchEvents(), opts.drill.tokens, cal).agree;
        // Keep it only if it clearly reads your punches: 60%+ right and a real gain, not noise.
        cal.acc = Math.round((tuned / comboCheck.matched) * 100) / 100;
        if (cal.acc >= 0.6 && tuned >= comboCheck.guided + Math.max(3, comboCheck.matched * 0.05)) {
          comboCheck.tuned = tuned;
          comboCheck.saved = true;
          app.state.profile.punchCal = cal;
          app.persist();
        } else {
          analyzer.cal = prior;
          analyzer.reclassify();
        }
      }
      if (!lined) comboCheck.poorFit = true;
      // You told us what you threw: punches that line up with the combo take their type from it.
      // The camera's own reading is kept in the report (calib.punches) so it can keep improving.
      if (lined) {
        const byDigit = Object.fromEntries(Object.entries(PUNCH_DIGIT).map(([t, d]) => [d, t]));
        let set = 0;
        punchEvents().forEach((e, i) => {
          const d = comboCheck.labels[i];
          if (!d) return;
          e.type = byDigit[d];
          e.conf = Math.max(e.conf, 75);
          set++;
        });
        comboCheck.labelled = set;
      }
      analyzer.calib.labels = comboCheck.labels.map((d) => d || '.').join('');
      delete comboCheck.labels;
    }
    job = {
      done: true, url, type: opts.type, subject: opts.subject, proName: opts.proName, roundSec: opts.roundSec || Math.round(durMs / 1000), durMs,
      rounds, events: analyzer.events.map((e, i) => ({ ...e, i, keep: e.conf >= 50, fix: e.type })),
      calib: { ...analyzer.calib, model, who, multi: frames ? Math.round((multi / frames) * 100) : 0, comboCheck: comboCheck || undefined, cal: analyzer.cal || undefined },
      comboCheck,
      frames, tracked: frames ? Math.round((tracked / frames) * 100) : 0, multi: frames ? Math.round((multi / frames) * 100) : 0,
      date: new Date(file.lastModified || Date.now()).toISOString(),
    };
    app.rerender();
  } catch (err) {
    video.pause();
    URL.revokeObjectURL(url);
    if (err.message !== 'cancelled') toast(err.message || 'Video analysis failed.');
    app.rerender();
  } finally {
    busy = false;
  }
}

function comboCheckHTML(c) {
  if (!c.total) return `<li>Combo check (${esc(c.combo)}): no punches detected to check.</li>`;
  const p = (n) => pctOf(n, c.matched);
  const final = c.tuned ?? c.guided ?? c.agree;
  return `<li>Combo check (${esc(c.combo)}): ${c.matched} of ${c.total} punches lined up with it.
    On its own the camera read ${p(c.agree)}% of those as the right punch; using your combo as a guide, ${p(final)}%.
    ${c.labelled ? `Punch types for those ${c.labelled} follow your combo.` : ''}
    ${c.saved ? 'It learned how your straights and hooks look on camera and will use that from now on.' : ''}
    ${c.poorFit ? "Most punches didn't line up with this combo, so nothing was learned. Was it the right combo, thrown on repeat?" : ''}</li>`;
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
        <li>Body found in ${j.tracked}% of ${j.frames ?? ''} frames analysed${j.tracked < 70 ? ' — low; results are less reliable' : ''}${j.multi ? ` · ${j.multi}% had 2 people (following the person you tapped)` : ''}</li>
        <li>Stance detected: ${esc(stanceTxt)}</li>
        <li>${punches.length} punches detected, average confidence ${avgConf ?? '–'}%</li>
        ${j.comboCheck ? comboCheckHTML(j.comboCheck) : ''}
        <li>${others.filter((e) => e.kind === 'guardDrop').length} guard drops · ${others.filter((e) => e.kind === 'crossedFeet').length} crossed-feet moments</li>
      </ul>
      <p class="muted small">Computer vision isn't perfect. Tap a time to jump there, fix the punch type, or untick anything that's wrong. Low-confidence detections start unticked.</p>
      <label class="switch"><input type="checkbox" id="uncertain" ${uncertainOnly ? 'checked' : ''}> <span>Only show uncertain (&lt;70%)</span></label>
    </section>
    ${j.tracked < 30 ? `<section class="card"><div class="msg behind"><b>I could barely see you in this video.</b> Try: whole body in frame (head to feet), steadier camera, better light, or re-run and tap yourself carefully if someone else is in the shot. You can also use Fast/Normal detail on long clips.</div></section>` : ''}
    <section class="card">
      ${shown.length ? '' : '<p class="muted small" style="margin:0">No detections to review.</p>'}
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
      <div class="row2"><button class="btn ghost" id="vidDiscard">Discard</button><button class="btn primary" id="vidSave">${j.subject === 'pro' ? 'Save for comparison' : 'Save session'}</button></div>
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
    j.events[+c.dataset.keep].edited = true;
    c.closest('li').classList.toggle('off', !c.checked);
  }));
  $$('[data-fix]', el).forEach((s) => s.addEventListener('change', () => { j.events[+s.dataset.fix].fix = s.value; j.events[+s.dataset.fix].edited = true; }));
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
    if (j.subject === 'pro') {
      // A pro's clip is for comparison only: it never enters your log, stats or plan.
      saveReference(app, session, j.proName);
      toast(`Saved ${j.proName || 'the pro'} for comparison.`);
      location.hash = '#train/study';
      return;
    }
    app.showSummary(session);
  });
}

// Apply the boxer's corrections to the per-round metrics and build a session.
export function buildSession(j) {
  const rounds = j.rounds.map((r, idx) => {
    const kept = j.events.filter((e) => e.kind === 'punch' && e.round === idx + 1 && e.keep);
    const punches = { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 };
    for (const e of kept) punches[e.fix]++;
    const log = kept.map((e) => ({ t: e.t, type: e.fix }));
    const sequences = sequencesFrom(log);
    return { ...r, punches, totalPunches: kept.length, sequences, stream: streamFrom(log), ...comboStats(sequences) };
  });
  const form = combineRounds(rounds);
  return {
    id: newId(), date: j.date, type: j.type, tracking: 'camera', source: 'video',
    plan: { rounds: rounds.length, roundSec: j.roundSec, restSec: 60 }, completedRounds: rounds.length,
    workSec: Math.round(j.durMs / 1000), totalSec: Math.round(j.durMs / 1000),
    punches: { total: form.totalPunches, perRound: rounds.map((r) => r.totalPunches), byType: form.punches },
    form: form.perRound.some((r) => r.frames > 30) ? form : null,
    // Only the boxer's own edits count as corrections (low-confidence detections start unticked).
    corrections: j.events.filter((e) => e.edited && (!e.keep || (e.kind === 'punch' && e.fix !== e.type))).length,
    // Ground truth: [detected type, corrected type or 0 if rejected, confidence, 1 = you confirmed it].
    calib: {
      ...j.calib,
      autoUnticked: j.events.filter((e) => e.kind === 'punch' && !e.edited && !e.keep).length,
      fixes: j.events.filter((e) => e.kind === 'punch' && e.edited).slice(0, 200).map((e) => [e.type, e.keep ? e.fix : 0, e.conf, e.keep && e.fix === e.type ? 1 : 0]),
    },
    rpe: 7, notes: '',
  };
}

