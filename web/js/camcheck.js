// Camera setup check: before the round starts, tell the boxer the one thing to fix so tracking
// starts right (whole body in view, not too far, enough light), from the picture alone.
import { LM } from './form.js';

const VIS = 0.5;
export const SETUP_TEXT = {
  nobody: 'Step into the picture',
  feet: 'Step back so I can see your feet',
  head: 'Step back, your head is cut off',
  far: 'Come a little closer',
  side: 'Move to the middle of the picture',
  dark: 'Too dark: face a light',
  low: 'Phone looks low. Chest height reads punches best',
};

// One frame: the first problem found, or null when the setup is good. `low` is only a tip.
export function setupIssue(image) {
  if (!image) return 'nobody';
  const v = (k) => image[k]?.visibility ?? 1;
  const y = (k) => image[k].y;
  const keys = [LM.NOSE, LM.L_SH, LM.R_SH, LM.L_HIP, LM.R_HIP, LM.L_WR, LM.R_WR];
  if (keys.reduce((a, k) => a + v(k), 0) / keys.length < 0.45) return 'dark';
  if (v(LM.NOSE) < VIS || y(LM.NOSE) < 0.02) return 'head';
  const feetIn = [LM.L_ANK, LM.R_ANK].every((k) => v(k) >= VIS && y(k) < 0.985);
  if (!feetIn) return 'feet';
  const ankleY = (y(LM.L_ANK) + y(LM.R_ANK)) / 2;
  if (ankleY - y(LM.NOSE) < 0.35) return 'far';
  const hipX = (image[LM.L_HIP].x + image[LM.R_HIP].x) / 2;
  if (hipX < 0.15 || hipX > 0.85) return 'side';
  // Seen from a phone on the floor the legs look long next to the torso (level: about 1.6×).
  const torso = (y(LM.L_HIP) + y(LM.R_HIP)) / 2 - (y(LM.L_SH) + y(LM.R_SH)) / 2;
  const legs = ankleY - (y(LM.L_HIP) + y(LM.R_HIP)) / 2;
  if (torso > 0 && legs / torso > 2.2) return 'low';
  return null;
}

// Over the last ~1.5 s: the issue seen in most frames (one bad frame doesn't nag; with no clear
// majority the previous answer stands).
export class SetupWatch {
  constructor(n = 45) { this.n = n; this.hist = []; this.issue = 'nobody'; }
  push(image) {
    this.hist.push(setupIssue(image));
    if (this.hist.length > this.n) this.hist.shift();
    const counts = new Map();
    for (const k of this.hist) counts.set(k, (counts.get(k) || 0) + 1);
    const [top, c] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (c >= this.hist.length * 0.6) this.issue = top;
    return this.issue;
  }
}
