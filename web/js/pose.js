// Camera + MediaPipe pose tracking. Runs fully on the phone; video never leaves the device.

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let landmarkerPromise = null;

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      try {
        return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
      } catch {
        return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
      }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
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
    this.landmarker = await getLandmarker();
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
      const image = res?.landmarks?.[0] || null;
      const world = res?.worldLandmarks?.[0] || null;
      this._draw(image);
      this.onFrame(world, image, t);
    }
    this._raf = requestAnimationFrame(this._loop);
  };

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
