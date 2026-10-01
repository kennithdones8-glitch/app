import test from 'node:test';
import assert from 'node:assert/strict';
import { setupIssue, SetupWatch } from '../web/js/camcheck.js';
import { LM } from '../web/js/form.js';

// A boxer standing in the picture: y from head (0.1) to ankles (0.9), centred.
function body(over = {}) {
  const img = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }));
  const set = (k, x, y) => { img[k] = { x, y, visibility: 0.95 }; };
  set(LM.NOSE, 0.5, 0.12);
  set(LM.L_SH, 0.56, 0.25); set(LM.R_SH, 0.44, 0.25);
  set(LM.L_HIP, 0.54, 0.5); set(LM.R_HIP, 0.46, 0.5);
  set(LM.L_WR, 0.55, 0.2); set(LM.R_WR, 0.45, 0.2);
  set(LM.L_ANK, 0.58, 0.9); set(LM.R_ANK, 0.42, 0.9);
  for (const [k, v] of Object.entries(over)) img[k] = { ...img[k], ...v };
  return img;
}

test('camera setup check names the one thing to fix', () => {
  assert.equal(setupIssue(body()), null);
  assert.equal(setupIssue(null), 'nobody');
  assert.equal(setupIssue(body({ [LM.L_ANK]: { y: 1.02 }, [LM.R_ANK]: { visibility: 0.2 } })), 'feet');
  assert.equal(setupIssue(body({ [LM.NOSE]: { y: 0.0 } })), 'head');
  // Small in the picture: too far away.
  const far = body();
  for (const p of far) { p.y = 0.4 + (p.y - 0.5) * 0.3; }
  assert.equal(setupIssue(far), 'far');
  assert.equal(setupIssue(body({ [LM.L_HIP]: { x: 0.95 }, [LM.R_HIP]: { x: 0.9 } })), 'side');
  assert.equal(setupIssue(body().map((p) => ({ ...p, visibility: 0.3 }))), 'dark');
  // Legs long next to the torso: phone on the floor.
  assert.equal(setupIssue(body({ [LM.L_SH]: { y: 0.36 }, [LM.R_SH]: { y: 0.36 }, [LM.L_HIP]: { y: 0.45 }, [LM.R_HIP]: { y: 0.45 } })), 'low');
});

test('one bad frame does not change the setup answer', () => {
  const w = new SetupWatch(10);
  for (let i = 0; i < 10; i++) w.push(body());
  assert.equal(w.push(null), null);
  for (let i = 0; i < 9; i++) w.push(null);
  assert.equal(w.issue, 'nobody');
});
