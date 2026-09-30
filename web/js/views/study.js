// Train → Study: watch pros (YouTube links) and compare your numbers with a pro's analysed clip.
import { $, $$, esc, toast } from '../ui.js';
import { newId } from '../store.js';
import { outputPpm } from '../coach.js';
import { presetProVideo } from './handoff.js';

// Accepts youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /live/ID. Returns the ID or null.
export function youTubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1`;
const SEARCHES = [
  ['Floyd Mayweather shadowboxing', 'floyd mayweather shadow boxing'],
  ['Floyd Mayweather pad work', 'floyd mayweather mitt work'],
  ['Shoulder roll defence', 'philly shell shoulder roll drill'],
];

// Numbers compared between you and a pro. `better` says which way is good; null = style, not quality.
const METRICS = [
  ['ppm', 'Punches per minute', 'up'],
  ['combo', 'Average combination (punches)', null],
  ['returnMs', 'Hand return (ms)', 'down'],
  ['guard', 'Guard up %', 'up'],
  ['head', 'Head movement %', 'up'],
  ['jabShare', 'Jab share %', null],
];

// The same numbers for any analysed session (yours or a pro's).
export function metricsOf(s) {
  const by = s.punches?.byType;
  const total = by ? Object.values(by).reduce((a, b) => a + b, 0) : 0;
  return {
    ppm: outputPpm(s),
    combo: s.form?.avgComboLen ?? null,
    returnMs: s.form?.handReturnMs ?? null,
    guard: s.form?.guard ?? null,
    head: s.form?.head ?? null,
    jabShare: total >= 20 ? Math.round((by.jab / total) * 100) : null,
  };
}

// Your average over your last few camera/video sessions.
export function yourMetrics(sessions, n = 5) {
  const recent = sessions.filter((s) => s.form && s.punches?.total && !s.reference).slice(-n);
  const out = {};
  for (const [k] of METRICS) {
    const xs = recent.map((s) => metricsOf(s)[k]).filter((x) => x != null);
    out[k] = xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  }
  return { n: recent.length, values: out };
}

export function saveReference(app, session, name) {
  app.state.references.push({
    id: newId(), name: name || 'Pro', date: new Date().toISOString(), type: session.type,
    workSec: session.workSec, metrics: metricsOf(session), byType: session.punches?.byType || null,
    sidePct: session.form?.sidePct ?? null,
  });
  app.persist();
}

export function renderStudy(el, app) {
  const st = app.state;
  const videos = st.refVideos;
  const refs = st.references;
  const mine = yourMetrics(st.sessions);
  el.innerHTML = `
    <section class="card">
      <div class="eyebrow">Step 1</div>
      <h2>Watch the pros</h2>
      <p class="muted small" style="margin-top:0">For watching and copying their movement. Links play here; the app can't measure a YouTube video (see step 2 for numbers).</p>
      ${videos.length ? videos.map((v) => `
        <div class="ref-video">
          <div class="card-head"><b>${esc(v.name)}</b><button class="linkbtn" data-delvid="${v.id}" aria-label="Remove ${esc(v.name)}">✕</button></div>
          <div class="yt"><iframe src="${embedUrl(v.yt)}" title="${esc(v.name)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
          <button class="btn ghost sm block" data-numbers="${esc(proName(v.name))}">Get his numbers from a clip of this →</button>
        </div>`).join('') : '<p class="muted small">Add YouTube links to study here. Use the ⚙️ in the player to slow it down to 0.5× or 0.25×.</p>'}
      <form id="vidAdd" class="form" style="margin-top:12px">
        <label>YouTube link<input name="url" inputmode="url" autocomplete="off" placeholder="Paste from YouTube: Share → Copy link"></label>
        <label>Name<input name="name" maxlength="60" placeholder="e.g. Floyd Mayweather shadowboxing"></label>
        <button class="btn primary" type="submit">Add video</button>
      </form>
      <p class="small muted" style="margin:10px 0 4px">Find one on YouTube, then Share → Copy link:</p>
      <div class="chipset">${SEARCHES.map(([label, q]) => `<a class="chip" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}">${esc(label)} ↗</a>`).join('')}</div>
    </section>

    <section class="card">
      <div class="eyebrow">Step 2</div>
      <h2>You vs the pros</h2>
      <details class="howto" ${refs.length ? '' : 'open'}><summary class="small"><b>How to get a pro's numbers</b></summary>
        <ol class="small">
          <li>The app measures video <b>files on your phone</b>, not YouTube links.</li>
          <li>Get a clip onto your phone, e.g. play the YouTube video full-screen and use iPhone <b>Screen Recording</b> (Control Centre), then trim it to just the boxing in Photos.</li>
          <li>Tap <b>Analyse a pro's clip</b> below, pick the clip, tap the boxer, then <b>Save for comparison</b>.</li>
          <li>His numbers appear in this table next to yours. They never go into your training log.</li>
        </ol>
        <p class="small muted" style="margin:0">Front-on or 45° clips give the best numbers. Side-on clips still give output and rhythm.</p>
      </details>
      <button class="btn primary block" data-numbers="">Analyse a pro's clip →</button>
      ${refs.length ? `
        <p class="muted small">Your average over your last ${mine.n || 0} camera/video sessions. Numbers come from the same camera analysis, so the same limits apply to both.</p>
        <div class="tbl-wrap"><table class="tbl cmp">
          <thead><tr><th></th><th>You</th>${refs.map((r) => `<th>${esc(r.name)} <button class="linkbtn small" data-delref="${r.id}" aria-label="Remove ${esc(r.name)}">✕</button></th>`).join('')}</tr></thead>
          <tbody>${METRICS.map(([k, label, better]) => `<tr><td class="left">${esc(label)}</td><td><b>${fmtV(mine.values[k])}</b></td>${refs.map((r) => `<td>${fmtV(r.metrics[k])}${gap(mine.values[k], r.metrics[k], better)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        ${refs.some((r) => r.sidePct >= 60) ? '<p class="small muted">Clips filmed side-on: punch types (jab share) are unreliable; output, rhythm and combinations still count.</p>' : ''}`
        : ''}
    </section>`;

  $('#vidAdd', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const yt = youTubeId(f.url.value);
    if (!yt) return toast('Paste a YouTube link: in YouTube tap Share → Copy link, then paste it here.');
    st.refVideos.push({ id: newId(), yt, name: f.name.value.trim() || 'Reference', added: new Date().toISOString() });
    app.persist();
    toast('Added: tap play on the video above.');
    app.rerender();
  });
  $$('[data-numbers]', el).forEach((b) => b.addEventListener('click', () => {
    presetProVideo(b.dataset.numbers);
    location.hash = '#train/video';
  }));
  $$('[data-delvid]', el).forEach((b) => b.addEventListener('click', () => {
    st.refVideos = st.refVideos.filter((v) => v.id !== b.dataset.delvid);
    app.persist();
    app.rerender();
  }));
  $$('[data-delref]', el).forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this comparison?')) return;
    st.references = st.references.filter((r) => r.id !== b.dataset.delref);
    app.persist();
    app.rerender();
  }));
}

// "Floyd Mayweather shadowboxing" → "Floyd Mayweather" for the comparison table.
const proName = (s) => String(s || '').replace(/\s+(shadow ?boxing|pad work|mitt work|training|highlights|drill).*$/i, '').trim();
const fmtV = (v) => (v == null ? '–' : String(v));
function gap(mine, theirs, better) {
  if (mine == null || theirs == null || !better || !theirs) return '';
  const pct = Math.round(((mine - theirs) / Math.abs(theirs)) * 100);
  if (Math.abs(pct) < 5) return ' <span class="badge good">≈</span>';
  const good = better === 'up' ? pct > 0 : pct < 0;
  return ` <span class="badge ${good ? 'good' : 'warn'}">you ${pct > 0 ? '+' : ''}${pct}%</span>`;
}
