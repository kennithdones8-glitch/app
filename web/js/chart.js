// Small single-series SVG line chart with tap/hover tooltip.

const W = 340, H = 150, PAD = { l: 34, r: 10, t: 12, b: 22 };

export function lineChart(el, points, { min = 0, max = null, unit = '', target = null, label = '' } = {}) {
  if (!points.length) {
    el.innerHTML = '<p class="muted small">No data yet — train to see this chart.</p>';
    return;
  }
  const ys = points.map((p) => p.y);
  const hi = max ?? Math.max(10, ...ys, target ?? 0) * 1.1;
  const lo = min;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const ticks = [lo, lo + (hi - lo) / 2, hi].map((v) => Math.round(v));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');

  el.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
        ${ticks.map((t) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${PAD.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        ${target != null ? `<line class="target" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(target)}" y2="${y(target)}"/><text class="axis" x="${W - PAD.r}" y="${y(target) - 4}" text-anchor="end">target</text>` : ''}
        <path class="line" d="${path}"/>
        ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.y)}" r="4"/>`).join('')}
        <text class="axis" x="${PAD.l}" y="${H - 4}">${points[0].x}</text>
        ${points.length > 1 ? `<text class="axis" x="${W - PAD.r}" y="${H - 4}" text-anchor="end">${points[points.length - 1].x}</text>` : ''}
        <line class="cross" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" visibility="hidden"/>
        <rect class="hit" x="${PAD.l}" y="0" width="${iw}" height="${H}" fill="transparent"/>
      </svg>
      <div class="tip" hidden></div>
    </div>`;

  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  const cross = el.querySelector('.cross');
  const show = (evt) => {
    const r = svg.getBoundingClientRect();
    const sx = ((evt.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i; });
    const p = points[best];
    cross.setAttribute('x1', x(best));
    cross.setAttribute('x2', x(best));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${p.y}${unit}</b> <span>${p.x}</span>`;
    const left = (x(best) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 40), r.width - 40)}px`;
    tip.style.top = `${(y(p.y) / H) * r.height - 8}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}
