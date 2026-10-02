// Puts the pose-tracking runtime and models inside the app (web/vendor/mediapipe), for the phone
// app build: it then works offline from the first launch and downloads no code at runtime (which
// app stores require). The website doesn't need this; it loads them from the CDN.
// Run: npm run vendor
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pose = fs.readFileSync(path.join(root, 'web/js/pose.js'), 'utf8');
const version = pose.match(/const VERSION = '([^']+)'/)[1];
const out = path.join(root, 'web/vendor/mediapipe');
const tmp = fs.mkdtempSync(path.join(root, '.vendor-'));

try {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'models'), { recursive: true });
  console.log(`MediaPipe tasks-vision ${version}…`);
  const tgz = execSync(`npm pack @mediapipe/tasks-vision@${version} --silent`, { cwd: tmp }).toString().trim();
  execSync(`tar -xzf ${tgz}`, { cwd: tmp });
  fs.copyFileSync(path.join(tmp, 'package/vision_bundle.mjs'), path.join(out, 'vision_bundle.mjs'));
  fs.cpSync(path.join(tmp, 'package/wasm'), path.join(out, 'wasm'), { recursive: true });
  for (const size of ['lite', 'full', 'heavy']) {
    const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${size}/float16/1/pose_landmarker_${size}.task`;
    console.log(`model ${size}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    fs.writeFileSync(path.join(out, 'models', `pose_landmarker_${size}.task`), Buffer.from(await res.arrayBuffer()));
  }
  const mb = (p) => fs.statSync(p).size / 1e6;
  const total = [...fs.readdirSync(path.join(out, 'wasm')).map((f) => path.join(out, 'wasm', f)), ...fs.readdirSync(path.join(out, 'models')).map((f) => path.join(out, 'models', f)), path.join(out, 'vision_bundle.mjs')]
    .reduce((a, p) => a + mb(p), 0);
  console.log(`done: web/vendor/mediapipe (${total.toFixed(1)} MB)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
