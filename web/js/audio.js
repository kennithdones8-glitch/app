// Bell, beeps and spoken cues.

let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx?.state === 'suspended') ctx.resume();
  // Prime speech on iOS, which only allows it after a user gesture.
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance('');
    window.speechSynthesis.speak(u);
  }
}

function tone(freq, start, dur, vol = 0.4) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function bell(times = 1) {
  for (let i = 0; i < times; i++) {
    tone(880, i * 0.35, 1.2, 0.5);
    tone(1320, i * 0.35, 0.9, 0.2);
  }
}

export function clap() {
  tone(1500, 0, 0.08, 0.5);
  tone(1500, 0.15, 0.08, 0.5);
}

export function tick() {
  tone(1000, 0, 0.06, 0.3);
}

let voiceOn = true;
export function setVoice(on) {
  voiceOn = on;
}

export function say(text, { interrupt = false, rate = 1.1 } = {}) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  const s = window.speechSynthesis;
  if (interrupt) s.cancel();
  else if (s.speaking || s.pending) return; // don't queue up stale cues
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  s.speak(u);
}

export function vibrate(pattern) {
  navigator.vibrate?.(pattern);
}
