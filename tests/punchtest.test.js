import test from 'node:test';
import assert from 'node:assert/strict';
import { testPlan, scoreTest, testLabels } from '../web/js/punchtest.js';

const ev = (t, role, type) => ({ kind: 'punch', t, role, type, f: { ext: 0.9, angle: 150, rise: 0 }, fwd: 0.2, lat: 0.1 });

test('the test calls 10 of each punch, with stance-aware names, then a no-punch guard step', () => {
  const { steps, totalSec } = testPlan('southpaw');
  assert.deepEqual(steps.map((s) => s.want), ['jab', 'cross', 'leadHook', 'rearHook', 'leadUppercut', 'rearUppercut', null]);
  assert.match(steps[2].say, /10 right hooks/);
  assert.ok(steps.every((s, i) => !i || s.at >= steps[i - 1].end), 'steps never overlap');
  assert.ok(totalSec > 120 && totalSec < 200, `${totalSec} s`);
});

test('scores counts, types and other-hand fakes per step, and labels every detection', () => {
  const { steps } = testPlan();
  const t0 = 1000;
  const at = (k, i) => t0 + steps[k].go + 500 + i * 1700;
  const events = [
    ...Array.from({ length: 10 }, (_, i) => ev(at(0, i), 'lead', i < 8 ? 'jab' : 'leadUppercut')), // 10 jabs, 8 read right
    ev(at(0, 3) + 100, 'rear', 'rearHook'), // the idle hand
    ...Array.from({ length: 12 }, (_, i) => ev(at(1, i * 0.8), 'rear', 'cross')), // 2 extra crosses
    ev(t0 + steps[6].go + 2000, 'lead', 'leadHook'), // something counted while just moving
    { kind: 'guardDrop', t: at(0, 1) },
  ];
  const r = scoreTest(steps, events, t0);
  assert.deepEqual(r.rows[0], { want: 'jab', n: 10, got: 10, right: 8, fake: 1 });
  assert.deepEqual(r.rows[1], { want: 'cross', n: 10, got: 12, right: 12, fake: 0 });
  assert.equal(r.rows[2].got, 0);
  assert.equal(r.rows[6].fake, 1);
  assert.equal(r.thrown, 60);
  assert.equal(r.typePct, Math.round((100 * 18) / 60));
  const labels = testLabels(steps, events, t0);
  assert.equal(labels.length, 24);
  assert.equal(labels.filter((l) => l.kind === 'none').length, 2);
  assert.equal(labels.filter((l) => l.kind === 'straight').length, 22);
});

test('punch test history names the camera spot and lists the newest first', async () => {
  const { testHistory, spotName } = await import('../web/js/punchtest.js');
  assert.equal(spotName({ ratio: 2.5, side: 0.1 }), 'low / floor, front-on');
  assert.equal(spotName({ ratio: 1.7, side: 0.8 }), 'chest height, side-on');
  assert.equal(spotName(null), 'camera spot not recorded');
  const t = (date, counted) => ({ date, test: { thrown: 60, counted, typePct: 50, rows: [{ fake: 3 }, { fake: 2 }], spot: { ratio: 2.4, side: 0.1 } } });
  const h = testHistory([t('2026-10-01', 123), { date: '2026-10-02' }, t('2026-10-03', 70)]);
  assert.deepEqual(h.map((r) => r.counted), [70, 123]);
  assert.equal(h[0].fake, 5);
});
