// Camera + MediaPipe pose tracking. Runs fully on the phone; video never leaves the device.

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const modelUrl = (size) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/1/pose_landmarker_${size}.task`;
// Live camera: the 'full' model tracks arms noticeably better than 'lite'. It is used when the
// phone keeps up; if it can't (measured in the first seconds), the tracker drops to 'lite' and
// remembers that for next time.
const LIVE_PREF = 'boxcoach.liveModel';
const livePromises = {};

export async function getLandmarker(size = 'lite') {
  if (!livePromises[size]) {
    livePromises[size] = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: modelUrl(size), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      try {
        return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
      } catch {
        return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
      }
    })();
    livePromises[size].catch(() => { delete livePromises[size]; });
  }
  return livePromises[size];
}

// Median time per frame (ms) above which the full model is too slow for live coaching (~22 fps).
export const LIVE_SLOW_MS = 45;
// 'lite' is remembered for 14 days, then the full model gets another try (Low Power Mode, a
// busy phone or an older browser version can make one session slow).
export function pickLiveModel(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const [m, at] = String(storage?.getItem(LIVE_PREF) || '').split('@');
    return m === 'lite' && now - (+at || 0) < 14 * 86400000 ? 'lite' : 'full';
  } catch { return 'full'; }
}
export function tooSlow(times) {
  if (times.length < 30) return null;
  const s = [...times].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] > LIVE_SLOW_MS;
}

// Separate instance for video files: up to 2 people (pads/sparring), and its own timestamp
// clock so it never conflicts with the live camera (MediaPipe needs increasing timestamps).
// Videos aren't real-time, so they can use a bigger, more accurate model:
// 'lite' (6 MB, fastest), 'full' (9 MB), 'heavy' (30 MB, most accurate, slowest).
const videoLandmarkers = {};
let videoLastTs = 0;

export async function getVideoLandmarker(size = 'full') {
  if (!videoLandmarkers[size]) {
    videoLandmarkers[size] = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: modelUrl(size), delegate }, runningMode: 'VIDEO', numPoses: 2 });
      try {
        return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
      } catch {
        return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
      }
    })();
    videoLandmarkers[size].catch(() => { delete videoLandmarkers[size]; });
  }
  return videoLandmarkers[size];
}

export function detectVideoFrame(lm, source) {
  videoLastTs = Math.max(videoLastTs + 1, Math.round(performance.now()));
  return lm.detectForVideo(source, videoLastTs);
}

const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

export class PoseTracker {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.stream = null;
    this.running = false;
    this.onFrame = () => {};
    this.facing = 'user';
  }

  async start(facing = this.facing) {
    this.facing = facing;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera needs the app to be opened over https://');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirror', facing === 'user');
    this.canvas.classList.toggle('mirror', facing === 'user');
    await this.video.play();
    this.model = pickLiveModel();
    try {
      this.landmarker = await getLandmarker(this.model);
    } catch {
      this.model = 'lite';
      this.landmarker = await getLandmarker('lite');
    }
    this.times = [];
    this.running = true;
    this._lastVideoTime = -1;
    this._loop();
  }

  async flip() {
    this.stopCamera();
    await this.start(this.facing === 'user' ? 'environment' : 'user');
  }

  _loop = () => {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = v.currentTime;
      const t = performance.now();
      let res;
      try {
        res = this.landmarker.detectForVideo(v, t);
      } catch {
        res = null;
      }
      this._checkSpeed(performance.now() - t);
      const image = res?.landmarks?.[0] || null;
      const world = res?.worldLandmarks?.[0] || null;
      this._draw(image);
      this.onFrame(world, image, t);
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  // Too slow for the full model? Switch to lite for the rest of this and future sessions.
  _checkSpeed(ms) {
    if (this.model !== 'full' || this.switching || this.times.length >= 60) return;
    this.times.push(ms);
    if (tooSlow(this.times)) {
      this.switching = true;
      try { localStorage.setItem(LIVE_PREF, `lite@${Date.now()}`); } catch { /* private mode */ }
      getLandmarker('lite').then((lm) => { this.landmarker = lm; this.model = 'lite'; }).catch(() => {}).finally(() => { this.switching = false; });
    }
  }

  _draw(pts) {
    const c = this.canvas;
    const v = this.video;
    if (c.width !== v.videoWidth) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (!pts) return;
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    for (const [a, b] of BONES) {
      if ((pts[a].visibility ?? 1) < 0.5 || (pts[b].visibility ?? 1) < 0.5) continue;
      g.beginPath();
      g.moveTo(pts[a].x * c.width, pts[a].y * c.height);
      g.lineTo(pts[b].x * c.width, pts[b].y * c.height);
      g.stroke();
    }
    g.fillStyle = '#ff3b3b';
    for (const i of [15, 16]) {
      g.beginPath();
      g.arc(pts[i].x * c.width, pts[i].y * c.height, 9, 0, Math.PI * 2);
      g.fill();
    }
  }

  stopCamera() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
  }

  stop() {
    this.stopCamera();
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
