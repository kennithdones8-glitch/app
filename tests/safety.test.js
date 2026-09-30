import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyNotes } from '../web/js/safety.js';

const now = new Date('2026-10-01T12:00:00Z');

test('iPhone in Safari (not Home Screen) is told to add it; the Home Screen app is not', () => {
  assert.equal(safetyNotes({ ios: true, standalone: false, now })[0][1], 'Add BoxCoach to your Home Screen');
  assert.deepEqual(safetyNotes({ ios: true, standalone: true, now }), []);
  assert.deepEqual(safetyNotes({ ios: false, standalone: false, now }), []);
});

test('backup reminder after 5 sessions with no backup, or a backup 30+ days old', () => {
  const t = (o) => safetyNotes({ ios: false, standalone: true, now, ...o }).map((n) => n[2]);
  assert.deepEqual(t({ sessions: 4 }), []);
  assert.match(t({ sessions: 5 })[0], /5 sessions live only on this phone/);
  assert.deepEqual(t({ sessions: 20, lastBackup: '2026-09-15T00:00:00Z' }), []);
  assert.match(t({ sessions: 20, lastBackup: '2026-08-20T00:00:00Z' })[0], /Last backup 42 days ago/);
});
