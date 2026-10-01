// Offline support: cache the app shell, and cache the pose model/runtime after first use.
const CACHE = 'boxcoach-v29';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/audio.js', 'js/chart.js', 'js/coach.js', 'js/form.js', 'js/motion.js', 'js/plan.js', 'js/pose.js', 'js/store.js', 'js/timer.js',
  'js/ui.js', 'js/library.js', 'js/skills.js', 'js/analysis.js', 'js/recovery.js', 'js/hypotheses.js', 'js/engine.js', 'js/report.js',
  'js/views/review.js', 'js/views/boxer.js', 'js/views/coach.js', 'js/views/video.js', 'js/views/combos.js', 'js/combos.js', 'js/calibrate.js', 'js/views/study.js', 'js/views/handoff.js', 'js/aicheck.js', 'js/safety.js', 'js/coachme.js', 'js/views/coachme.js', 'js/personal.js', 'js/punchtest.js',
];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version never installs stale files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Network first, revalidating with the server (GitHub Pages lets browsers reuse files for
    // 10 minutes otherwise), so updates land on the next open; fall back to cache offline.
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
  } else if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});
