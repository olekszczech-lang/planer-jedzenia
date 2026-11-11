// Komunikacja z Apps Script Web App + cache odczytów + kolejka zapisów offline.
import * as db from './db.js';
import { recordError } from './diag.js';

const SETTINGS_KEY = 'planer.settings';
const OUTBOX = 'outbox';
// Wersja formatu danych w pamięci telefonu. Podbij, gdy API zmienia kształt odpowiedzi –
// stare zapisy zostaną pominięte i pobrane od nowa (zamiast wywracać ekran).
const CACHE_VER = 7;
const listeners = new Set();

// Akcje zmieniające plan, sesje albo przepisy. Po nich zapisane w telefonie widoki pochodne (tydzień, dzień,
// sesje gotowania, kalendarz sesji) są nieaktualne – usuwamy je, żeby ekran nie pokazał np. Gotowania bez nowych dań.
const PLAN_CHANGES = new Set(['setMeals', 'removeMeal', 'removeOrphans', 'updateEntry', 'autoFill', 'recalcPortions', 'applyTemplate',
  'setActualWeight', 'saveSession', 'deleteSession', 'saveCookingSettings', 'updateProfile', 'addProfile', 'setSchedule',
  'saveRecipe', 'replaceIngredient', 'skipEntry', 'unskipEntry', 'recalcNutrition', 'importLibrary', 'fillProducts',
  'updateIngredients', 'migrate', 'importLibrary']);
const PLAN_CACHES = ['c:plan:', 'c:sessions:', 'c:scal:'];

const changesPlan = (action, params) => PLAN_CHANGES.has(action) ||
  (action === 'batch' && Array.isArray(params.ops) && params.ops.some(o => o && PLAN_CHANGES.has(o.action)));

/** Usuwa z pamięci telefonu zapisy o podanych prefiksach (cache to tylko przyspieszenie – błędy pomijamy). */
export async function dropCache(prefixes = PLAN_CACHES) {
  try {
    const ks = await db.keys();
    await Promise.all(ks.filter(k => typeof k === 'string' && prefixes.some(p => k.startsWith(p))).map(k => db.del(k)));
  } catch { /* nic */ }
}

export class ApiError extends Error {
  constructor(msg, network) { super(msg); this.network = !!network; }
}

export function getSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* uszkodzone ustawienia */ }
  // Lokalny serwer deweloperski (npm run dev) – działa bez konfiguracji
  if (!s.url && ['localhost', '127.0.0.1'].includes(location.hostname)) s = { url: '/api', token: 'dev', ...s };
  return s;
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url: (s.url || '').trim(), token: (s.token || '').trim() }));
}

export const isConfigured = () => !!getSettings().url;

/** Bezpośrednie wywołanie akcji API. Rzuca ApiError. */
export async function call(action, params = {}) {
  const s = getSettings();
  if (!s.url) throw new ApiError('Ustaw adres API i token w Ustawieniach.');
  let res;
  try {
    res = await fetch(s.url, {
      method: 'POST',
      // text/plain = "simple request" → brak preflight CORS (Apps Script go nie obsługuje)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...params, action, token: s.token }),
      redirect: 'follow'
    });
  } catch {
    throw new ApiError('Brak połączenia z serwerem', true);
  }
  if (!res.ok) throw new ApiError(`Błąd serwera (HTTP ${res.status})`);
  let j;
  try { j = await res.json(); } catch { throw new ApiError('Serwer zwrócił nieprawidłową odpowiedź – sprawdź adres API'); }
  if (!j.ok) throw new ApiError(j.error || 'Nieznany błąd');
  if (changesPlan(action, params)) await dropCache();
  return j.data;
}

// ── Cache odczytów ─────────────────────────────────────────

export async function readCache(key) {
  const c = await db.get('c:' + key);
  return c && c.v === CACHE_VER ? c.d : undefined;
}

export async function writeCache(key, data) {
  await db.set('c:' + key, { d: data, t: Date.now(), v: CACHE_VER });
}

/** Zmienia dane w cache (np. po lokalnej, optymistycznej zmianie). */
export async function patchCache(key, fn) {
  const d = await readCache(key);
  if (d !== undefined) await writeCache(key, fn(d) ?? d);
}

/**
 * Najpierw rysuje dane z cache (jeśli są), potem pobiera świeże i rysuje ponownie.
 * draw(data, {stale}) – stale=true dla danych z cache.
 */
export async function live(key, action, params, draw) {
  let cached = await readCache(key);
  if (cached !== undefined) {
    // zapis w pamięci telefonu, którego nie da się narysować (np. stary format), nie może blokować pobrania świeżych danych
    try { draw(cached, { stale: true }); } catch (e) { recordError(e, 'cache ' + key); cached = undefined; }
  }
  if (cached !== undefined) refreshing(1); // pasek „odświeżam” pod nagłówkiem, dopóki nie przyjdą świeże dane
  try {
    const data = await call(action, params);
    await writeCache(key, data);
    draw(data, { stale: false });
    return data;
  } catch (e) {
    if (cached === undefined) throw e;
    if (!e.network) throw e;
    return cached; // offline: zostają dane z cache
  } finally {
    if (cached !== undefined) refreshing(-1);
  }
}

let pendingFresh = 0;
function refreshing(d) {
  pendingFresh = Math.max(0, pendingFresh + d);
  document.body.classList.toggle('refreshing', pendingFresh > 0);
}

// ── Kolejka zapisów (offline) ──────────────────────────────

export function onStatus(fn) {
  listeners.add(fn);
  status().then(fn);
}

async function emit() {
  const s = await status();
  listeners.forEach(fn => fn(s));
}

let lastFlushFailed = false;

export async function status() {
  const q = (await db.get(OUTBOX)) || [];
  return { online: navigator.onLine && !lastFlushFailed, queued: q.length };
}

// Wszystkie odczyt-modyfikacja-zapis kolejki idą po kolei (inaczej dwie szybkie zmiany nadpisują się)
let outboxLock = Promise.resolve();
function withOutbox(fn) {
  const run = outboxLock.then(fn, fn);
  outboxLock = run.catch(() => {});
  return run;
}

/** Dodaje operację do kolejki i próbuje ją od razu wysłać. Operacje muszą być idempotentne. */
export async function enqueue(action, params) {
  await withOutbox(async () => {
    const q = (await db.get(OUTBOX)) || [];
    q.push({ ...params, action });
    await db.set(OUTBOX, q);
  });
  emit();
  return flush();
}

let flushing = null;

/** Wysyła kolejkę jednym żądaniem "batch". Zwraca listę błędów operacji (pustą, gdy wszystko OK). */
export function flush() {
  flushing ||= (async () => {
    try {
      const q = (await db.get(OUTBOX)) || [];
      if (!q.length) return [];
      const results = await call('batch', { ops: q });
      lastFlushFailed = false;
      await withOutbox(async () => {
        const now = (await db.get(OUTBOX)) || [];
        await db.set(OUTBOX, now.slice(q.length)); // operacje dodane w trakcie wysyłki zostają
      });
      const failed = results.map((r, i) => (r.ok ? null : { op: q[i], error: r.error })).filter(Boolean);
      if (failed.length) window.dispatchEvent(new CustomEvent('planer:sync-errors', { detail: failed }));
      return failed;
    } catch (e) {
      lastFlushFailed = !!e.network; // brak sieci → operacje czekają w kolejce
      return [];
    } finally {
      flushing = null;
      emit();
      // operacje dodane w trakcie wysyłki – wyślij od razu (o ile sieć działa)
      if (!lastFlushFailed) db.get(OUTBOX).then(q => { if (q && q.length) flush(); });
    }
  })();
  return flushing;
}

window.addEventListener('online', () => { flush(); emit(); });
window.addEventListener('offline', emit);
