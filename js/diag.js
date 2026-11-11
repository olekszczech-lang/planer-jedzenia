// Diagnostyka: ostatni błąd aplikacji (zapisany lokalnie) dołączany do uwagi z testów,
// żeby zgłoszenie „nie działa” miało treść błędu, ekran i wersję aplikacji.
import { APP_VERSION } from './util.js';

const KEY = 'planer.lastError';

export function recordError(err, where) {
  try {
    const msg = String((err && err.message) || err || 'nieznany błąd');
    if (/ResizeObserver loop/.test(msg)) return;
    localStorage.setItem(KEY, JSON.stringify({
      t: Date.now(), msg: msg.slice(0, 300), where: where || '', hash: location.hash, ver: APP_VERSION,
      stack: String((err && err.stack) || '').split('\n').slice(0, 3).map(s => s.trim()).join(' | ').slice(0, 400),
      ua: navigator.userAgent.replace(/\s+/g, ' ').slice(0, 140)
    }));
  } catch { /* brak miejsca */ }
}

/** Ostatni błąd z ostatnich maxMin minut (albo null). */
export function lastError(maxMin = 30) {
  try {
    const e = JSON.parse(localStorage.getItem(KEY) || 'null');
    return e && Date.now() - e.t < maxMin * 60000 ? e : null;
  } catch { return null; }
}

export function clearError() { try { localStorage.removeItem(KEY); } catch { /* nic */ } }

export const describe = e => `[${e.ver}] ${e.msg}${e.where ? ' @' + e.where : ''} (${e.hash || '#/'}) ${e.stack} · ${e.ua}`;
