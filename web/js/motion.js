// Accelerometer punch counter for when the phone is held in a hand or strapped to a wrist.

export class PunchDetector {
  constructor({ threshold = 18, refractoryMs = 220 } = {}) {
    this.threshold = threshold;
    this.refractoryMs = refractoryMs;
    this.inPeak = false;
    this.peak = 0;
    this.lastPunch = -Infinity;
  }

  // Acceleration without gravity (m/s^2). Returns {t, peak} when a punch completes.
  push(ax, ay, az, t) {
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!this.inPeak) {
      if (mag >= this.threshold && t - this.lastPunch >= this.refractoryMs) {
        this.inPeak = true;
        this.peak = mag;
      }
      return null;
    }
    this.peak = Math.max(this.peak, mag);
    if (mag < this.threshold * 0.6) {
      this.inPeak = false;
      this.lastPunch = t;
      return { t, peak: this.peak };
    }
    return null;
  }
}

export function motionSupported() {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

// iOS needs an explicit permission prompt triggered by a tap.
export async function requestMotionPermission() {
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') {
    const res = await DME.requestPermission();
    return res === 'granted';
  }
  return motionSupported();
}

export function startMotion({ sensitivity = 1, onPunch }) {
  const detector = new PunchDetector({ threshold: 18 / Math.max(0.3, sensitivity) });
  const handler = (e) => {
    let a = e.acceleration;
    if (!a || a.x == null) {
      // Fall back to raw readings minus approximate gravity.
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      const mag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
      a = { x: mag - 9.81, y: 0, z: 0 };
    }
    const hit = detector.push(a.x || 0, a.y || 0, a.z || 0, performance.now());
    if (hit) onPunch(hit);
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}
