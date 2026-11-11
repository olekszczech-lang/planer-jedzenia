// Zakupy: lista w opakowaniach sklepowych (sztuki, kartony, puszki) z resztkami i pomysłami na nie,
// zapasy (spiżarnia / lodówka / zamrażarka) i rejestr gotowych porcji w zamrażarce.
import { live, call, enqueue, patchCache, writeCache } from '../api.js';
import { S, osobaName, mealsInUse } from '../state.js';
import { busy, toast, sheet } from '../ui.js';
import { h, today, addDays, mondayOf, fmtRange, fmtQty, fmtNum, fmtDay, truthy, isKey, norm, num, key, parseKey, dueText } from '../util.js';
import { shortDay, coverText, daysWord } from '../sessions.js';

const HIDE_KEY = 'planer.hideBought';

// „do: Krupnik z kurkami 240 g, Rosół domowy 300 g +2” – dania z okresu, do których potrzebny jest produkt
const dlaHtml = it => {
  const d = it.dla || [];
  if (!d.length) return '';
  return `<span class="small muted dla">do: ${d.slice(0, 2).map(x => `<a href="#/przepis?id=${encodeURIComponent(x.ID_Pot)}&back=1">${h(x.Nazwa)}</a>${x.ilosc ? ' ' + h(fmtQty(x.ilosc, x.jedn)) : ''}`).join(', ')}${d.length > 2 ? ` <span>+${d.length - 2}</span>` : ''}</span>`;
};
const UNITS = ['szt', 'opak.', 'g', 'kg', 'ml', 'l'];

const pieces = it => {
  if (!it.opakowanie) return '';
  if (it.opakowanie === 'szt' || it.opakowanie === 'ząbek') return `${it.sztuk} ${it.opakowanie === 'szt' ? 'szt' : 'ząbk.'}`;
  return `${it.sztuk} × ${it.opakowanie}`;
};

export async function render(root, q, ctx) {
  const tab = q.t || 'lista';
  root.innerHTML = `
    <div class="tabs">
      <a class="tab ${tab === 'lista' ? 'on' : ''}" href="#/zakupy?t=lista${q.od ? `&od=${h(q.od)}&do=${h(q.do || '')}` : (q.w ? '&w=' + h(q.w) : '')}">🛒 Lista</a>
      <a class="tab ${tab === 'zapasy' ? 'on' : ''}" href="#/zakupy?t=zapasy">🥫 Zapasy</a>
      <a class="tab ${tab === 'zamrazarka' ? 'on' : ''}" href="#/zakupy?t=zamrazarka">❄️ Zamrażarka</a>
    </div>
    <section data-body></section>`;
  const body = root.querySelector('[data-body]');
  if (tab === 'zapasy') return renderStock(body, ctx);
  if (tab === 'zamrazarka') return renderFreezer(body, ctx);
  return renderList(body, q, ctx);
}

const listHash = (od, d2) => `#/zakupy?t=lista&od=${od}&do=${d2}`;
const daysIn = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5) + 1;

async function renderList(root, q, ctx) {
  // okres listy: od–do z adresu (tydzień, sesja gotowania albo dowolny zakres); domyślnie bieżący tydzień
  let from = isKey(q.od) ? q.od : mondayOf(isKey(q.w) ? q.w : today());
  let to = isKey(q.od) && isKey(q.do) && q.do >= q.od ? q.do : addDays(from, 6);
  if (daysIn(from, to) > 31) to = addDays(from, 30);
  const n = daysIn(from, to);
  const isWeek = n === 7 && from === mondayOf(from);
  const idListy = `L${from}_${to}`;
  const cacheKey = 'shop:' + idListy;
  let data = { items: [] };
  let hide = localStorage.getItem(HIDE_KEY) === '1';
  let cal = null;

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="${listHash(addDays(from, -n), addDays(to, -n))}" aria-label="Poprzedni okres">‹</a>
      <div class="datenav-title"><strong>${h(fmtRange(from, to))}</strong><span class="small muted" data-progress>${isWeek ? 'tydzień' : daysWord(n)}</span></div>
      <a class="iconbtn" href="${listHash(addDays(from, n), addDays(to, n))}" aria-label="Następny okres">›</a>
    </div>
    <div class="chips filter" data-periods>
      <a class="chip ${isWeek ? 'on' : ''}" href="${listHash(mondayOf(from), addDays(mondayOf(from), 6))}">📅 Tydzień</a>
      <span class="small muted">sesje…</span>
      <button class="chip" data-range>✎ Inny okres</button>
    </div>
    <div class="toolbar">
      <button class="btn" data-build>Generuj z planu</button>
      <button class="btn ghost" data-additem>+ Dodaj produkt</button>
      <button class="btn ghost" data-todoist>✅ Do Todoist</button>
      <label class="check"><input type="checkbox" data-hide ${hide ? 'checked' : ''}> Ukryj kupione</label>
    </div>
    <section data-list><div class="loading">Ładowanie listy…</div></section>`;

  // skróty: lista na sesję gotowania (dni, na które gotujesz) – sesje z tego i następnego tygodnia
  const periods = c => {
    if (!ctx.alive() || !c) return;
    cal = c;
    const el = root.querySelector('[data-periods]');
    const sess = c.sesje.filter(s => s.do >= addDays(today(), -7));
    el.innerHTML = `<a class="chip ${isWeek ? 'on' : ''}" href="${listHash(mondayOf(from), addDays(mondayOf(from), 6))}">📅 Tydzień</a>` +
      sess.map(s => `<a class="chip ${s.od === from && s.do === to ? 'on' : ''}" href="${listHash(s.od, s.do)}">🍳 ${h(shortDay(s.data))} → ${h(coverText(s.dni))}</a>`).join('') +
      `<button class="chip ${!isWeek && !sess.some(s => s.od === from && s.do === to) ? 'on' : ''}" data-range>✎ Inny okres</button>`;
  };
  const wk = mondayOf(from);
  live(`scal:${wk}:14`, 'sessionCalendar', { from: wk, to: addDays(wk, 13) }, periods).catch(() => {});

  const draw = d => {
    if (!ctx.alive()) return;
    data = d;
    const items = d.items || [];
    const toBuy = items.filter(i => num(i.Ilosc) > 0);
    const bought = toBuy.filter(i => truthy(i.Kupione)).length;
    root.querySelector('[data-progress]').textContent = (isWeek ? 'tydzień' : daysWord(n)) + (items.length ? ` · ${bought} / ${toBuy.length} kupione` : '');
    const box = root.querySelector('[data-list]');
    if (!items.length) {
      box.innerHTML = `<div class="empty"><p>Lista na ten okres jest pusta.</p>
        <p class="muted small">„Generuj z planu” policzy składniki ze wszystkich zaplanowanych posiłków, odejmie zapasy i zaokrągli do opakowań ze sklepu.
        Inne rzeczy (np. chemię, przekąski) dopiszesz przyciskiem „+ Dodaj produkt”.</p></div>`;
      return;
    }
    const fromStock = items.filter(i => num(i.Ilosc) === 0);
    const visible = toBuy.filter(i => !hide || !truthy(i.Kupione));
    const cats = [...new Set(visible.map(i => i.Kategoria))];
    const leftovers = toBuy.filter(i => (i.wykorzystaj || []).length);
    box.innerHTML = cats.map(cat => `
      <article class="card shop-cat">
        <h3>${h(cat)}</h3>
        ${visible.filter(i => i.Kategoria === cat).map(i => `
          <div class="shop-row ${truthy(i.Kupione) ? 'done' : ''}">
            <label class="shop-item">
              <input type="checkbox" data-skl="${h(i.ID_Skl)}" ${truthy(i.Kupione) ? 'checked' : ''}>
              <span class="name">${h(i.Nazwa)}${i.wlasne ? ' <span class="small muted">· dodane</span>' : ''}${i.zapas ? `<br><span class="small muted">w zapasach: ${h(fmtQty(i.zapas, i.Jednostka))}</span>` : ''}${dlaHtml(i)}</span>
              <span class="qty">${i.opakowanie ? h(pieces(i)) : h(fmtQty(i.Ilosc, i.Jednostka))}${i.opakowanie ? `<br><span class="small muted">${h(fmtQty(i.Ilosc, i.Jednostka))}${i.zostanie ? ` · zostanie ${h(fmtQty(i.zostanie, 'g'))}` : ''}</span>` : ''}</span>
            </label>
            ${i.wlasne ? `<button class="iconbtn small" data-del="${h(i.ID_Skl)}" aria-label="Usuń z listy">✕</button>`
              : `<button class="iconbtn small" data-have="${h(i.ID_Skl)}" aria-label="Mam w domu">⋯</button>`}
          </div>`).join('')}
      </article>`).join('') +
      (leftovers.length ? `<article class="card"><h3>♻️ Resztki z opakowań – nie marnuj</h3>
        ${leftovers.map(i => `<p class="small"><b>${h(i.Nazwa)}</b>: zostanie ${h(fmtQty(i.zostanie, 'g'))} → ${i.wykorzystaj.map(w => `<a href="#/przepis?id=${encodeURIComponent(w.ID_Pot)}&back=1">${h(w.Nazwa)}</a>`).join(', ')} albo zamroź.</p>`).join('')}
        <p class="small muted">Możesz też dołożyć jedno z tych dań do planu w „Tydzień”.</p></article>` : '') +
      (fromStock.length ? `<article class="card"><h3>✓ Masz w domu</h3>${fromStock.map(i => `<p class="small">${h(i.Nazwa)} – potrzeba ${h(fmtQty(i.Potrzeba, i.Jednostka))}, w zapasach ${h(fmtQty(i.zapas, i.Jednostka))}</p>`).join('')}</article>` : '') +
      `<div class="toolbar"><button class="btn ghost" data-unpack ${d.rozpakowana ? 'disabled' : ''}>📦 ${d.rozpakowana ? 'Zakupy rozpakowane' : 'Rozpakuj zakupy: nadwyżki → zapasy'}</button></div>`;
  };

  root.onchange = async ev => {
    if (ev.target.matches('[data-hide]')) {
      hide = ev.target.checked;
      localStorage.setItem(HIDE_KEY, hide ? '1' : '0');
      draw(data);
      return;
    }
    const cb = ev.target.closest('[data-skl]');
    if (!cb) return;
    const idSkl = cb.dataset.skl;
    const kupione = cb.checked;
    data.items.forEach(i => { if (i.ID_Skl === idSkl) i.Kupione = kupione; });
    await patchCache(cacheKey, d => ({ ...d, items: d.items.map(i => (i.ID_Skl === idSkl ? { ...i, Kupione: kupione } : i)) }));
    draw(data);
    enqueue('toggleBought', { idListy, idSkl, kupione });
  };

  root.onclick = async ev => {
    if (ev.target.closest('[data-range]')) {
      const s = sheet('Lista zakupów na okres', `
        <form class="form" data-rng>
          <div class="grid2">
            <label>Od<input class="input" type="date" name="od" value="${from}" required></label>
            <label>Do<input class="input" type="date" name="do" value="${to}" required></label>
          </div>
          ${cal && cal.sesje.length ? `<p class="small muted">Sesje gotowania: ${cal.sesje.map(x => `${h(shortDay(x.data))} → ${h(coverText(x.dni))}`).join(' · ')}</p>` : ''}
          <p class="small muted">Lista policzy składniki ze wszystkich posiłków zaplanowanych w tych dniach (najwyżej 31 dni).</p>
          <button class="btn">Pokaż listę</button>
        </form>`);
      s.el.querySelector('[data-rng]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target.elements;
        if (f.do.value < f.od.value) { toast('Koniec okresu jest przed początkiem', 'error'); return; }
        s.close();
        ctx.go(listHash(f.od.value, f.do.value));
      });
      return;
    }
    const b = ev.target.closest('[data-build]');
    if (b) {
      await busy(b, async () => {
        const d = await call('buildShopping', { from, to });
        await writeCache(cacheKey, d);
        draw(d);
        toast(`Lista: ${d.items.filter(i => num(i.Ilosc) > 0).length} pozycji do kupienia`);
      });
      return;
    }
    if (ev.target.closest('[data-additem]')) {
      const s = sheet('Dodaj do listy zakupów', `
        <form class="form" data-add>
          <label>Produkt<input class="input" name="n" list="skl-shop" required autocomplete="off" placeholder="np. papier do pieczenia, jogurt pitny"></label>
          <datalist id="skl-shop">${Object.values(S.idx.skl).map(x => `<option value="${h(x.Nazwa)}">`).join('')}</datalist>
          <div class="grid2">
            <label>Ilość<input class="input" name="q" type="number" step="any" min="0" value="1" inputmode="decimal"></label>
            <label>Jednostka<select class="input" name="j">${UNITS.map(u => `<option>${u}</option>`).join('')}</select></label>
          </div>
          <p class="small muted">Dodane ręcznie zostają na liście także po ponownym „Generuj z planu”.</p>
          <button class="btn">Dodaj</button>
        </form>`);
      s.el.querySelector('[data-add]').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target.elements;
        await busy(e.target.querySelector('button'), async () => {
          const d = await call('addShoppingItem', { idListy, nazwa: f.n.value.trim(), ilosc: num(f.q.value) || 1, jednostka: f.j.value });
          await writeCache(cacheKey, d);
          s.close();
          draw(d);
          toast(`Dodano: ${f.n.value.trim()}`, 'ok');
        });
      });
      return;
    }
    const del = ev.target.closest('[data-del]');
    if (del) {
      await busy(del, async () => {
        const d = await call('removeShoppingItem', { idListy, idSkl: del.dataset.del });
        await writeCache(cacheKey, d);
        draw(d);
      });
      return;
    }
    const td = ev.target.closest('[data-todoist]');
    if (td) {
      await busy(td, async () => {
        const r = await call('exportShopping', { idListy });
        toast(`Todoist: ${r.utworzono} pozycji w zadaniu „🛒 Zakupy ${fmtRange(from, to)}”${r.bledy ? ` (${r.bledy} nie weszło)` : ''}`, r.bledy ? 'error' : 'ok', 5000);
      });
      return;
    }
    const have = ev.target.closest('[data-have]');
    if (have) {
      const it = data.items.find(i => i.ID_Skl === have.dataset.have);
      const s = sheet(it.Nazwa, `
        <form class="form" data-st>
          <p class="small muted">Potrzeba w tym okresie:${h(fmtQty(it.Potrzeba || it.Ilosc, it.Jednostka))}. Ile masz w domu?</p>
          <label>Mam w zapasach (${h(it.Jednostka || 'g')})<input class="input" name="q" type="number" step="any" min="0" value="${h(it.zapas || '')}"></label>
          <label>Ważne do (opcjonalnie)<input class="input" name="dw" type="date"></label>
          <button class="btn">Zapisz i przelicz listę</button>
        </form>`);
      s.el.querySelector('[data-st]').addEventListener('submit', async e => {
        e.preventDefault();
        await busy(e.target.querySelector('button'), async () => {
          await call('setStock', { idSkl: it.ID_Skl, ilosc: num(e.target.elements.q.value), jednostka: it.Jednostka,
            ...(e.target.elements.dw.value ? { dataWaznosci: e.target.elements.dw.value } : {}) });
          const d = await call('buildShopping', { from, to });
          await writeCache(cacheKey, d);
          s.close();
          draw(d);
          toast('Zapasy zapisane, lista przeliczona', 'ok');
        });
      });
      return;
    }
    const up = ev.target.closest('[data-unpack]');
    if (up) {
      await busy(up, async () => {
        const r = await call('unpack', { idListy });
        data.rozpakowana = true;
        draw(data);
        toast(r.dodano.length ? 'Do zapasów: ' + r.dodano.map(x => `${x.Nazwa} ${fmtQty(x.Ilosc, 'g')}${x.Data_waznosci ? ' (' + x.Miejsce + ', zużyj ' + dueText(Math.round((parseKey(x.Data_waznosci) - parseKey(today())) / 864e5), x.Data_waznosci) + ')' : ''}`).join(', ') : 'Brak nadwyżek do zapisania', 'ok', 7000);
      });
    }
  };

  await live(cacheKey, 'shopping', { idListy }, draw);
}

const dueChip = r => {
  const t = dueText(r.dni, r.Data_waznosci);
  if (!t) return '';
  const cls = r.dni <= 1 ? 'warn' : r.dni <= 3 ? 'soon' : 'muted-chip';
  return ` <span class="chip ${cls} due">${r.dni <= 3 ? '⏰ ' : ''}${h(t)}</span>`;
};

async function renderStock(root, ctx) {
  root.innerHTML = '<div class="loading">Ładowanie zapasów…</div>';
  let rows = [];
  let ideas = null;
  const ideasHtml = () => {
    if (!rows.length) return '';
    if (!ideas) return '<article class="card"><h3>💡 Co ugotować z zapasów</h3><p class="small muted">Szukam przepisów…</p></article>';
    if (!ideas.length) return '<article class="card"><h3>💡 Co ugotować z zapasów</h3><p class="small muted">Żaden przepis nie korzysta z tych zapasów w większej ilości.</p></article>';
    return `<article class="card ideas"><h3>💡 Co ugotować z zapasów</h3>
      <p class="small muted">Najpierw te, które zużyją kończące się produkty. „Uzupełnij puste” w Tygodniu też je wybiera.</p>
      ${ideas.map((x, i) => `<div class="idea">
        <div class="row-between"><a href="#/przepis?id=${encodeURIComponent(x.ID_Pot)}&back=1"><b>${h(x.Nazwa)}</b></a>
          <button class="btn ghost small" data-plan="${i}">📅 Zaplanuj</button></div>
        <p class="small">z zapasów: ${x.uzywa.map(u => `${h(u.Nazwa)}${u.dni !== null && u.dni <= 3 ? ' ⏰' : ''}`).join(', ')}
          ${x.brakuje.length ? `<br><span class="muted">dokupić: ${x.brakuje.map(h).join(', ')}</span>` : ''}</p>
      </div>`).join('')}</article>`;
  };
  const draw = () => {
    if (!ctx.alive()) return;
    const places = ['lodówka', 'spiżarnia', 'zamrażarka'];
    const soon = rows.filter(r => r.dni !== null && r.dni !== undefined && r.dni <= 3).sort((a, b) => a.dni - b.dni);
    root.innerHTML = `<div class="toolbar"><button class="btn small" data-add>+ Dodaj produkt</button></div>` +
      (soon.length ? `<article class="card soon-card"><h3>⏰ Zużyj najpierw</h3>
        ${soon.map(r => `<div class="shop-row st"><span class="name">${h(r.Nazwa)}${dueChip(r)}<br><span class="small muted">${h(r.Miejsce || '')}</span></span>
          <span class="qty">${h(fmtQty(r.Ilosc, r.Jednostka))}</span><button class="iconbtn small" data-edit="${h(r.ID_Skl)}" aria-label="Zmień">✎</button></div>`).join('')}
      </article>` : '') +
      ideasHtml() +
      (rows.length ? places.map(pl => {
        const list = rows.filter(r => (r.Miejsce || 'spiżarnia') === pl);
        return !list.length ? '' : `<article class="card"><h3>${pl === 'lodówka' ? '🧊' : pl === 'zamrażarka' ? '❄️' : '🥫'} ${h(pl)}</h3>
          ${list.map(r => `<div class="shop-row st"><span class="name">${h(r.Nazwa)}${dueChip(r)}</span><span class="qty">${h(fmtQty(r.Ilosc, r.Jednostka))}</span>
            <button class="iconbtn small" data-edit="${h(r.ID_Skl)}" aria-label="Zmień">✎</button></div>`).join('')}</article>`;
      }).join('') : '<div class="empty"><p>Brak zapisanych zapasów.</p><p class="small muted">Dodawaj z listy zakupów („⋯ → mam w domu”) albo „Rozpakuj zakupy” po zakupach – reszty z otwartych opakowań trafią tutaj z terminem, lista zakupów będzie je odejmować, a „Uzupełnij puste” zaplanuje dania, które je zużyją.</p></div>');
  };
  root.onclick = ev => {
    const e = ev.target.closest('[data-edit]');
    if (e) { editStock(rows.find(r => r.ID_Skl === e.dataset.edit), reload); return; }
    if (ev.target.closest('[data-add]')) { editStock(null, reload); return; }
    const p = ev.target.closest('[data-plan]');
    if (p && ideas) planIdea(ideas[Number(p.dataset.plan)]);
  };
  const loadIdeas = () => live('pidea', 'pantryIdeas', {}, d => { ideas = d.pomysly || []; draw(); }).catch(() => { ideas = []; draw(); });
  const reload = async () => {
    await live('stock', 'stock', {}, r => { rows = r; draw(); });
    if (rows.length) await loadIdeas(); else { ideas = []; draw(); }
  };
  await reload();
}

/** „Zaplanuj” z pomysłów: dzień + posiłek → setMeals (zastępuje to, co jest w tym posiłku). */
function planIdea(x) {
  const meals = mealsInUse().filter(m => !x.typy.length || x.typy.includes(m));
  const list = meals.length ? meals : mealsInUse();
  const s = sheet(x.Nazwa, `
    <form class="form" data-pl>
      <div class="grid2">
        <label>Dzień<input class="input" type="date" name="d" value="${addDays(today(), 1)}" required></label>
        <label>Posiłek<select class="input" name="t">${list.map(m => `<option>${h(m)}</option>`).join('')}</select></label>
      </div>
      <p class="small muted">Zastąpi to, co jest już zaplanowane na ten posiłek (dla osób, które go jedzą).</p>
      <button class="btn">Dodaj do planu</button>
    </form>`);
  s.el.querySelector('[data-pl]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements;
    await busy(e.target.querySelector('button'), async () => {
      await call('setMeals', { items: [{ data: f.d.value, typ: f.t.value, idPot: x.ID_Pot }] });
      s.close();
      toast(`Zaplanowano: ${x.Nazwa} – ${fmtDay(f.d.value)}, ${f.t.value.toLowerCase()}`, 'ok', 4500);
    });
  });
}

function editStock(row, reload) {
  const s = sheet(row ? row.Nazwa : 'Dodaj do zapasów', `
    <form class="form" data-f>
      ${row ? '' : `<label>Produkt<input class="input" name="n" list="skl-all" required autocomplete="off"></label>
        <datalist id="skl-all">${Object.values(S.idx.skl).map(x => `<option value="${h(x.Nazwa)}">`).join('')}</datalist>`}
      <label>Ilość (g / szt)<input class="input" name="q" type="number" step="any" min="0" value="${h(row ? row.Ilosc : '')}" required></label>
      <label>Gdzie<select class="input" name="m">${['lodówka', 'spiżarnia', 'zamrażarka'].map(x => `<option ${row && row.Miejsce === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Ważne do<input class="input" name="dw" type="date" value="${h(row && row.Data_waznosci ? row.Data_waznosci : '')}"></label>
      <div class="chips">${[[1, 'jutro'], [3, '+3 dni'], [5, '+5 dni'], [14, '+2 tyg.']].map(([n, l]) => `<button type="button" class="chip" data-due="${n}">${l}</button>`).join('')}
        <button type="button" class="chip" data-due="">bez terminu</button></div>
      <p class="small muted">Ilość 0 usuwa produkt z zapasów. Termin podpowie, co zużyć najpierw – w zapasach, na ekranie Dziś i przy planowaniu.</p>
      <button class="btn">Zapisz</button>
    </form>`);
  s.el.addEventListener('click', ev => {
    const c = ev.target.closest('[data-due]');
    if (c) s.el.querySelector('[name=dw]').value = c.dataset.due === '' ? '' : addDays(today(), Number(c.dataset.due));
  });
  s.el.querySelector('[data-f]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements;
    const skl = row ? S.idx.skl[row.ID_Skl] : Object.values(S.idx.skl).find(x => norm(x.Nazwa) === norm(f.n.value));
    if (!skl) { toast('Nie ma takiego produktu w bazie składników', 'error'); return; }
    await busy(e.target.querySelector('button'), async () => {
      await call('setStock', { idSkl: skl.ID_Skl, ilosc: num(f.q.value), miejsce: f.m.value, jednostka: row ? row.Jednostka : (skl.Jednostka || 'g'), dataWaznosci: f.dw.value });
      s.close();
      await reload();
    });
  });
}

async function renderFreezer(root, ctx) {
  root.innerHTML = '<div class="loading">Ładowanie zamrażarki…</div>';
  const draw = rows => {
    if (!ctx.alive()) return;
    const t = today();
    const byDish = {};
    rows.forEach(r => { (byDish[r.Nazwa] ||= []).push(r); });
    root.innerHTML = rows.length ? Object.keys(byDish).sort().map(n => `<article class="card">
        <div class="row-between"><h3>${h(n)}</h3><span class="chip">${byDish[n].length} porcji</span></div>
        ${byDish[n].map(r => `<div class="shop-row ${String(r.Najlepiej_do) < t ? 'warn-text' : ''}">
          <span class="name">${r.ID_Osoby ? h(osobaName(r.ID_Osoby)) : '—'} · ${fmtNum(r.Gramy)} g${r.kcal ? ' · ' + fmtNum(r.kcal) + ' kcal' : ''}
            <br><span class="small muted">zamr. ${h(fmtDay(key(new Date(r.Data_zamrozenia))))} · najlepiej do ${h(fmtDay(String(r.Najlepiej_do).slice(0, 10)))}${r.Status === 'rozmrażane' ? ' · 🧊 rozmrażane' : ''}${r.Uwagi ? ' · ' + h(r.Uwagi) : ''}</span></span>
          <button class="iconbtn small" data-act="${h(r.ID)}" aria-label="Akcje">⋯</button></div>`).join('')}
      </article>`).join('') : '<div class="empty"><p>Rejestr zamrażarki jest pusty.</p><p class="small muted">Po sesji: Gotowanie → Porcjowanie → „Zapisz porcje do rejestru zamrażarki”. Niezjedzone porcje z ekranu Dziś też można tu odłożyć.</p></div>';
    root.onclick = async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const s = sheet('Porcja z zamrażarki', `<div class="actions-list">
        <button class="btn" data-st="rozmrażane">🧊 Przełożona do lodówki (rozmrażam)</button>
        <button class="btn ghost" data-st="zjedzone">✓ Zjedzona</button>
        <button class="btn ghost danger" data-st="wyrzucone">🗑 Wyrzucona</button></div>`);
      s.el.addEventListener('click', async e => {
        const x = e.target.closest('[data-st]');
        if (!x) return;
        await busy(x, async () => {
          await call('freezerStatus', { id: b.dataset.act, status: x.dataset.st });
          s.close();
          await reload();
        });
      });
    };
  };
  const reload = () => live('freezer', 'freezer', {}, draw);
  await reload();
}
