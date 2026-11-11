// Przepisy: lista (wyszukiwarka, filtry posiłku i cech) + szczegóły: sekcje, etapy, combo, oceny domowników.
import { S, MODE_ICON, KID_FACES, tagsOf, isKid, osobaName } from '../state.js';
import { enqueue, patchCache, call } from '../api.js';
import { ensureBoot } from '../state.js';
import { substitutesFor } from '../substitutes.js';
import { sheet, busy, toast } from '../ui.js';
import { h, norm, num, fmtNum, fmtQty, truthy } from '../util.js';

const FILTER_KEY = 'planer.recipeFilter';
const TAG_FILTERS = ['niski IG', 'dla dzieci', 'wysokobiałkowe', 'smoothie', 'combo', 'lunchbox', 'wege', 'masa'];
const MODE_FILTERS = ['mrożenie', 'lodówka', 'na świeżo', 'hybryda'];
const STATUS_FILTERS = [['szkic', '📝 szkice do sprawdzenia']];

function stars(avg) {
  if (!avg) return '';
  return `<span class="stars" title="średnia ${fmtNum(avg, 1)}">★ ${fmtNum(avg, 1)}</span>`;
}

export async function render(root, q, ctx, name) {
  if (name === 'przepis') return renderDetail(root, q.id, q.back);

  let f = {};
  try { f = JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { /* domyślne */ }
  const chip = (group, val, label) =>
    `<button class="chip ${f[group] === val ? 'on' : ''}" data-f="${group}" data-v="${h(val)}">${h(label)}</button>`;

  root.innerHTML = `
    <input type="search" class="input" placeholder="Szukaj przepisu lub składnika…" data-q value="${h(q.q || '')}" autocomplete="off">
    <div class="chips filter">${chip('typ', '', 'Wszystkie')}${S.meals.map(t => chip('typ', t, t)).join('')}</div>
    <div class="chips filter">${TAG_FILTERS.map(t => chip('tag', t, t)).join('')}</div>
    <div class="chips filter">${MODE_FILTERS.map(m => chip('tryb', m, MODE_ICON[m] + ' ' + m)).join('')}${STATUS_FILTERS.map(([v, l]) => chip('status', v, l)).join('')}</div>
    <div class="toolbar"><a class="btn small" href="#/edytor">+ Nowy przepis</a><button class="btn ghost small" data-import>🔗 Importuj ze strony</button></div>
    <p class="small muted" data-count></p>
    <ul class="recipe-list" data-list></ul>`;

  const input = root.querySelector('[data-q]');
  const draw = () => {
    const needle = norm(input.value);
    const rows = Object.values(S.idx.pot)
      .filter(p => truthy(p.Aktywna))
      .filter(p => !f.typ || (S.idx.typyByPot[p.ID_Pot] || []).includes(f.typ))
      .filter(p => !f.tag || tagsOf(p).includes(f.tag))
      .filter(p => !f.tryb || p.Tryb === f.tryb)
      .filter(p => !f.status || p.Status === f.status)
      .filter(p => !needle || norm(p.Nazwa).includes(needle) ||
        (S.idx.rec[p.ID_Pot] || []).some(r => norm((S.idx.skl[r.ID_Skl] || {}).Nazwa).includes(needle)))
      .sort((a, b) => (a.Kategoria === 'Baza') - (b.Kategoria === 'Baza') || a.Nazwa.localeCompare(b.Nazwa, 'pl'));
    root.querySelector('[data-count]').textContent = `${rows.length} przepisów`;
    root.querySelector('[data-list]').innerHTML = rows.map(p => {
      const s = S.idx.sum[p.ID_Pot] || {};
      const o = S.idx.oceny[p.ID_Pot];
      return `<li><a class="card recipe" href="#/przepis?id=${encodeURIComponent(p.ID_Pot)}">
        <span class="row-between"><strong>${MODE_ICON[p.Tryb] || ''} ${h(p.Nazwa)}</strong>${stars(o && o.srednia)}</span>
        <span class="small muted">${p.Kategoria === 'Baza' ? 'Baza (combo) · ' : ''}${(S.idx.typyByPot[p.ID_Pot] || []).map(h).join(' · ')}</span>
        <span class="small">${fmtNum(num(s.kcal_100g))} kcal/100 g${tagsOf(p).length ? ' · ' + tagsOf(p).slice(0, 3).map(h).join(', ') : ''}</span>
      </a></li>`;
    }).join('') || '<li class="empty">Nic nie znaleziono</li>';
  };

  input.addEventListener('input', draw);
  root.onclick = ev => {
    if (ev.target.closest('[data-import]')) { importDialog(ctx); return; }
    const b = ev.target.closest('[data-f]');
    if (!b) return;
    const { f: group, v } = b.dataset;
    f[group] = f[group] === v ? '' : v;
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
    root.querySelectorAll(`[data-f="${group}"]`).forEach(x => x.classList.toggle('on', x.dataset.v === f[group]));
    draw();
  };
  draw();
}

const SPRZET = { piekarnik: '🔥 piekarnik', garnek: '🍲 garnek', patelnia: '🍳 patelnia', blender: '🌀 blender' };

function renderDetail(root, id, back) {
  const p = S.idx.pot[id];
  if (!p) {
    root.innerHTML = '<div class="empty"><p>Nie znaleziono przepisu.</p><a class="btn" href="#/przepisy">Wszystkie przepisy</a></div>';
    return;
  }
  document.getElementById('title').textContent = p.Nazwa;
  const s = S.idx.sum[id] || {};
  const porcje = num(p.Porcje_bazowe) || 1;
  const rec = S.idx.rec[id] || [];
  const kroki = S.idx.kroki[id] || [];
  const sections = [...new Set(rec.map(r => r.Sekcja || 'Główne'))];
  const produkty = S.idx.produkty[id] || [];
  const uzywa = rec.map(r => S.idx.skl[r.ID_Skl]).filter(x => x && x.Zrodlo_Pot);

  root.innerHTML = `
    <div class="row-between">
      ${back && window.__inAppNav > 0 ? '<button class="linkbtn" data-back>‹ Wróć</button>' : '<a href="#/przepisy" class="small">‹ Wszystkie przepisy</a>'}
      <span class="row-gap">
        ${kroki.length ? `<a class="btn small" href="#/gotuj?przepis=${encodeURIComponent(id)}">▶️ Gotuj</a>` : ''}
        <a class="btn ghost small" href="#/edytor?id=${encodeURIComponent(id)}">✏️ Edytuj</a>
      </span>
    </div>
    ${p.Status === 'szkic' ? '<div class="warnbox"><p>📝 Szkic – sprawdź składniki i etapy w edytorze i zatwierdź. Szkice nie trafiają do planowania.</p></div>' : ''}
    <article class="card">
      <h2>${h(p.Nazwa)}</h2>
      <div class="chips">
        ${p.Tryb ? `<span class="chip strong">${MODE_ICON[p.Tryb] || ''} ${h(p.Tryb)}</span>` : ''}
        ${(S.idx.typyByPot[id] || []).map(t => `<span class="chip">${h(t)}</span>`).join('')}
        ${tagsOf(p).map(t => `<span class="chip tag">${h(t)}</span>`).join('')}
        ${num(p.Czas_min) ? `<span class="chip">⏱ ${fmtNum(num(p.Czas_min))} min</span>` : ''}
      </div>
      ${p.Opis ? `<p>${h(p.Opis)}</p>` : ''}
      <div class="stats">
        <div><b>${fmtNum(num(s.kcal))}</b><span>kcal cały przepis</span></div>
        <div><b>${fmtNum(num(s.kcal) / porcje)}</b><span>kcal / porcję (${fmtNum(porcje)})</span></div>
        <div><b>${fmtNum(num(s.kcal_100g))}</b><span>kcal / 100 g</span></div>
        <div><b>${num(s.kcal) ? fmtNum(num(s.B) * 4 / num(s.kcal) * 100) : 0}%</b><span>kcal z białka</span></div>
      </div>
      <p class="small muted">Całość: B ${fmtNum(num(s.B))} g · T ${fmtNum(num(s.T))} g · W ${fmtNum(num(s.W))} g · ${fmtQty(num(s.Waga_po_obrobce), 'g')} po obróbce</p>
      ${p.Tryb ? `<p class="small">🧊 lodówka: ${num(p.Lodowka_dni) || '–'} dni · ❄️ zamrażarka: ${num(p.Zamrazarka_tyg) ? num(p.Zamrazarka_tyg) + ' tyg.' : 'nie mrozić'}</p>` : ''}
      ${p.Pakuj_osobno ? `<p class="small">📦 Pakuj osobno: <b>${h(p.Pakuj_osobno)}</b></p>` : ''}
      ${p.Dodaj_po ? `<p class="small">✨ Dodaj po odgrzaniu: <b>${h(p.Dodaj_po)}</b></p>` : ''}
    </article>

    <article class="card" data-rating>${ratingHtml(id)}</article>

    ${produkty.length || uzywa.length ? `<article class="card combo">
      <h3>🔗 Combo</h3>
      ${produkty.length ? `<p class="small">Ten przepis daje: ${produkty.map(x => `<b>${h(x.Nazwa)}</b> (${fmtQty(x.Wydajnosc_g, 'g')})`).join(', ')}. Sesja doda go automatycznie, gdy inne dania tego potrzebują.</p>
        <p class="small">Wykorzystują to: ${comboUsers(produkty).map(u => `<a href="#/przepis?id=${encodeURIComponent(u.ID_Pot)}">${h(u.Nazwa)}</a>`).join(', ') || '–'}</p>` : ''}
      ${uzywa.length ? `<p class="small">Używa produktów z: ${[...new Set(uzywa.map(x => x.Zrodlo_Pot))].map(z => `<a href="#/przepis?id=${encodeURIComponent(z)}">${h((S.idx.pot[z] || {}).Nazwa || z)}</a>`).join(', ')}</p>` : ''}
    </article>` : ''}

    <article class="card">
      <h3>Składniki</h3>
      ${sections.map(sec => `
        ${sections.length > 1 ? `<h4 class="sec">${h(sec)}</h4>` : ''}
        <table class="table">${rec.filter(r => (r.Sekcja || 'Główne') === sec).map(r => {
          const sk = S.idx.skl[r.ID_Skl] || {};
          return `<tr class="tap" data-sub="${h(r.ID_Skl)}"><td>${h(sk.Nazwa || r.ID_Skl)}${sk.Zrodlo_Pot ? ' 🔗' : ''}${r.Przygotowanie ? `<br><span class="small muted">${h(r.Przygotowanie)}</span>` : ''}</td><td class="num">${h(fmtQty(r.Ilosc, r.Jednostka))} <span class="muted">⇄</span></td></tr>`;
        }).join('')}</table>`).join('') || '<p class="muted">Brak receptury</p>'}
    </article>

    ${kroki.length ? `<article class="card">
      <h3>Etapy</h3>
      <ol class="steps">${kroki.map(k => `<li>
        <div class="step-meta">
          <span class="chip strong">${h(k.Etap || k.Sekcja)}</span>
          ${SPRZET[k.Sprzet] ? `<span class="chip">${SPRZET[k.Sprzet]}${num(k.Temp_C) ? ' ' + num(k.Temp_C) + '°C' : ''}</span>` : ''}
          ${num(k.Czas_min) ? `<span class="chip">⏱ ${num(k.Czas_min)} min${num(k.Aktywny_min) && num(k.Aktywny_min) < num(k.Czas_min) ? ' (aktywnie ' + num(k.Aktywny_min) + ')' : ''}</span>` : ''}
          <span class="chip ${k.Kiedy === 'świeżo' ? 'warn' : ''}">${k.Kiedy === 'świeżo' ? 'w dniu jedzenia' : 'w sesji'}</span>
          ${num(k.Dziecko) ? `<span class="chip kid">👧 ${num(k.Dziecko)}+</span>` : ''}
        </div>
        <p>${h(k.Opis)}</p>${k.Skladniki ? `<p class="small muted">${String(k.Skladniki).split('|').map(n => h(n) + ' ' + h(ingQty(rec, n))).join(' · ')}</p>` : ''}</li>`).join('')}</ol>
    </article>` : ''}
    ${p.Instrukcja ? `<article class="card"><h3>Przygotowanie (źródło)</h3><p class="instr">${h(p.Instrukcja)}</p></article>` : ''}
    ${p.Link ? `<p><a class="btn ghost" href="${h(p.Link)}" target="_blank" rel="noopener">Przepis źródłowy ↗</a></p>` : ''}`;

  root.onclick = ev => {
    if (ev.target.closest('[data-back]')) { history.back(); return; }
    const sub = ev.target.closest('[data-sub]');
    if (sub) { openSubstitutes(root, id, sub.dataset.sub, back); return; }
    const b = ev.target.closest('[data-rate]');
    if (!b) return;
    const [who, val] = b.dataset.rate.split(':');
    const o = S.idx.oceny[id] ||= { srednia: 0, liczba: 0, osoby: {} };
    o.osoby[who] = Number(val);
    const v = Object.values(o.osoby);
    o.liczba = v.length;
    o.srednia = v.reduce((a, x) => a + x, 0) / v.length;
    S.boot.oceny = S.idx.oceny;
    root.querySelector('[data-rating]').innerHTML = ratingHtml(id);
    patchCache('bootstrap', b => ({ ...b, oceny: S.idx.oceny }));
    enqueue('rate', { idPot: id, idOsoby: who, ocena: Number(val) });
  };
}

function ingQty(rec, name) {
  const rows = rec.filter(r => (S.idx.skl[r.ID_Skl] || {}).Nazwa === name);
  if (!rows.length) return '';
  return fmtQty(rows.reduce((a, r) => a + num(r.Ilosc), 0), rows[0].Jednostka);
}

/** Zamienniki składnika + zamiana w przepisie (zmienia przepis w arkuszu, kcal przeliczane). */
function openSubstitutes(root, idPot, idSkl, back) {
  const sk = S.idx.skl[idSkl] || {};
  const list = substitutesFor(idSkl);
  const s = sheet('Zamiennik: ' + (sk.Nazwa || ''), `
    <p class="small muted">${h(sk.Nazwa)}: ${fmtNum(num(sk.kcal_100g))} kcal · B ${fmtNum(num(sk.B_100g), 1)} g /100 g · IG ${h(sk.IG_klasa || '?')}</p>
    ${list.length ? `<ul class="picklist">${list.map(x => `<li><button data-to="${h(x.ID_Skl)}">
      <span>${h(x.Nazwa)}</span><small>${h(x.powod)} · ${fmtNum(num(x.kcal_100g))} kcal · B ${fmtNum(num(x.B_100g), 1)} g /100 g</small></button></li>`).join('')}</ul>`
      : '<p class="muted">Brak sensownych zamienników w bazie.</p>'}
    <p class="small muted">Zamiana zmienia przepis w bibliotece (ta sama ilość w gramach). Kalorie przeliczą się same.</p>`);
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-to]');
    if (!b) return;
    await busy(b, async () => {
      await call('replaceIngredient', { idPot, idSkl, nowySkl: b.dataset.to });
      await ensureBoot(true);
      s.close();
      toast('Zamieniono składnik', 'ok');
      renderDetail(root, idPot, back);
    });
  });
}

/** Import przepisu ze strony albo z wklejonego tekstu → szkic w edytorze. */
function importDialog(ctx) {
  const s = sheet('Import przepisu', `
    <div class="tabs" data-imptabs>
      <button type="button" class="tab on" data-mode="url">🔗 Link do strony</button>
      <button type="button" class="tab" data-mode="text">📋 Wklej tekst</button>
    </div>
    <form class="form" data-imp="url">
      <label>Adres przepisu<input class="input" name="url" type="url" required placeholder="https://www.kwestiasmaku.com/przepis/…"></label>
      <p class="small muted">Pobiorę składniki (z sekcjami, np. sos), ilości przeliczę na gramy, dopasuję do Twojej bazy i podzielę kroki na etapy. Przepis trafi jako <b>szkic</b> – sprawdzisz go i zatwierdzisz w edytorze.</p>
      <button class="btn">Pobierz</button>
    </form>
    <form class="form" data-imp="text" hidden>
      <label>Tekst przepisu<textarea class="input" name="text" rows="10" required placeholder="Sałatka grecka&#10;&#10;200 g fety&#10;2 ogórki&#10;&#10;Sos:&#10;180 g jogurtu greckiego&#10;&#10;Przygotowanie&#10;Ogórki pokrój w kostkę…"></textarea></label>
      <p class="small muted">Gdy strona się nie wczytuje (albo przepis jest z książki, Instagrama): pierwsza linia = nazwa, potem składniki (linia „Sos:” zaczyna sekcję), potem „Przygotowanie” i kroki.</p>
      <button class="btn">Przetwórz</button>
    </form>`);
  s.el.querySelector('[data-imptabs]').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    s.el.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
    s.el.querySelectorAll('[data-imp]').forEach(f => { f.hidden = f.dataset.imp !== b.dataset.mode; });
  });
  s.el.querySelectorAll('[data-imp]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('button');
    await busy(btn, async () => {
      const params = f.dataset.imp === 'url' ? { url: f.elements.url.value.trim() } : { text: f.elements.text.value };
      const draft = await call('importRecipe', params);
      if (!draft.skladniki.length) toast('Nie znalazłem listy składników – wklej je w edytorze (📋 Wklej listę)', 'error', 6000);
      sessionStorage.setItem('planer.draft', JSON.stringify(draft));
      s.close();
      ctx.go('#/edytor?draft=1');
    });
  }));
}

function comboUsers(produkty) {
  const ids = new Set(produkty.map(x => x.ID_Skl));
  return Object.values(S.idx.pot).filter(p => (S.idx.rec[p.ID_Pot] || []).some(r => ids.has(r.ID_Skl)));
}

function ratingHtml(id) {
  const o = S.idx.oceny[id] || { osoby: {} };
  return `<div class="row-between"><h3>Oceny domowników</h3>${stars(o.srednia)}</div>
    ${S.idx.aktywne.map(who => {
      const cur = o.osoby[who] || 0;
      const kid = isKid(who);
      return `<div class="rate-row"><span>${h(osobaName(who))}</span><span class="rate">${[1, 2, 3, 4, 5].map(n =>
        `<button class="${kid ? 'face' : 'star'} ${n <= cur && !kid ? 'on' : ''} ${kid && n === cur ? 'on' : ''}" data-rate="${h(who)}:${n}" aria-label="${n}">${kid ? KID_FACES[n - 1] : '★'}</button>`).join('')}</span></div>`;
    }).join('')}
    <p class="small muted">Oceny wpływają na „Uzupełnij puste”: ulubione częściej, ocenione na 1–2 przez daną osobę – nie trafią do jej posiłków.</p>`;
}
