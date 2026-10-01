// "Report a problem": what went wrong in the tester's words plus what the app knows (version,
// phone, the last errors it hit, the last session), as one block of text to send to the developer.
// Nothing is sent anywhere by the app itself; the tester picks where it goes from the share sheet.

const KEY = 'boxcoach.errors';
const MAX = 20;

function readErrors(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(KEY) || '[]'); } catch { return []; }
}

export function logError(msg, where = '', storage = globalThis.localStorage) {
  try {
    const list = [...readErrors(storage), { t: new Date().toISOString(), msg: String(msg).slice(0, 300), where: String(where).slice(0, 120), route: globalThis.location?.hash || '' }].slice(-MAX);
    storage?.setItem(KEY, JSON.stringify(list));
  } catch { /* storage full or blocked: not worth failing over */ }
}

// Keep the last few errors the app hits, so a report can include them.
export function installErrorLog() {
  window.addEventListener('error', (e) => logError(e.message, `${(e.filename || '').split('/').pop()}:${e.lineno || ''}`));
  window.addEventListener('unhandledrejection', (e) => logError(e.reason?.message || e.reason, 'promise'));
}

export function buildBugReport({ what, version, state, storage = globalThis.localStorage, env = globalThis }) {
  const nav = env.navigator || {};
  const last = (state?.sessions || []).at(-1);
  const lines = [
    'BOXCOACH PROBLEM REPORT',
    `What happened: ${what?.trim() || '(not described)'}`,
    `App ${version} · ${env.location?.hash || ''} · ${env.matchMedia?.('(display-mode: standalone)').matches ? 'home-screen app' : 'browser'}`,
    `Phone: ${nav.userAgent || 'unknown'} · screen ${env.screen?.width || '?'}×${env.screen?.height || '?'}`,
    `Data: ${(state?.sessions || []).length} sessions · ${(state?.profile?.punchLabels || []).length} taught punches · stance ${state?.profile?.stance || '?'}`,
  ];
  if (last) {
    lines.push(`Last session: ${last.date?.slice(0, 16)} ${last.type} · ${last.source || ''} · ${last.tracking} · ${last.punches?.total ?? '–'} punches · ${last.calib?.frames ?? '–'} frames · model ${last.calib?.model || '–'}`);
  }
  const errs = readErrors(storage);
  lines.push(errs.length ? `Recent errors (${errs.length}):` : 'Recent errors: none');
  for (const e of errs.slice(-8)) lines.push(`- ${e.t.slice(5, 16)} ${e.route} ${e.where}: ${e.msg}`);
  return lines.join('\n');
}
