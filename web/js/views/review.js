// Post-session review fields: constraint compliance, pattern usage, sparring "why did you get hit".
import { CONSTRAINTS, OPPONENTS, HIT_REASONS, POSITIVES } from '../library.js';
import { patternUse } from '../analysis.js';
import { esc, opt } from '../ui.js';

export function reviewFieldsHTML(session, state) {
  const type = session.type;
  const sparring = type === 'sparring';
  const drill = type === 'mitts';
  const cons = session.constraints || [];
  const patterns = (state.patterns || []).filter((p) => p.active !== false);
  const parts = [];

  if (cons.length) {
    parts.push(`<fieldset class="review"><legend>Did you solve the problem?</legend>
      ${cons.map((c, i) => `
        <div class="rv-row">
          <div><b>R${c.round} · ${esc(CONSTRAINTS[c.key]?.name || c.key)}</b>${c.opponent ? `<span class="muted small"> vs ${esc(OPPONENTS[c.opponent].name.toLowerCase())}</span>` : ''}</div>
          ${c.auto && c.compliance != null ? `<span class="badge ${c.compliance >= 70 ? 'good' : c.compliance >= 45 ? 'warn' : 'bad'}">${c.compliance}% · camera</span>` : `
          <div class="seg" role="radiogroup" aria-label="Compliance round ${c.round}">
            ${[[100, 'Nailed'], [60, 'Partly'], [20, 'Missed']].map(([v, l]) => `<label><input type="radio" name="c${i}" value="${v}" ${c.compliance === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          </div>`}
        </div>`).join('')}
    </fieldset>`);
  }

  if (sparring) {
    const sp = session.sparring || {};
    parts.push(`<fieldset class="review"><legend>Sparring</legend>
      <div class="row3">
        <label>Rounds<input type="number" name="spRounds" min="1" max="20" value="${sp.rounds ?? session.completedRounds ?? 4}"></label>
        <label>Intensity<select name="spIntensity">${[1, 2, 3, 4, 5].map((n) => opt(n, sp.intensity ?? 3, `${n} ${['', 'technical', 'light', 'moderate', 'hard', 'war'][n]}`)).join('')}</select></label>
        <label>Partner style<select name="spStyle">${opt('', sp.partnerStyle || '', 'Unknown')}${Object.entries(OPPONENTS).map(([k, o]) => opt(k, sp.partnerStyle, o.name)).join('')}</select></label>
      </div>
      <label>Partner (optional)<input name="spPartner" maxlength="40" value="${esc(sp.partner || '')}"></label>
    </fieldset>
    <fieldset class="review"><legend>Why did you get hit?</legend>
      <p class="muted small">Tap once for each time it happened (roughly is fine).</p>
      ${Object.entries(HIT_REASONS).map(([k, r]) => `
        <div class="counter-row"><span>${esc(r.name)}</span>
          <div class="counter"><button type="button" data-dec="hit_${k}" aria-label="Less">−</button><output id="hit_${k}">${session.hits?.[k] || 0}</output><button type="button" data-inc="hit_${k}" aria-label="More">+</button></div>
        </div>`).join('')}
    </fieldset>
    <fieldset class="review"><legend>What worked?</legend>
      <div class="chipset">${Object.entries(POSITIVES).map(([k, p]) => `<label class="chipbox"><input type="checkbox" name="pos" value="${k}" ${(session.positives || []).includes(k) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div>
    </fieldset>`);
  }

  if (patterns.length && (type in { shadow: 1, bag: 1, mitts: 1, sparring: 1 })) {
    parts.push(`<fieldset class="review"><legend>Patterns you're developing</legend>
      ${patterns.map((p) => {
        const u = patternUse(p, session) || {};
        return `<div class="pat-row">
          <b>${esc(p.name)}</b>${u.auto ? '<span class="muted small"> · camera counted</span>' : ''}
          <div class="row3">
            ${drill ? `<label>Drilled reps<input type="number" min="0" name="pr_${p.id}" value="${u.reps ?? ''}"></label>` : ''}
            <label>${sparring ? 'Attempted' : 'Times used'}<input type="number" min="0" name="pu_${p.id}" value="${u.used ?? ''}"></label>
            ${sparring ? `<label>Landed<input type="number" min="0" name="pl_${p.id}" value="${u.landed ?? ''}"></label>` : ''}
          </div>
        </div>`;
      }).join('')}
    </fieldset>`);
  }
  return parts.join('');
}

export function bindReview(root) {
  root.querySelectorAll('[data-inc],[data-dec]').forEach((b) => b.addEventListener('click', () => {
    const out = root.querySelector(`#${b.dataset.inc || b.dataset.dec}`);
    out.value = out.textContent = String(Math.max(0, (+out.textContent || 0) + (b.dataset.inc ? 1 : -1)));
  }));
}

// Reads the review back into the session object.
export function readReview(root, session, state) {
  const val = (name) => root.querySelector(`[name="${name}"]`)?.value;
  (session.constraints || []).forEach((c, i) => {
    const r = root.querySelector(`[name="c${i}"]:checked`);
    if (r) { c.compliance = +r.value; c.auto = false; }
  });
  if (session.type === 'sparring') {
    session.sparring = {
      rounds: +val('spRounds') || 1, intensity: +val('spIntensity') || 3,
      partnerStyle: val('spStyle') || null, partner: (val('spPartner') || '').trim(),
    };
    session.hits = {};
    for (const k of Object.keys(HIT_REASONS)) {
      const n = +(root.querySelector(`#hit_${k}`)?.textContent || 0);
      if (n) session.hits[k] = n;
    }
    session.positives = [...root.querySelectorAll('[name="pos"]:checked')].map((x) => x.value);
  }
  const use = {};
  for (const p of (state.patterns || []).filter((x) => x.active !== false)) {
    const reps = val(`pr_${p.id}`), used = val(`pu_${p.id}`), landed = val(`pl_${p.id}`);
    const u = {};
    if (reps) u.reps = +reps;
    if (used) u.used = +used;
    if (landed) u.landed = Math.min(+landed, +used || +landed);
    if (Object.keys(u).length) use[p.id] = u;
  }
  if (Object.keys(use).length) session.patternUse = use;
  return session;
}
