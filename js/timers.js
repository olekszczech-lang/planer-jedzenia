// Minutniki kuchenne: kilka naraz, przetrwają przejście na inny ekran i przeładowanie (końce zapisane w localStorage).
// Po czasie: dźwięk, wibracja, powiadomienie systemowe (jeśli dozwolone) i czerwony minutnik na pasku.
const KEY = 'planer.timers';
let ticker = null;
let audio = null;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* brak miejsca */ } };

export function fmtLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

export function list() { return load(); }

/** Odblokowanie dźwięku wymaga gestu użytkownika – wołane przy starcie minutnika. */
function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* brak Web Audio */ }
}

function beep() {
  if (!audio) return;
  const t0 = audio.currentTime;
  [0, 0.35, 0.7, 1.4, 1.75, 2.1].forEach(dt => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.25);
    o.connect(g).connect(audio.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.3);
  });
}

async function notify(t) {
  try { navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 800]); } catch { /* brak */ }
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const opts = { body: t.label, tag: t.id, renotify: true, requireInteraction: true, icon: 'icons/icon-192.png' };
      if (reg) reg.showNotification('⏰ Minutnik: koniec', opts); else new Notification('⏰ Minutnik: koniec', opts);
    } catch { /* powiadomienia niedostępne */ }
  }
}

/** Start minutnika. label: co się gotuje, min: minuty. Zwraca id. */
export function start(label, min) {
  unlockAudio();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label, end: Date.now() + min * 60000, min, rang: false };
  const all = load();
  all.push(t);
  save(all);
  ensureTicker();
  render();
  return t.id;
}

export function stop(id) {
  save(load().filter(t => t.id !== id));
  render();
}

export function addMinutes(id, min) {
  const all = load();
  const t = all.find(x => x.id === id);
  if (t) { t.end = Math.max(Date.now(), t.end) + min * 60000; t.rang = false; }
  save(all);
  render();
}

function tick() {
  const all = load();
  let changed = false;
  all.forEach(t => {
    if (!t.rang && t.end <= Date.now()) { t.rang = true; changed = true; notify(t); }
  });
  if (changed) save(all);
  render();
  if (!all.length) { clearInterval(ticker); ticker = null; }
}

function ensureTicker() {
  if (!ticker) ticker = setInterval(tick, 1000);
}

/** Pasek minutników pod nagłówkiem (widoczny na każdym ekranie). */
function render() {
  let bar = document.getElementById('timers');
  const all = load();
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'timers';
    bar.className = 'timerbar';
    document.body.appendChild(bar);
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-tid]');
      if (!b) return;
      const t = load().find(x => x.id === b.dataset.tid);
      if (!t) return;
      if (t.rang || e.target.closest('[data-stop]')) stop(t.id);
      else if (e.target.closest('[data-plus]')) addMinutes(t.id, 1);
    });
  }
  bar.hidden = !all.length;
  document.body.classList.toggle('has-timers', !!all.length);
  bar.innerHTML = all.map(t => {
    const left = t.end - Date.now();
    return `<span class="timer ${t.rang ? 'rang' : ''}" data-tid="${t.id}">
      <b>${t.rang ? '⏰ KONIEC' : fmtLeft(left)}</b> <span class="tl">${escapeHtml(t.label)}</span>
      ${t.rang ? '<button data-stop aria-label="Wyłącz">✓</button>' : '<button data-plus aria-label="+1 min">+1</button><button data-stop aria-label="Usuń">✕</button>'}
    </span>`;
  }).join('');
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Wołane przy starcie aplikacji: wznawia minutniki z poprzedniej sesji. */
export function init() {
  if (load().length) { ensureTicker(); tick(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && load().length) tick(); });
}
