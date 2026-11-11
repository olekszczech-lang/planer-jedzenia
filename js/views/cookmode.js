// Tryb gotowania: pełny ekran, jeden krok naraz, duże litery, ilości po przeliczeniu, minutniki,
// ekran nie gaśnie. Odhaczone kroki są wspólne z listą sesji (ten sam klucz w localStorage).
//   #/gotuj?w=<pon>&s=<nr sesji>                  – cała sesja (niedziela/środa)
//   #/gotuj?w=<pon>&s=9&d=<dzień>&id=<ID_Pot>     – danie „na świeżo” danego dnia
//   #/gotuj?przepis=<ID_Pot>&x=<mnożnik>          – pojedynczy przepis
import { S } from '../state.js';
import { readCache, writeCache, call } from '../api.js';
import { openLabels } from '../labels.js';
import * as timers from '../timers.js';
import { busy, toast } from '../ui.js';
import { h, fmtNum, fmtQty, fmtDay, mondayOf, today, isKey, num } from '../util.js';
import { recordError } from '../diag.js';
import { normSessions } from './cooking.js';

const DONE_KEY = 'planer.sessionDone';

/** Plan sesji w aktualnym formacie (stary zapis w pamięci telefonu nie może wywrócić trybu). */
const validSessions = d => !!d && Array.isArray(d.sesje) && Array.isArray(d.swieze) && d.sesje.every(s => s
  && ['potrawy', 'dania', 'mise', 'przygotowanie', 'marynaty', 'bazy', 'piekarnik', 'skladanie', 'chlodzenie', 'porcjowanie', 'pakowanie', 'dni'].every(k => Array.isArray(s[k])));

async function loadSessions(w) {
  const key = 'sessions:' + w;
  const cached = await readCache(key);
  if (validSessions(cached)) return normSessions(cached);
  const data = await call('sessions', { from: w });
  await writeCache(key, data);
  if (!validSessions(data)) throw new Error('Plan sesji z serwera ma nieznany format – zaktualizuj API (clasp push i wdrożenie).');
  return normSessions(data);
}

function showError(root, e, exitHash) {
  recordError(e, 'tryb gotowania');
  document.body.classList.remove('cookmode');
  root.innerHTML = `<div class="empty cm-error">
    <p><strong>Nie udało się otworzyć trybu gotowania.</strong></p>
    <p class="muted">${h(e.message || e)}</p>
    <p><a class="btn" href="${h(exitHash)}">‹ Wróć</a> <button class="btn ghost" data-report>💬 Zgłoś błąd</button></p>
  </div>`;
  root.onclick = ev => {
    if (ev.target.closest('[data-report]') && window.__openFeedback) window.__openFeedback({ typ: 'błąd', opis: 'Tryb gotowania się nie otwiera.' });
  };
}
const SPRZET = { piekarnik: '🔥 piekarnik', garnek: '🍲 garnek', patelnia: '🍳 patelnia', blender: '🌀 blender', mikrofala: '📟 mikrofala' };
const BASE_MIN = [[/kuskus/i, 5], [/bulgur|gryczan|jaglan|komos|quinoa/i, 15], [/pęczak|jęczmien/i, 30], [/ryż.*(brąz|dzik|pełno)/i, 30], [/ryż/i, 15], [/makaron/i, 10], [/ziemniak|batat/i, 20]];
const baseMin = b => (BASE_MIN.find(([re]) => re.test(b.Nazwa)) || [0, 20])[1];

/**
 * „Po 1 h dodaj…” → minutnik odliczający do tego kroku dostaje krok, który rozpoczął proces
 * (ostatni wcześniejszy krok trwający co najmniej tyle), np. nastawienie rosołu. Zwraca [minuty dla kroku].
 */
function waits(kroki) {
  const out = kroki.map(() => 0);
  kroki.forEach((k, j) => {
    const m = /^\s*po\s+(\d+(?:[.,]\d+)?)\s*(h\b|godz|min)/i.exec(k.opis || '');
    if (!m || !j) return;
    const min = Math.round(parseFloat(m[1].replace(',', '.')) * (/^min/i.test(m[2]) ? 1 : 60));
    let i = j - 1;
    for (let t = j - 1; t >= 0; t--) if (num(kroki[t].czas) >= min) { i = t; break; }
    out[i] = min;
  });
  return out;
}

const loadDone = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { return {}; } };
const saveDone = d => { try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch { /* brak miejsca */ } };

/** Składniki kroku dla przepisu z biblioteki (tryb pojedynczego przepisu). */
function recipeIngredients(idPot, names, mult) {
  const rows = S.idx.rec[idPot] || [];
  return String(names || '').split('|').map(n => n.trim()).filter(Boolean).map(n => {
    const rs = rows.filter(r => (S.idx.skl[r.ID_Skl] || {}).Nazwa === n);
    const q = rs.reduce((a, r) => a + num(r.Ilosc), 0);
    return { nazwa: n, przepis: rs.length ? q : null, plan: rs.length ? Math.round(q * mult * 10) / 10 : null, jedn: (rs[0] || {}).Jednostka || 'g' };
  });
}

const step = (k, key, extra = {}) => ({ kind: 'step', k, key, ...extra });

function sessionPages(s) {
  const key = k => `${s.data}|${k}`;
  const pages = [{ kind: 'intro-session', s }];
  const early = s.dania.filter(d => /pierwsze/.test(d.start || ''));
  early.forEach(d => pages.push(step(d.kroki[0], key(`dish|${s.dania.indexOf(d)}|0`), { note: '▶️ Nastaw najpierw – gotuje się w tle, gdy kroisz resztę.', wait: waits(d.kroki)[0] })));
  const CH = 7;
  for (let i = 0; i < s.mise.length; i += CH) {
    pages.push({ kind: 'mise', items: s.mise.slice(i, i + CH).map((x, j) => ({ ...x, key: key(`mise|${i + j}`) })),
      part: Math.floor(i / CH) + 1, parts: Math.ceil(s.mise.length / CH) });
  }
  s.przygotowanie.forEach((k, i) => pages.push(step(k, key('prep|' + i))));
  s.marynaty.forEach((k, i) => pages.push(step(k, key('mar|' + i), { note: 'Zamarynuj teraz – mięso „pracuje”, gdy gotujesz resztę.' })));
  s.bazy.forEach((b, i) => pages.push({ kind: 'baza', b, key: key('baza|' + i) }));
  let ovenShown = false;
  s.dania.forEach((d, di) => d.kroki.forEach((k, ki) => {
    if (ki === 0 && early.includes(d)) return;
    if (!ovenShown && k.sprzet === 'piekarnik' && s.piekarnik.length) { pages.push({ kind: 'oven', slots: s.piekarnik }); ovenShown = true; }
    pages.push(step(k, key(`dish|${di}|${ki}`), { wait: waits(d.kroki)[ki] }));
  }));
  s.skladanie.forEach((k, i) => pages.push(step(k, key('skl|' + i))));
  pages.push({ kind: 'chill', key: key('chl|0') });
  s.chlodzenie.forEach((k, i) => pages.push(step(k, key('chl|' + (i + 1)))));
  s.porcjowanie.forEach(d => pages.push({ kind: 'portion', d }));
  pages.push({ kind: 'finish-session', s });
  return pages;
}

/** Składniki całego przepisu × mnożnik (z przygotowaniem i sekcją). */
const scaledIngredients = (id, x) => (S.idx.rec[id] || []).map(r => ({ nazwa: (S.idx.skl[r.ID_Skl] || {}).Nazwa, ilosc: num(r.Ilosc) * x, jedn: r.Jednostka || 'g', prep: r.Przygotowanie || '', sekcja: r.Sekcja }));

function freshPages(day, p) {
  const pages = [{ kind: 'intro-dish', title: p.Nazwa, mult: p.mnoznik, sub: fmtDay(day, true), porcje: p.porcje, ing: scaledIngredients(p.ID_Pot, p.mnoznik) }];
  p.kroki.forEach((k, ki) => pages.push(step(k, `${day}|fresh|${p.ID_Pot}|${ki}`, { wait: waits(p.kroki)[ki] })));
  pages.push({ kind: 'finish-dish', title: p.Nazwa });
  return pages;
}

function recipePages(id, x) {
  const p = S.idx.pot[id];
  const ing = scaledIngredients(id, x);
  const pages = [{ kind: 'intro-dish', title: p.Nazwa, mult: x, ing, recipe: id }];
  const kroki = S.idx.kroki[id] || [];
  kroki.forEach((k, ki) => pages.push(step({
    potrawa: p.Nazwa, opis: k.Opis, etap: k.Etap, sprzet: k.Sprzet, temp: num(k.Temp_C) || '', czas: num(k.Czas_min), aktywnie: num(k.Aktywny_min),
    dziecko: num(k.Dziecko) || '', kiedy: k.Kiedy, mnoznik: x, skladniki: recipeIngredients(id, k.Skladniki, x)
  }, `recipe|${id}|${x}|${ki}`, { wait: waits(kroki.map(r => ({ opis: r.Opis, czas: r.Czas_min })))[ki] })));
  pages.push({ kind: 'finish-dish', title: p.Nazwa });
  return pages;
}

export async function render(root, q, ctx) {
  let pages, exitHash, modeKey, sessionRef = null;
  const w = mondayOf(isKey(q.w) ? q.w : today());
  exitHash = q.przepis ? '#/przepis?id=' + encodeURIComponent(q.przepis) : `#/gotowanie?w=${w}&s=${q.s || 0}`;
  root.innerHTML = '<div class="loading">Układam kroki…</div>';

  try {
  if (q.przepis) {
    if (!S.idx.pot[q.przepis]) { root.innerHTML = '<div class="empty"><p>Nie ma takiego przepisu.</p></div>'; return; }
    const x = num(q.x) || 1;
    pages = recipePages(q.przepis, x);
    exitHash = '#/przepis?id=' + encodeURIComponent(q.przepis);
    modeKey = 'r|' + q.przepis + '|' + x;
  } else {
    const data = await loadSessions(w);
    if (Number(q.s) === 9) {
      const day = data.swieze.find(d => d.data === q.d);
      const p = day && day.potrawy.find(x => x.ID_Pot === q.id);
      if (!p) { root.innerHTML = '<div class="empty"><p>Nie znalazłem tego dania w planie.</p></div>'; return; }
      pages = freshPages(day.data, p);
      modeKey = 'f|' + day.data + '|' + p.ID_Pot;
    } else {
      sessionRef = data.sesje[Number(q.s) || 0];
      if (!sessionRef || !sessionRef.potrawy.length) { root.innerHTML = '<div class="empty"><p>W tej sesji nie ma nic do gotowania.</p></div>'; return; }
      pages = sessionPages(sessionRef);
      modeKey = 's|' + sessionRef.data;
    }
  }
  if (!pages || pages.length < 2) throw new Error('Brak kroków do pokazania – przepis nie ma etapów (uzupełnij go w edytorze).');
  } catch (e) {
    showError(root, e, exitHash);
    return;
  }

  const posKey = 'planer.cm.' + modeKey;
  let i = Math.min(Number(sessionStorage.getItem(posKey)) || 0, pages.length - 1);
  let done = loadDone();
  let recipeMult = num(q.x) || 1;

  // ── ekran nie gaśnie + pełny ekran ──
  document.body.classList.add('cookmode');
  let lock = null;
  const acquire = async () => { try { if ('wakeLock' in navigator && !document.hidden) lock = await navigator.wakeLock.request('screen'); } catch { /* brak zgody */ } };
  const onVis = () => { if (!document.hidden) acquire(); };
  acquire();
  document.addEventListener('visibilitychange', onVis);
  const onKey = e => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
  document.addEventListener('keydown', onKey);
  window.__viewCleanup = () => {
    document.body.classList.remove('cookmode');
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    try { lock && lock.release(); } catch { /* już zwolniony */ }
  };

  const ingTable = (list, mult) => !list || !list.length ? '' : `<table class="cm-ing">${list.map(x => `<tr>
      <td>${h(x.nazwa)}</td><td class="num"><b>${x.plan === null ? '–' : h(fmtQty(x.plan, x.jedn))}</b>${mult && Math.abs(mult - 1) > 0.05 && x.przepis !== null ? `<br><small>przepis ${h(fmtQty(x.przepis, x.jedn))}</small>` : ''}</td></tr>`).join('')}</table>`;
  const timerBtn = (min, label) => min >= 2 ? `<button class="btn cm-timer" data-timer="${min}" data-label="${h(label)}">⏱ Minutnik ${fmtNum(min)} min</button>` : '';
  const isDone = k => !!done[k];

  const body = pg => {
    switch (pg.kind) {
      case 'intro-session': {
        const s = pg.s;
        const gear = {};
        s.dania.forEach(d => d.kroki.forEach(k => { if (SPRZET[k.sprzet]) gear[k.sprzet] = (gear[k.sprzet] || new Set()).add(d.Nazwa); }));
        const oven = s.piekarnik[0];
        return `<p class="cm-kicker">Sesja ${h(s.nazwa)} · ${h(fmtDay(s.data, true))}</p>
          <h2 class="cm-title">${s.potrawy.length} dań · ok. ${fmtNum(s.czas_min / 60, 1)} h</h2>
          <ul class="cm-list">${s.potrawy.map(p => `<li>${h(p.Nazwa)} <small>×${fmtNum(p.mnoznik, 2)}</small></li>`).join('')}</ul>
          <h3>Przygotuj stanowisko</h3>
          <ul class="cm-list">
            ${Object.keys(gear).map(g => `<li>${SPRZET[g]}: ${gear[g].size} ${gear[g].size === 1 ? 'danie' : 'dania'}</li>`).join('')}
            ${oven ? `<li>Rozgrzej piekarnik: ${oven.gora.temp}°C${oven.dol && oven.dol.temp !== oven.gora.temp ? ` (dual cook: dół ${oven.dol.temp}°C)` : ''}</li>` : ''}
            <li>Deski: osobna na mięso. Miski na pokrojone składniki, podpisane nazwą dania.</li>
            <li>Płytkie pojemniki do studzenia, woreczki do zgrzewarki, etykiety.</li>
          </ul>
          <p class="cm-hint">Przesuwaj palcem w lewo/prawo albo używaj przycisków na dole. Minutniki działają w tle – widać je na górze ekranu.</p>`;
      }
      case 'intro-dish': {
        const groups = [...new Set(pg.ing.map(x => x.sekcja || 'Główne'))];
        return `<p class="cm-kicker">${h(pg.sub || 'Przepis')}</p>
          <h2 class="cm-title">${h(pg.title)}</h2>
          ${pg.recipe ? `<div class="chips">${[0.5, 1, 2, 3].map(m => `<button class="chip ${m === pg.mult ? 'on' : ''}" data-mult="${m}">× ${fmtNum(m, 1)}</button>`).join('')}</div>` : `<p class="cm-hint">× ${fmtNum(pg.mult, 2)} przepisu</p>`}
          ${pg.porcje ? `<ul class="cm-list">${pg.porcje.map(x => `<li>${h(x.osoba)}: <b>${fmtNum(x.gramy)} g</b> <small>${fmtNum(x.kcal)} kcal</small></li>`).join('')}</ul>` : ''}
          ${pg.ing.length ? groups.map(g => `${groups.length > 1 ? `<h3>${h(g)}</h3>` : '<h3>Składniki</h3>'}
            <table class="cm-ing">${pg.ing.filter(x => (x.sekcja || 'Główne') === g).map(x => `<tr><td>${h(x.nazwa)}${x.prep ? `<br><small>${h(x.prep)}</small>` : ''}</td><td class="num"><b>${h(fmtQty(x.ilosc, x.jedn))}</b></td></tr>`).join('')}</table>`).join('') : ''}`;
      }
      case 'mise':
        return `<p class="cm-kicker">🔪 Przygotowanie składników ${pg.parts > 1 ? pg.part + '/' + pg.parts : ''}</p>
          <h2 class="cm-title">Pokrój i odłóż do misek</h2>
          <div class="cm-checks">${pg.items.map(x => `<label class="cm-check ${isDone(x.key) ? 'done' : ''}"><input type="checkbox" data-done="${h(x.key)}" ${isDone(x.key) ? 'checked' : ''}>
            <span>${x.mieso ? '🥩 ' : ''}<b>${h(x.nazwa)}</b> – ${h(x.przygotowanie)}<br><big>${h(fmtQty(x.ilosc, x.jedn))}</big><br>
            <small>${x.dla.map(d => `${h(d.potrawa)} <span class="nw">${h(fmtQty(d.ilosc, x.jedn))}</span>`).join(' · ')}</small></span></label>`).join('')}</div>
          ${pg.items.some(x => x.mieso) ? '<p class="cm-hint">🥩 Mięso na końcu, na osobnej desce. Umyj ręce i nóż po mięsie.</p>' : ''}`;
      case 'baza':
        return `<p class="cm-kicker">🍚 Wspólna baza</p>
          <h2 class="cm-title">${h(pg.b.Nazwa)}: ${h(fmtQty(pg.b.ilosc, 'g'))}</h2>
          <p class="cm-text">Ugotuj w jednym garnku dla: ${pg.b.dla.map(x => `${h(x.potrawa)} (${h(fmtQty(x.ilosc, 'g'))})`).join(', ')}.</p>
          <p class="cm-hint">${h(pg.b.uwaga)}</p>
          ${timerBtn(baseMin(pg.b), pg.b.Nazwa)}`;
      case 'oven':
        return `<p class="cm-kicker">🔥 Piekarnik (dual cook)</p><h2 class="cm-title">Plan stref</h2>
          ${pg.slots.map(o => `<div class="oven"><div><small>Góra</small><br><b>${h(o.gora.potrawa)}</b><br>${o.gora.temp}°C · ${o.gora.czas} min</div>
            <div><small>Dół</small><br>${o.dol ? `<b>${h(o.dol.potrawa)}</b><br>${o.dol.temp}°C · ${o.dol.czas} min` : 'wolne'}</div></div>`).join('')}`;
      case 'chill':
        return `<p class="cm-kicker">❄️ Chłodzenie</p><h2 class="cm-title">Do płytkich pojemników</h2>
          <p class="cm-text">Gorące dania rozłóż do płytkich pojemników, bez pokrywek. Do lodówki najpóźniej po 2 godzinach od ugotowania.</p>
          ${timerBtn(120, 'Chłodzenie – wstaw do lodówki')}`;
      case 'portion': {
        const d = pg.d;
        return `<p class="cm-kicker">📦 Porcjowanie</p><h2 class="cm-title">${h(d.Nazwa)}</h2>
          <p class="cm-hint">Plan: ≈ ${h(fmtQty(d.waga_plan, 'g'))}. Zważ gotowe danie – porcje przeliczą się same.</p>
          ${d.paczka ? '' : `<input class="input cm-weight" type="number" inputmode="numeric" placeholder="Waga gotowego dania (g)" data-weight>`}
          <table class="cm-ing" data-portions>${d.porcje.map((p, pi) => `<tr><td>${h(fmtDay(p.data))} · ${h(p.typ)}<br><b>${h(p.osoba)}</b>${/^lunchbox/.test(p.miejsce || '') ? ' 📦' : ''}${p.akcja === 'zamrażarka' ? ' ❄️' : ''}${d.paczka && p.dodajPo ? `<br><small>${h(p.dodajPo)}</small>` : ''}</td>
            <td class="num"><b data-pg="${pi}">${fmtNum(p.gramy)} g</b></td></tr>`).join('')}</table>
          <div class="cm-row">${d.paczka ? '' : '<button class="btn ghost" data-saveweight>Zapisz wagę</button>'}<button class="btn ghost" data-labels>🏷️ Etykiety</button></div>`;
      }
      case 'finish-session': {
        const frozen = pg.s.pakowanie.filter(p => p.akcja === 'zamrażarka').length;
        return `<h2 class="cm-title">🎉 Sesja ugotowana!</h2>
          <p class="cm-text">${pg.s.pakowanie.length} porcji gotowych na ${pg.s.dni.length} dni.</p>
          ${frozen ? `<button class="btn" data-freeze>❄️ Zapisz ${frozen} porcji do rejestru zamrażarki</button>` : ''}
          <p class="cm-hint">Ostatnie: umyj blaty, wynieś śmieci, sprawdź, czy wszystko trafiło do lodówki.</p>`;
      }
      case 'finish-dish':
        return `<h2 class="cm-title">🎉 Gotowe: ${h(pg.title)}</h2><p class="cm-text">Smacznego!</p>`;
      default: {
        const k = pg.k;
        const passive = k.czas && (k.czas - (k.aktywnie || 0) >= 3 || /gotowanie|duszenie|pieczenie|marynowanie/.test(k.etap || ''));
        return `<p class="cm-kicker">${h(k.potrawa || '')}${k.mnoznik && Math.abs(k.mnoznik - 1) > 0.05 ? ` · ×${fmtNum(k.mnoznik, 2)}` : ''}</p>
          <div class="chips">
            ${k.etap ? `<span class="chip strong">${h(k.etap)}</span>` : ''}
            ${SPRZET[k.sprzet] ? `<span class="chip">${SPRZET[k.sprzet]}${k.temp ? ' ' + k.temp + '°C' : ''}</span>` : ''}
            ${k.czas ? `<span class="chip">⏱ ${k.czas} min${k.aktywnie && k.aktywnie < k.czas ? ` (aktywnie ${k.aktywnie})` : ''}</span>` : ''}
            ${k.dziecko ? `<span class="chip kid">👧 ${k.dziecko}+</span>` : ''}
            ${k.kiedy === 'świeżo' ? '<span class="chip warn">w dniu jedzenia</span>' : ''}
          </div>
          ${pg.note ? `<p class="cm-hint">${h(pg.note)}</p>` : ''}
          <p class="cm-text">${h(k.opis)}</p>
          ${ingTable(k.skladniki, k.mnoznik)}
          ${k.mnoznik && Math.abs(k.mnoznik - 1) > 0.15 ? '<p class="cm-hint">Liczby w opisie są dla przepisu ×1 – odmierzaj wg tabeli.</p>' : ''}
          ${pg.wait ? `<p class="cm-hint">Następny krok tego dania za ${fmtNum(pg.wait)} min – nastaw minutnik, a w tym czasie rób kolejne.</p>${timerBtn(pg.wait, `${k.potrawa || ''}: następny krok`)}`
            : (passive ? timerBtn(k.czas, `${k.potrawa || ''}: ${k.etap || 'krok'}`) : '')}`;
      }
    }
  };

  // jeden zepsuty krok nie blokuje całej sesji – pokazujemy komunikat i można iść dalej
  const safeBody = pg => {
    try { return body(pg); } catch (e) {
      recordError(e, 'tryb gotowania: ' + pg.kind);
      return `<p class="cm-text">Nie udało się pokazać tego kroku.</p><p class="cm-hint">${h(e.message || e)} – przejdź dalej albo zgłoś to przez 💬 po wyjściu (szczegóły dołączą się same).</p>`;
    }
  };

  const draw = () => {
    const pg = pages[i];
    const pct = Math.round((i + 1) / pages.length * 100);
    const doneKey = pg.key;
    root.innerHTML = `<div class="cm" data-cm>
      <div class="cm-top">
        <button class="iconbtn" data-exit aria-label="Zakończ tryb gotowania">✕</button>
        <span class="cm-count">${i + 1} / ${pages.length}</span>
        ${doneKey ? `<span class="cm-state">${isDone(doneKey) ? '✓ zrobione' : ''}</span>` : '<span></span>'}
      </div>
      <div class="cm-progress"><span style="width:${pct}%"></span></div>
      <div class="cm-body">${safeBody(pg)}</div>
      <div class="cm-nav">
        <button class="btn ghost" data-prev ${i === 0 ? 'disabled' : ''}>‹ Wstecz</button>
        <button class="btn" data-next>${i === pages.length - 1 ? 'Zakończ' : (doneKey || pg.kind === 'mise' ? 'Zrobione ✓ Dalej ›' : 'Dalej ›')}</button>
      </div>
    </div>`;
    window.scrollTo(0, 0);
  };

  const exit = () => { if (window.__inAppNav > 0) history.back(); else location.hash = exitHash; };
  const go = dir => {
    if (dir > 0 && pages[i].key) { done[pages[i].key] = 1; saveDone(done); }
    if (dir > 0 && pages[i].kind === 'mise') { pages[i].items.forEach(x => { done[x.key] = 1; }); saveDone(done); }
    if (dir > 0 && i === pages.length - 1) { sessionStorage.removeItem(posKey); exit(); return; }
    i = Math.max(0, Math.min(pages.length - 1, i + dir));
    sessionStorage.setItem(posKey, String(i));
    draw();
  };

  // gesty
  let sx = null, sy = 0;
  root.ontouchstart = e => { if (e.target.closest('input, textarea, select, .cm-ing')) { sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
  root.ontouchend = e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    sx = null;
  };

  root.onchange = e => {
    const cb = e.target.closest('[data-done]');
    if (!cb) return;
    if (cb.checked) done[cb.dataset.done] = 1; else delete done[cb.dataset.done];
    saveDone(done);
    cb.closest('label').classList.toggle('done', cb.checked);
  };
  root.oninput = e => {
    if (!e.target.matches('[data-weight]')) return;
    const d = pages[i].d;
    const wgt = num(e.target.value);
    const sumM = d.porcje.reduce((a, p) => a + p.mnoznik, 0) || 1;
    d.porcje.forEach((p, pi) => { const el = root.querySelector(`[data-pg="${pi}"]`); if (el) el.textContent = `${fmtNum(wgt > 0 ? p.mnoznik / sumM * wgt : p.gramy)} g`; });
  };
  root.onclick = async e => {
    if (e.target.closest('[data-exit]')) { exit(); return; }
    if (e.target.closest('[data-next]')) { go(1); return; }
    if (e.target.closest('[data-prev]')) { go(-1); return; }
    const t = e.target.closest('[data-timer]');
    if (t) { timers.start(t.dataset.label, num(t.dataset.timer)); toast(`Minutnik: ${t.dataset.timer} min`, 'ok'); return; }
    const m = e.target.closest('[data-mult]');
    if (m) { location.replace(`#/gotuj?przepis=${encodeURIComponent(q.przepis)}&x=${m.dataset.mult}`); return; }
    if (e.target.closest('[data-labels]')) { openLabels(pages[i].d.porcje); return; }
    const sw = e.target.closest('[data-saveweight]');
    if (sw && sessionRef) {
      const wgt = num(root.querySelector('[data-weight]').value);
      if (!(wgt > 0)) { toast('Wpisz wagę w gramach', 'error'); return; }
      await busy(sw, async () => {
        const r = await call('setActualWeight', { from: sessionRef.dni[0], to: sessionRef.dni[sessionRef.dni.length - 1], idPot: pages[i].d.ID_Pot, waga: wgt });
        toast(`Zapisano – przeliczono ${r.zmieniono} porcji`, 'ok');
      });
      return;
    }
    const fz = e.target.closest('[data-freeze]');
    if (fz) {
      await busy(fz, async () => {
        const r = await call('freezeSession', { from: w, sesja: Number(q.s) || 0 });
        toast(r.length ? `Dodano ${r.length} porcji do zamrażarki` : 'Te porcje już są w rejestrze', 'ok');
      });
    }
  };

  draw();
}
