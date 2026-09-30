// Round timer driven by wall-clock time so it stays accurate if the phone lags.

export class RoundTimer {
  constructor({ rounds, roundSec, restSec, prepSec = 10, onPhase = () => {}, onTick = () => {} }) {
    this.rounds = rounds;
    this.roundSec = roundSec;
    this.restSec = restSec;
    this.prepSec = prepSec;
    this.onPhase = onPhase;
    this.onTick = onTick;
    this.phase = 'idle'; // prep | work | rest | done
    this.round = 0;
    this.remainingMs = 0;
    this.workMs = 0;
    this.paused = false;
    this._last = 0;
    this._id = null;
  }

  start() {
    this._enter(this.prepSec > 0 ? 'prep' : 'work');
    this._last = performance.now();
    this._id = setInterval(() => this._loop(), 100);
  }

  _enter(phase) {
    this.phase = phase;
    if (phase === 'prep') this.remainingMs = this.prepSec * 1000;
    if (phase === 'work') {
      this.round++;
      this.remainingMs = this.roundSec * 1000;
    }
    if (phase === 'rest') this.remainingMs = this.restSec * 1000;
    if (phase === 'done') this.stop();
    this.onPhase(phase, this.round);
  }

  _loop() {
    const now = performance.now();
    const dt = now - this._last;
    this._last = now;
    if (this.paused || this.phase === 'done') return;
    const before = Math.ceil(this.remainingMs / 1000);
    // Step through the phases: if the phone slept, several may have passed, and only time spent
    // in a round counts as work.
    let left = dt;
    while (this.phase !== 'done') {
      const step = Math.max(0, Math.min(left, this.remainingMs));
      this.remainingMs -= step;
      left -= step;
      if (this.phase === 'work') this.workMs += step;
      if (this.remainingMs > 0) break;
      this._advance();
    }
    const after = Math.ceil(this.remainingMs / 1000);
    if (before !== after && this.phase !== 'done') this.onTick(this.phase, Math.max(0, after), this.round);
  }

  _advance() {
    if (this.phase === 'prep') this._enter('work');
    else if (this.phase === 'work') this._enter(this.round >= this.rounds ? 'done' : this.restSec > 0 ? 'rest' : 'work');
    else if (this.phase === 'rest') this._enter('work');
  }

  skip() {
    if (this.phase !== 'done' && this.phase !== 'idle') this._advance();
  }

  togglePause() {
    this.paused = !this.paused;
    this._last = performance.now();
    return this.paused;
  }

  stop() {
    clearInterval(this._id);
    this._id = null;
  }
}

export function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
