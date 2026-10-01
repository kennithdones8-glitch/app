import test from 'node:test';
import assert from 'node:assert/strict';
import { logError, buildBugReport } from '../web/js/bugreport.js';

const mem = () => { const d = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v; } }; };

test('a problem report has the words, version, phone, data counts, last session and recent errors', () => {
  const storage = mem();
  for (let i = 0; i < 25; i++) logError(`boom ${i}`, 'app.js:1', storage);
  const text = buildBugReport({
    what: ' counted punches while bouncing ', version: '2026.10.01-7', storage,
    state: { sessions: [{ date: '2026-10-01T17:06:18Z', type: 'shadow', source: 'live', tracking: 'camera', punches: { total: 92 }, calib: { frames: 2482, model: 'full' } }], profile: { stance: 'orthodox', punchLabels: [1, 2] } },
    env: { navigator: { userAgent: 'TestPhone' }, screen: { width: 390, height: 844 }, location: { hash: '#train' } },
  });
  assert.match(text, /What happened: counted punches while bouncing\n/);
  assert.match(text, /App 2026\.10\.01-7 · #train/);
  assert.match(text, /TestPhone · screen 390×844/);
  assert.match(text, /1 sessions · 2 taught punches · stance orthodox/);
  assert.match(text, /92 punches · 2482 frames · model full/);
  assert.match(text, /Recent errors \(20\):/); // only the newest 20 are kept
  assert.match(text, /boom 24/);
  assert.doesNotMatch(text, /boom 4\b/);
});
