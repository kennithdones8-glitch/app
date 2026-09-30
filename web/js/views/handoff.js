// Small hand-off between screens: the Study page asks the video form to open ready for a pro's clip.
let pending = null;

export function presetProVideo(name = '') {
  pending = { subject: 'pro', name };
}

export function takePreset() {
  const p = pending;
  pending = null;
  return p;
}
