import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { scoreClips } from '../scripts/accuracy.mjs';

const { clips } = JSON.parse(fs.readFileSync(new URL('./fixtures/clips.json', import.meta.url)));

// Accuracy on the boxer's real clips may only go up. When a change improves it, raise the floor.
const FLOOR = { 'pads-side-on': 21, 'shadow-front-on': 44 };

test('punch types on real labelled clips never get worse', () => {
  for (const s of scoreClips(clips)) {
    assert.ok(s.n >= 40, `${s.name}: ${s.n} labelled punches`);
    assert.ok(s.pct >= FLOOR[s.name], `${s.name}: ${s.pct}% right, floor ${FLOOR[s.name]}%`);
  }
});
