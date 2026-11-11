// Gotowanie: sesje (zakładki wg harmonogramu z Ustawień + sesje dodatkowe, Na świeżo) prowadzone jak w kuchni zawodowej:
// mise en place ze wszystkich dań → marynaty → dania (kroki z ilościami) → bazy → składanie → chłodzenie →
// porcjowanie per danie (waga rzeczywista → podział, etykiety, rejestr zamrażarki).
import { live, call } from '../api.js';
import { MODE_ICON } from '../state.js';
import { busy, toast } from '../ui.js';
import { openLabels } from '../labels.js';
import { editSession, coverText, shortDay, DAY_SHORT, dow } from '../sessions.js';
import { h, today, addDays, mondayOf, fmtDay, fmtRange, fmtNum, fmtQty, isKey } from '../util.js';

const DONE_KEY = 'planer.sessionDone';
const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const SPRZET = { piekarnik: '🔥', garnek: '🍲', patelnia: '🍳', blender: '🌀', mikrofala: '📟' };

const LISTS = ['potrawy', 'dania', 'mise', 'przygotowanie', 'marynaty', 'bazy', 'piekarnik', 'skladanie', 'chlodzenie', 'porcjowanie', 'pakowanie', 'dni', 'ostrzezenia'];
/** Brakujące listy w planie sesji (np. odpowiedź starszego API) → puste, zamiast błędu „reading 'length'”. */
export function normSessions(d) {
  const arr = x => (Array.isArray(x) ? x : []);
  const out = { ...(d || {}), sesje: arr(d && d.sesje), swieze: arr(d && d.swieze) };
  out.sesje = out.sesje.map(s => {
    const n = { ...(s || {}) };
    LISTS.forEach(k => { n[k] = arr(n[k]); });
    n.dania = n.dania.map(x => ({ ...x, kroki: arr(x && x.kroki), po: arr(x && x.po) }));
    n.porcjowanie = n.porcjowanie.map(x => ({ ...x, porcje: arr(x && x.porcje) }));
    n.mise = n.mise.map(x => ({ ...x, dla: arr(x && x.dla) }));
    n.bazy = n.bazy.map(x => ({ ...x, dla: arr(x && x.dla) }));
    n.czas_min = Number(n.czas_min) || 0;
    return n;
  });
  out.swieze = out.swieze.map(day => ({ ...day, potrawy: arr(day && day.potrawy).map(p => ({ ...p, kroki: arr(p && p.kroki), porcje: arr(p && p.porcje) })) }));
  return out;
}

export async function render(root, q, ctx) {
  const from = mondayOf(isKey(q.w) ? q.w : today());
  const to = addDays(from, 6);
  let tab = q.s !== undefined ? Number(q.s) : null;
  // Sesję wybieramy po ID (a nie po numerze zakładki): po odświeżeniu danych kolejność zakładek może się zmienić.
  let want = q.sid || null;  // sesja z linku (Tydzień, zapis sesji) – wybierana, gdy pojawi się w świeżych danych
  let selId = null;          // aktualnie otwarta sesja
  let data = null;
  let done = {};
  try { done = JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { /* puste */ }

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="#/gotowanie?w=${addDays(from, -7)}" aria-label="Poprzedni tydzień">‹</a>
      <div class="datenav-title"><strong>${h(fmtRange(from, to))}</strong><span class="small muted">sesje gotowania</span></div>
      <a class="iconbtn" href="#/gotowanie?w=${addDays(from, 7)}" aria-label="Następny tydzień">›</a>
    </div>
    <div class="tabs" data-tabs></div>
    <div class="toolbar"><button class="btn ghost small" data-newsess>➕ Gotuj w innym terminie</button><a class="small" href="#/ustawienia?k=gotowanie">⚙️ Dni gotowania</a></div>
    <div data-gaps></div>
    <p class="small muted fresh-note" data-fresh hidden>🔄 Pokazuję zapisany plan – sprawdzam zmiany z Tygodnia…</p>
    <section data-list><div class="loading">Układam plan sesji…</div></section>`;

  const chk = (id, inner) => `<label class="${done[id] ? 'done' : ''}"><input type="checkbox" data-step="${h(id)}" ${done[id] ? 'checked' : ''}><span>${inner}</span></label>`;
  const ingTable = (list, mult) => !list || !list.length ? '' : `<table class="table ing">
      <tr><th></th><th class="num">przepis</th><th class="num">× ${fmtNum(mult, 2)}</th></tr>
      ${list.map(i => `<tr><td>${h(i.nazwa)}</td><td class="num muted">${i.przepis === null ? '–' : h(fmtQty(i.przepis, i.jedn))}</td><td class="num"><b>${i.plan === null ? '–' : h(fmtQty(i.plan, i.jedn))}</b></td></tr>`).join('')}
    </table>`;
  const meta = k => [
    SPRZET[k.sprzet] ? `<span class="chip">${SPRZET[k.sprzet]} ${h(k.sprzet)}${k.temp ? ' ' + k.temp + '°C' : ''}</span>` : '',
    k.czas ? `<span class="chip">⏱ ${k.czas} min${k.aktywnie && k.aktywnie < k.czas ? ' (aktywnie ' + k.aktywnie + ')' : ''}</span>` : '',
    k.dziecko ? `<span class="chip kid">👧 ${k.dziecko}+</span>` : ''
  ].join('');
  const stepHtml = (s, k, key, withName) => `<li>${chk(`${s.data}|${key}`, `${withName ? `<b>${h(k.potrawa)}</b> <span class="muted small">×${fmtNum(k.mnoznik, 2)}</span><br>` : ''}
      <span class="step-meta">${meta(k)}</span><br>${h(k.opis)}`)}${ingTable(k.skladniki, k.mnoznik)}</li>`;
  // „pt obiad, kolacja · nd kolacja” – kiedy jest jedzone danie sesji
  const dayAbbr = k => DAY_SHORT[dow(k) - 1];
  const whenText = kiedy => {
    const byDay = [];
    (kiedy || []).forEach(x => {
      const d = byDay.find(y => y.data === x.data) || (byDay.push({ data: x.data, typy: [] }), byDay[byDay.length - 1]);
      if (!d.typy.includes(x.typ)) d.typy.push(x.typ);
    });
    const low = t => t.replace(/^(\p{Lu})(?=\p{Ll})/u, c => c.toLowerCase()); // „Obiad” → „obiad”, „II śniadanie” bez zmian
    return byDay.map(d => `${dayAbbr(d.data)} ${d.typy.map(low).join(', ')}`).join(' · ');
  };
  const baseText = p => (p.dla || []).map(d => `${d.Nazwa}${d.dni.length ? ' (' + d.dni.map(dayAbbr).join(', ') + ')' : ''}`).join(', ');
  const dishList = s => `<ul class="dish-list">${s.potrawy.map(p => `<li class="${p.baza ? 'base' : ''}">
      <a href="#/przepis?id=${encodeURIComponent(p.ID_Pot)}&back=1">${MODE_ICON[p.tryb] || ''} ${h(p.Nazwa)}</a> <span class="muted small">×${fmtNum(p.mnoznik, 2)}</span>
      <br><span class="small">${[
        p.kiedy && p.kiedy.length ? `<span class="muted">🍽️ ${h(whenText(p.kiedy))}</span>` : '',
        !p.baza ? '' : p.kiedy && p.kiedy.length ? `🧱 też baza do: ${h(baseText(p)) || 'dań tej sesji'}`
          : `🧱 baza – nie jest posiłkiem z planu, gotujesz ją do: ${h(baseText(p)) || 'dań tej sesji'}`
      ].filter(Boolean).join('<br>') || '<span class="muted">🍽️ na dni sesji</span>'}</span></li>`).join('')}</ul>`;
  const recipeLink = (id, name) => `<a href="#/przepis?id=${encodeURIComponent(id)}&back=1">${h(name)}</a>`;

  const drawTabs = () => {
    const t = root.querySelector('[data-tabs]');
    const labels = data.sesje.map((s, i) => `<button class="tab ${tab === i ? 'on' : ''}" data-tab="${i}">🍳 ${h(s.nazwa)}${s.staly === false ? ' ✎' : ''}<small>${h(shortDay(s.data))} → ${h(coverText(s.dni))} · ${s.potrawy.length} ${plural(s.potrawy.length, 'danie', 'dania', 'dań')}</small></button>`);
    labels.push(`<button class="tab ${tab === 9 ? 'on' : ''}" data-tab="9">🥚 Na świeżo<small>${data.swieze.length} dni</small></button>`);
    t.innerHTML = labels.join('');
  };

  const drawSession = s => {
    if (!s) return `<div class="empty"><p>W tym tygodniu nie ma sesji gotowania.</p><p class="small muted">Dni gotowania ustawisz w Ustawieniach, a jednorazową sesję dodasz przyciskiem „Gotuj w innym terminie”.</p></div>`;
    if (!s.potrawy.length) return `<div class="empty"><p>W sesji ${h(s.nazwa)} (${h(shortDay(s.data))} → ${h(coverText(s.dni))}) nie ma nic do gotowania.</p><p><a class="btn" href="#/tydzien?w=${from}">Zaplanuj tydzień</a> <button class="btn ghost" data-editsess>📅 Zmień termin / dni</button></p></div>`;
    const frozen = s.pakowanie.filter(p => p.akcja === 'zamrażarka').length;
    let n = 0;
    const phase = (title, body, open) => `<details class="phase" ${open ? 'open' : ''}><summary>${++n}. ${title}</summary>${body}</details>`;
    return `
      <article class="card session">
        <div class="row-between"><h3>${h(s.nazwa)} · ${h(fmtDay(s.data, true))}</h3><span class="chip strong">≈ ${fmtNum(s.czas_min / 60, 1)} h</span></div>
        <p class="small muted">Gotujesz na: ${s.dni.map(k => h(fmtDay(k))).join(', ')}${s.staly === false ? ' · <b>sesja dodatkowa</b>' : ''}</p>
        ${dishList(s)}
        ${s.ostrzezenia.length ? `<div class="warnbox">${s.ostrzezenia.map(w => `<p>⚠️ ${h(w)}</p>`).join('')}</div>` : ''}
        <a class="btn block cm-start" href="#/gotuj?w=${from}&s=${tab}&sid=${encodeURIComponent(s.id || '')}">▶️ Tryb gotowania – krok po kroku</a>
        <div class="toolbar">
          <button class="btn ghost small" data-export="calendar">📅 Do Kalendarza</button>
          <button class="btn ghost small" data-export="todoist">✅ Do Todoist</button>
          <button class="btn ghost small" data-editsess>📅 Zmień termin / dni</button>
          <a class="btn ghost small" href="#/zakupy?t=lista&od=${s.dni[0]}&do=${s.dni[s.dni.length - 1]}">🛒 Zakupy na tę sesję</a>
        </div>
      </article>

      ${s.mise.length || s.przygotowanie.length ? phase(`🔪 Przygotowanie składników <span class="muted small">(${s.mise.length})</span>`, `
        <p class="small muted">Wszystko do krojenia ze wszystkich dań naraz – warzywa najpierw, mięso na końcu na osobnej desce. Odkładaj do misek podpisanych nazwą dania.</p>
        <ul class="checklist">${s.mise.map((x, i) => `<li>${chk(`${s.data}|mise|${i}`, `${x.mieso ? '🥩 ' : ''}<b>${h(x.nazwa)}</b> – ${h(x.przygotowanie)}: <b>${h(fmtQty(x.ilosc, x.jedn))}</b>
          <br><span class="small muted">${x.dla.map(d => `${h(d.potrawa)} ${h(fmtQty(d.ilosc, x.jedn))}`).join(' · ')}</span>`)}</li>`).join('')}
          ${s.przygotowanie.map((k, i) => stepHtml(s, k, 'prep|' + i, true)).join('')}</ul>`, true) : ''}

      ${s.marynaty.length ? phase(`🧂 Marynaty <span class="muted small">(${s.marynaty.length})</span>`, `
        <p class="small muted">Zamarynuj od razu – mięso „pracuje”, gdy gotujesz resztę.</p>
        <ul class="checklist">${s.marynaty.map((k, i) => stepHtml(s, k, 'mar|' + i, true)).join('')}</ul>`, true) : ''}

      ${s.dania.length ? phase(`🍲 Gotowanie dań <span class="muted small">(${s.dania.length})</span>`, `
        ${s.piekarnik.length ? `<h4 class="sec">Plan piekarnika (dual cook)</h4>${s.piekarnik.map(o => `<div class="oven">
            <div><span class="small muted">Góra</span><br><b>${h(o.gora.potrawa)}</b><br><span class="small">${o.gora.temp}°C · ${o.gora.czas} min</span></div>
            <div><span class="small muted">Dół</span><br>${o.dol ? `<b>${h(o.dol.potrawa)}</b><br><span class="small">${o.dol.temp}°C · ${o.dol.czas} min</span>` : '<span class="muted">wolne</span>'}</div>
            ${o.razem ? '<p class="small span2">Ta sama temperatura – można też razem w całym piekarniku, bez przegrody.</p>' : ''}</div>`).join('')}` : ''}
        ${s.dania.map((d, di) => `<div class="dish-block">
          <div class="row-between"><h4>${recipeLink(d.ID_Pot, d.Nazwa)} <span class="muted small">×${fmtNum(d.mnoznik, 2)}</span></h4><span class="chip">⏱ ${d.czas} min</span></div>
          ${(() => { const p = s.potrawy.find(x => x.ID_Pot === d.ID_Pot); if (!p) return ''; return p.baza
            ? `<p class="small">🧱 Baza do: ${h(baseText(p)) || 'dań tej sesji'}</p>` : (p.kiedy && p.kiedy.length ? `<p class="small muted">🍽️ ${h(whenText(p.kiedy))}</p>` : ''); })()}
          ${d.start ? `<p class="small ${d.po.length ? 'warn-text' : 'muted'}">${d.po.length ? '⏳ ' : '▶️ '}${h(d.start)}</p>` : ''}
          ${Math.abs(d.mnoznik - 1) > 0.15 ? `<p class="small muted">Liczby w opisach są dla przepisu ×1 – odmierzaj wg kolumny „× ${fmtNum(d.mnoznik, 2)}” (także wodę i przyprawy).</p>` : ''}
          <ol class="checklist steps-list">${d.kroki.map((k, ki) => stepHtml(s, k, `dish|${di}|${ki}`, false)).join('')}</ol>
        </div>`).join('')}`, true) : ''}

      ${s.bazy.length ? phase(`🍚 Wspólne bazy: kasze, ryż, makaron <span class="muted small">(${s.bazy.length})</span>`, `
        <ul class="checklist">${s.bazy.map((b, i) => `<li>${chk(`${s.data}|baza|${i}`, `<b>${h(b.Nazwa)} – ${h(fmtQty(b.ilosc, 'g'))}</b> (sucha)<br>
          <span class="small muted">${b.dla.map(x => `${h(x.potrawa)} ${h(fmtQty(x.ilosc, 'g'))}`).join(' · ')}</span><br><span class="small">${h(b.uwaga)}</span>`)}</li>`).join('')}</ul>`) : ''}

      ${s.skladanie.length ? phase(`🥗 Składanie: sałatki, słoiki, paczki <span class="muted small">(${s.skladanie.length})</span>`, `
        <p class="small muted">Gdy pieczone i gotowane składniki są już letnie lub zimne.</p>
        <ul class="checklist">${s.skladanie.map((k, i) => stepHtml(s, k, 'skl|' + i, true)).join('')}</ul>`) : ''}

      ${phase('❄️ Chłodzenie (≤ 2 h)', `<ul class="checklist">
        <li>${chk(`${s.data}|chl|0`, 'Gorące dania rozłóż do płytkich pojemników, bez pokrywek. Do lodówki najpóźniej po 2 h od ugotowania.')}</li>
        ${s.chlodzenie.map((k, i) => stepHtml(s, k, 'chl|' + (i + 1), true)).join('')}</ul>`)}

      ${phase(`📦 Porcjowanie i pakowanie <span class="muted small">(${s.pakowanie.length} porcji)</span>`, `
        <p class="small muted">Zważ każde gotowe danie (bez garnka) i wpisz wagę – porcje przeliczą się od razu. Kalorie zostają jak w planie.</p>
        ${s.porcjowanie.map((d, di) => portionCard(s, d, di)).join('')}
        ${frozen ? `<div class="toolbar"><button class="btn" data-freeze>❄️ Zapisz ${frozen} porcji do rejestru zamrażarki</button></div>` : ''}`, true)}`;
  };

  const portionCard = (s, d, di) => `<div class="dish-block" data-portion="${di}">
      <div class="row-between"><h4>${recipeLink(d.ID_Pot, d.Nazwa)}</h4><span class="chip">${d.porcje.length} porcji</span></div>
      <p class="small muted">Plan: ≈ ${h(fmtQty(d.waga_plan, 'g'))} gotowego dania · ${fmtNum(d.kcal)} kcal${d.osobno ? ' · osobno: ' + h(d.osobno) : ''}${d.dodajPo && !d.paczka ? ' · po odgrzaniu: ' + h(d.dodajPo) : ''}</p>
      ${d.paczka ? '' : `<form class="inline-form" data-weigh="${di}">
        <input class="input" name="waga" type="number" inputmode="numeric" min="1" placeholder="Waga rzeczywista (g)">
        <button class="btn ghost">Zapisz</button></form>`}
      <table class="table small portions">${d.porcje.map((p, pi) => `<tr>
        <td>${h(fmtDay(p.data))}<br><span class="muted">${h(p.typ)}</span></td>
        <td><b>${h(p.osoba)}</b>${/^lunchbox/.test(p.miejsce || '') ? ' 📦' : ''}${p.dodajPo && d.paczka ? `<br><span class="small">${h(p.dodajPo)}</span>` : ''}</td>
        <td class="num"><b data-g="${di}|${pi}">${fmtNum(p.gramy)} g</b><br><span class="muted">${fmtNum(p.kcal)} kcal</span></td>
        <td class="num">${p.akcja === 'zamrażarka' ? `❄️<br><span class="muted">${p.rozmrozic ? 'rozmroź ' + h(fmtDay(p.rozmrozic)) : 'prosto do blendera'}</span>` : '🧊'}</td></tr>`).join('')}</table>
      <div class="toolbar"><button class="btn ghost small" data-labels="${di}">🏷️ Etykiety (${d.porcje.length})</button></div>
    </div>`;

  const drawFresh = () => !data.swieze.length ? '<div class="empty"><p>Brak dań na świeżo w tym tygodniu.</p></div>' :
    data.swieze.map(day => `<article class="card">
      <h3>${h(fmtDay(day.data, true))}</h3>
      ${day.potrawy.map(p => `<div class="dish-block">
        <div class="row-between"><h4>${recipeLink(p.ID_Pot, p.Nazwa)} <span class="muted small">×${fmtNum(p.mnoznik, 2)}</span></h4>${p.hybryda ? '<span class="chip">🧩 finisz</span>' : ''}</div>
        <p class="small muted">${p.porcje.map(x => h(x.osoba) + ' ' + fmtNum(x.gramy) + ' g').join(' · ')}</p>
        ${p.szkic ? '<p class="small warn-text">Przepis bez etapów – uzupełnij w edytorze.</p>' : `<a class="btn ghost small" href="#/gotuj?w=${from}&s=9&d=${day.data}&id=${encodeURIComponent(p.ID_Pot)}">▶️ Gotuj krok po kroku</a>`}
        <ol class="checklist steps-list">${p.kroki.map((k, ki) => stepHtml({ data: day.data }, k, `fresh|${p.ID_Pot}|${ki}`, false)).join('')}</ol>
      </div>`).join('')}
    </article>`).join('');

  const draw = (raw, meta = {}) => {
    if (!ctx.alive()) return;
    const d = normSessions(raw);
    data = d;
    const find = id => (id ? d.sesje.findIndex(s => s.id === id) : -1);
    let i = find(want);
    if (i >= 0) { tab = i; if (!meta.stale) want = null; } // link do sesji honorujemy raz – potem decydują kliknięcia
    else if ((i = find(selId)) >= 0) tab = i;
    if (tab === null) {
      // domyślnie: najbliższa sesja od dziś (dziś też), inaczej ostatnia z zaplanowanym gotowaniem
      const t = today();
      const idx = d.sesje.findIndex(s => s.data >= t && s.potrawy.length);
      tab = idx >= 0 ? idx : Math.max(0, d.sesje.map(s => !!s.potrawy.length).lastIndexOf(true));
    }
    if (tab !== 9 && !d.sesje[tab]) tab = d.sesje.length ? 0 : 9;
    selId = tab === 9 ? null : d.sesje[tab].id;
    const note = root.querySelector('[data-fresh]');
    if (note) note.hidden = !meta.stale;
    drawGaps();
    drawTabs();
    const box = root.querySelector('[data-list]');
    box.innerHTML = tab === 9 ? drawFresh() : drawSession(d.sesje[tab] || d.sesje[0]);
  };

  const session = () => data.sesje[tab] || data.sesje[0];

  // Dni z daniami „do sesji”, których nie gotuje żadna sesja (np. po zmianie dni gotowania w środku tygodnia).
  const gaps = () => (data && Array.isArray(data.bezSesji) ? data.bezSesji : []).filter(k => k >= today());
  // najpóźniejsza nadchodząca sesja, która gotuje nie później niż pierwszy taki dzień – do niej proponujemy je dołączyć
  const gapTarget = g => data.sesje.filter(s => s.data >= today() && s.data <= g[0]).sort((a, b) => b.data.localeCompare(a.data))[0] || null;
  const drawGaps = () => {
    const box = root.querySelector('[data-gaps]');
    if (!box) return;
    const g = gaps();
    if (!g.length) { box.innerHTML = ''; return; }
    const t = gapTarget(g);
    box.innerHTML = `<div class="warnbox">
      <p>⚠️ <b>${g.map(k => h(fmtDay(k))).join(', ')}</b> – ${g.length === 1 ? 'na ten dzień' : 'na te dni'} nie gotuje żadna sesja
        (zmieniły się dni gotowania). Dania są na razie w „🥚 Na świeżo”.</p>
      <p><button class="btn small" data-gapfix>${t ? `📅 Dołącz do sesji ${h(t.nazwa)} ${h(shortDay(t.data))}` : '🔥 Dodaj sesję na te dni'}</button></p>
    </div>`;
  };
  const afterSave = (id, od) => ctx.go(`#/gotowanie?w=${mondayOf(od)}${id ? '&sid=' + encodeURIComponent(id) : ''}`);

  root.onchange = ev => {
    const cb = ev.target.closest('[data-step]');
    if (!cb) return;
    if (cb.checked) done[cb.dataset.step] = 1; else delete done[cb.dataset.step];
    cb.closest('label').classList.toggle('done', cb.checked);
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch { /* brak miejsca */ }
  };

  root.oninput = ev => {
    const f = ev.target.closest('[data-weigh]');
    if (!f || ev.target.name !== 'waga') return;
    const d = session().porcjowanie[Number(f.dataset.weigh)];
    const w = Number(ev.target.value);
    const sumM = d.porcje.reduce((a, p) => a + p.mnoznik, 0) || 1;
    d.porcje.forEach((p, pi) => {
      const el = root.querySelector(`[data-g="${f.dataset.weigh}|${pi}"]`);
      if (el) el.textContent = `${fmtNum(w > 0 ? p.mnoznik / sumM * w : p.gramy)} g`;
    });
  };

  root.onsubmit = async ev => {
    const f = ev.target.closest('[data-weigh]');
    if (!f) return;
    ev.preventDefault();
    const s = session();
    const d = s.porcjowanie[Number(f.dataset.weigh)];
    const waga = Number(f.elements.waga.value);
    if (!(waga > 0)) { toast('Wpisz wagę w gramach', 'error'); return; }
    await busy(f.querySelector('button'), async () => {
      const r = await call('setActualWeight', { from: s.dni[0], to: s.dni[s.dni.length - 1], idPot: d.ID_Pot, waga });
      toast(`Przeliczono ${r.zmieniono} porcji`, 'ok');
      await reload();
    });
  };

  root.onclick = async ev => {
    const es = ev.target.closest('[data-newsess], [data-editsess]');
    if (es) {
      const s = es.matches('[data-editsess]') && data ? session() : null;
      editSession(s, data ? data.sesje : [], afterSave);
      return;
    }
    if (ev.target.closest('[data-gapfix]') && data) {
      const g = gaps();
      if (!g.length) return;
      const first = g[0], last = g[g.length - 1];
      const t = gapTarget(g);
      // sesja docelowa rozszerzona o dni bez sesji albo nowa: gotujesz dziś (lub w pierwszy taki dzień) na te dni
      editSession(t, data.sesje, afterSave, t ? { od: first < t.od ? first : t.od, do: last > t.do ? last : t.do }
        : { data: today() <= first ? today() : first, od: first, do: last });
      return;
    }
    const t = ev.target.closest('[data-tab]');
    if (t) {
      tab = Number(t.dataset.tab);
      want = null;
      selId = tab === 9 ? null : (data.sesje[tab] || {}).id || null;
      history.replaceState(null, '', `#/gotowanie?w=${from}${selId ? '&sid=' + encodeURIComponent(selId) : '&s=' + tab}`);
      draw(data, { stale: !root.querySelector('[data-fresh]')?.hidden });
      window.scrollTo(0, 0);
      return;
    }
    const ex = ev.target.closest('[data-export]');
    if (ex) {
      const kind = ex.dataset.export;
      await busy(ex, async () => {
        const r = await call(kind === 'calendar' ? 'exportCalendar' : 'exportTodoist', { from });
        toast(`${kind === 'calendar' ? 'Kalendarz' : 'Todoist'}: dodano ${r.utworzono} pozycji`, 'ok');
      });
      return;
    }
    const lb = ev.target.closest('[data-labels]');
    if (lb && data) { openLabels(session().porcjowanie[Number(lb.dataset.labels)].porcje); return; }
    const fz = ev.target.closest('[data-freeze]');
    if (fz) {
      await busy(fz, async () => {
        const r = await call('freezeSession', { from, sesja: tab, id: session().id });
        toast(r.length ? `Dodano ${r.length} porcji do rejestru zamrażarki` : 'Te porcje już są w rejestrze', 'ok');
      });
    }
  };

  const reload = () => live(`sessions:${from}`, 'sessions', { from }, draw);
  await reload();
}
