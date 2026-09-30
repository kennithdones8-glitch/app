// Keeping the boxer's data safe: everything lives in this browser only.
// iPhone Safari may erase a website's stored data after about 7 days without a visit, unless
// the app was added to the Home Screen; a backup file is the only copy anywhere else.

export const isStandalone = () =>
  !!(globalThis.navigator?.standalone || globalThis.matchMedia?.('(display-mode: standalone)').matches);
export const isIOS = () => /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent || '');

// Home-screen notes: [icon, title, text, link].
export function safetyNotes({ standalone, ios, sessions = 0, lastBackup = null, now = new Date() }) {
  const notes = [];
  if (ios && !standalone) {
    notes.push(['📲', 'Add BoxCoach to your Home Screen', 'In Safari tap Share → Add to Home Screen, then open it from there. Otherwise iPhone can erase your training data after a week without a visit.', '#coach/settings']);
  }
  const days = lastBackup ? Math.floor((+now - +new Date(lastBackup)) / 86400000) : null;
  if (sessions >= 5 && (days == null || days >= 30)) {
    notes.push(['💾', 'Back up your training', days == null ? `${sessions} sessions live only on this phone. Save a backup file (Coach → Settings → Export backup).` : `Last backup ${days} days ago. Save a fresh one (Coach → Settings → Export backup).`, '#coach/settings']);
  }
  return notes;
}

// Ask the browser to keep our storage when space runs low (honoured by some browsers).
export function askPersist() {
  try { globalThis.navigator?.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}
