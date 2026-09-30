// How well the punch classifier reads real, labelled clips (tests/fixtures/clips.json).
// Run: npm run accuracy
import fs from 'fs';
import { classifyFeatures, PUNCH_TYPE, PUNCH_DIGIT } from '../web/js/form.js';

export function scoreClips(clips, cal = null) {
  return clips.map((c) => {
    let n = 0, right = 0;
    const confusion = {};
    for (const [hand, label, ext, angle, rise, lat, fwd] of c.punches) {
      if (label === '.') continue;
      const role = hand === 'L' ? 'lead' : 'rear';
      const got = String(PUNCH_DIGIT[PUNCH_TYPE[classifyFeatures({ ext, angle, rise }, fwd, lat, cal).kind][role]]);
      n++;
      if (got === label) right++;
      else confusion[`${label}→${got}`] = (confusion[`${label}→${got}`] || 0) + 1;
    }
    return { name: c.name, camera: c.camera, labels: c.labels, n, right, pct: n ? Math.round((right / n) * 100) : null, confusion };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { clips } = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/clips.json', import.meta.url)));
  for (const s of scoreClips(clips)) {
    const top = Object.entries(s.confusion).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ×${v}`).join(', ');
    console.log(`${s.name.padEnd(18)} ${s.camera.padEnd(5)} ${String(s.pct).padStart(3)}% right (${s.right}/${s.n})${top ? `  · mistakes: ${top}` : ''}`);
  }
}
