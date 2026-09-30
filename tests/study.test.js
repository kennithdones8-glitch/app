import test from 'node:test';
import assert from 'node:assert/strict';
import { youTubeId, metricsOf, yourMetrics } from '../web/js/views/study.js';

test('reads YouTube links in the usual forms', () => {
  for (const u of ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ']) {
    assert.equal(youTubeId(u), 'dQw4w9WgXcQ', u);
  }
  assert.equal(youTubeId('https://vimeo.com/123'), null);
  assert.equal(youTubeId(''), null);
});

test('compares the same numbers for you and a pro', () => {
  const s = (ppm, extra = {}) => ({ workSec: 60, punches: { total: ppm, byType: { jab: ppm / 2, cross: ppm / 2, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 } }, form: { avgComboLen: 3, handReturnMs: 400, guard: 70, head: 40 }, ...extra });
  assert.deepEqual(metricsOf(s(100)), { ppm: 100, combo: 3, returnMs: 400, guard: 70, head: 40, jabShare: 50 });
  const mine = yourMetrics([s(80), s(120), s(999, { reference: true }), { type: 'run' }]);
  assert.equal(mine.n, 2);
  assert.equal(mine.values.ppm, 100);
});
