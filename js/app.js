// Router (hash), pasek statusu synchronizacji, rejestracja Service Workera.
import { S, ensureBoot } from './state.js';
import { onStatus, flush, isConfigured, enqueue } from './api.js';
import { toast, sheet } from './ui.js';
import { h, truthy, APP_VERSION } from './util.js';
import { recordError, lastError, clearError, describe } from './diag.js';
import * as today from './views/today.js';
import * as week from './views/week.js';
import * as shopping from './views/shopping.js';
import * as cooking from './views/cooking.js';
import * as recipes from './views/recipes.js';
import * as settings from './views/settings.js';
import * as editor from './views/editor.js';
import * as cookmode from './views/cookmode.js';
import * as timers from './timers.js';

const ROUTES = {
  dzis: { view: today, title: 'Dziś' },
  tydzien: { view: week, title: 'Tydzień' },
  zakupy: { view: shopping, title: 'Zakupy' },
  gotowanie: { view: cooking, title: 'Gotowanie' },
  przepisy: { view: recipes, title: 'Przepisy' },
  przepis: { view: recipes, title: 'Przepis', nav: 'przepisy' },
  edytor: { view: editor, title: 'Edytor przepisu', nav: 'przepisy' },
  gotuj: { view: cookmode, title: 'Tryb gotowania', nav: 'gotowanie' },
  ustawienia: { view: settings, title: 'Ustawienia', needsBoot: false }
};

const root = document.getElementById('view');
let navId = 0;
const scrollMemory = {};
let currentHash = location.hash;
window.__inAppNav = 0;

function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const name = ROUTES[path] ? path : 'dzis';
  return { name, q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

/** Kontekst przekazywany widokom. */
function makeCtx(id) {
  return {
    alive: () => id === navId,
    refresh: () => route(),
    go: hash => { if (location.hash === hash) route(); else location.hash = hash; }
  };
}

async function route() {
  const id = ++navId;
  document.querySelectorAll('.sheet-wrap').forEach(w => w.remove()); // okienka nie przechodzą na inny ekran
  if (window.__viewCleanup) { try { window.__viewCleanup(); } catch { /* widok już zamknięty */ } window.__viewCleanup = null; }
  document.body.classList.remove('cookmode');
  scrollMemory[currentHash] = window.scrollY;
  const back = scrollMemory[location.hash];
  currentHash = location.hash;
  const { name, q } = parseHash();
  const r = ROUTES[name];
  document.getElementById('title').textContent = r.title;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (r.nav || name)));
  root.innerHTML = '<div class="loading">Ładowanie…</div>';
  root.onclick = null;
  root.oninput = null;
  root.onchange = null;
  root.onsubmit = null;
  root.ontouchstart = null;
  root.ontouchend = null;

  try {
    if (r.needsBoot !== false) {
      if (!isConfigured()) { location.hash = '#/ustawienia'; return; }
      await ensureBoot();
    }
    if (id !== navId) return;
    await r.view.render(root, q, makeCtx(id), name);
    if (id === navId) window.scrollTo(0, back || 0);
  } catch (e) {
    if (id !== navId) return;
    recordError(e, 'ekran ' + name);
    document.body.classList.remove('cookmode');
    root.innerHTML = `<div class="empty">
      <p><strong>Nie udało się wczytać danych.</strong></p>
      <p class="muted">${h(e.message || e)}</p>
      <p><button class="btn" data-retry>Spróbuj ponownie</button> <button class="btn ghost" data-report>💬 Zgłoś błąd</button> <a class="btn ghost" href="#/ustawienia">Ustawienia</a></p>
    </div>`;
    root.onclick = ev => {
      if (ev.target.closest('[data-retry]')) route();
      if (ev.target.closest('[data-report]')) openFeedback({ typ: 'błąd', opis: `Ekran „${r.title}” się nie wczytuje.` });
    };
  }
}

// ── Status synchronizacji ──────────────────────────────────
const syncEl = document.getElementById('sync');
onStatus(s => {
  syncEl.hidden = s.online && !s.queued;
  syncEl.className = 'sync ' + (s.online ? 'pending' : 'offline');
  syncEl.textContent = s.online ? `Wysyłanie (${s.queued})…` : (s.queued ? `Offline · ${s.queued} czeka` : 'Offline');
  syncEl.title = s.queued ? 'Kliknij, aby spróbować wysłać teraz' : '';
});
syncEl.addEventListener('click', () => flush());
window.addEventListener('planer:sync-errors', e => {
  e.detail.forEach(f => toast(`Nie zapisano (${f.op.action}): ${f.error}`, 'error', 6000));
});

// ── Szybka uwaga z testów (trafia do arkusza „uwagi z testów”, działa też offline) ──
// prefill: {typ, opis, ekran} – np. z ekranu błędu. Ostatni błąd techniczny (≤ 30 min) można dołączyć jednym ptaszkiem.
function openFeedback(prefill = {}) {
  const ekran = prefill.ekran || `${document.getElementById('title').textContent} (${location.hash || '#/dzis'}) · ${APP_VERSION}`;
  const adults = S.boot ? S.boot.osoby.filter(o => o.Rola !== 'dziecko' && truthy(o.Aktywna)) : [];
  const last = localStorage.getItem('planer.feedbackWho') || '';
  const err = lastError();
  const typ = prefill.typ || (err ? 'błąd' : 'pomysł');
  const s = sheet('Uwaga z testów', `
    <form class="form" data-fb>
      <p class="small muted">Ekran: ${h(ekran)}</p>
      ${adults.length ? `<label>Kto<select class="input" name="kto">${adults.map(o => `<option ${o.Nazwa === last ? 'selected' : ''}>${h(o.Nazwa)}</option>`).join('')}</select></label>` : ''}
      <label>Typ<select class="input" name="typ">${['błąd', 'pomysł', 'dane w przepisie', 'wygląd', 'inne'].map(t => `<option ${t === typ ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Opis<textarea class="input" name="opis" rows="4" required placeholder="Co się stało / co zmienić?">${h(prefill.opis || '')}</textarea></label>
      ${err ? `<label class="check small"><input type="checkbox" name="diag" checked> Dołącz szczegóły ostatniego błędu: <span class="muted">${h(err.msg)}</span></label>` : ''}
      <label>Priorytet<select class="input" name="priorytet"><option>wysoki</option><option selected>średni</option><option>niski</option></select></label>
      <button class="btn">Wyślij</button>
    </form>`);
  const f = s.el.querySelector('[data-fb]');
  setTimeout(() => f.elements.opis.focus(), 60);
  let sent = false;
  f.addEventListener('submit', e => {
    e.preventDefault();
    if (sent) return; // drugie stuknięcie „Wyślij” nie dubluje uwagi
    sent = true;
    f.querySelector('button').disabled = true;
    const kto = f.elements.kto ? f.elements.kto.value : '';
    if (kto) localStorage.setItem('planer.feedbackWho', kto);
    let opis = f.elements.opis.value.trim();
    if (err && f.elements.diag && f.elements.diag.checked) { opis += '\n\n[diagnostyka] ' + describe(err); clearError(); }
    enqueue('feedback', { kto, ekran, typ: f.elements.typ.value, opis, priorytet: f.elements.priorytet.value });
    s.close();
    toast('Dzięki! Uwaga zapisana' + (navigator.onLine ? '' : ' (wyśle się po powrocie sieci)'), 'ok');
  });
}
window.__openFeedback = openFeedback;
document.getElementById('feedback').addEventListener('click', () => openFeedback());
window.addEventListener('error', e => recordError(e.error || e.message, 'okno'));
window.addEventListener('unhandledrejection', e => recordError(e.reason, 'promise'));

window.addEventListener('hashchange', () => { window.__inAppNav++; route(); });
timers.init();
route();
flush();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
