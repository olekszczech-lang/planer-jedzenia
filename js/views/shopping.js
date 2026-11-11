// Zakupy: lista w opakowaniach sklepowych (sztuki, kartony, puszki) z resztkami i pomysłami na nie,
// zapasy (spiżarnia / lodówka / zamrażarka) i rejestr gotowych porcji w zamrażarce.
import { live, call, enqueue, patchCache, writeCache } from '../api.js';
import { S, osobaName } from '../state.js';
import { busy, toast, sheet } from '../ui.js';
import { h, today, addDays, mondayOf, fmtRange, fmtQty, fmtNum, fmtDay, truthy, isKey, norm, num, key } from '../util.js';

const HIDE_KEY = 'planer.hideBought';

const pieces = it => {
  if (!it.opakowanie) return '';
  if (it.opakowanie === 'szt' || it.opakowanie === 'ząbek') return `${it.sztuk} ${it.opakowanie === 'szt' ? 'szt' : 'ząbk.'}`;
  return `${it.sztuk} × ${it.opakowanie}`;
};

export async function render(root, q, ctx) {
  const tab = q.t || 'lista';
  root.innerHTML = `
    <div class="tabs">
      <a class="tab ${tab === 'lista' ? 'on' : ''}" href="#/zakupy?t=lista${q.w ? '&w=' + q.w : ''}">🛒 Lista</a>
      <a class="tab ${tab === 'zapasy' ? 'on' : ''}" href="#/zakupy?t=zapasy">🥫 Zapasy</a>
      <a class="tab ${tab === 'zamrazarka' ? 'on' : ''}" href="#/zakupy?t=zamrazarka">❄️ Zamrażarka</a>
    </div>
    <section data-body></section>`;
  const body = root.querySelector('[data-body]');
  if (tab === 'zapasy') return renderStock(body, ctx);
  if (tab === 'zamrazarka') return renderFreezer(body, ctx);
  return renderList(body, q, ctx);
}

async function renderList(root, q, ctx) {
  const from = mondayOf(isKey(q.w) ? q.w : today());
  const to = addDays(from, 6);
  const idListy = `L${from}_${to}`;
  const cacheKey = 'shop:' + idListy;
  let data = { items: [] };
  let hide = localStorage.getItem(HIDE_KEY) === '1';

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="#/zakupy?t=lista&w=${addDays(from, -7)}" aria-label="Poprzedni tydzień">‹</a>
      <div class="datenav-title"><strong>${h(fmtRange(from, to))}</strong><span class="small muted" data-progress></span></div>
      <a class="iconbtn" href="#/zakupy?t=lista&w=${addDays(from, 7)}" aria-label="Następny tydzień">›</a>
    </div>
    <div class="toolbar">
      <button class="btn" data-build>Generuj z planu</button>
      <label class="check"><input type="checkbox" data-hide ${hide ? 'checked' : ''}> Ukryj kupione</label>
    </div>
    <section data-list><div class="loading">Ładowanie listy…</div></section>`;

  const draw = d => {
    if (!ctx.alive()) return;
    data = d;
    const items = d.items || [];
    const toBuy = items.filter(i => num(i.Ilosc) > 0);
    const bought = toBuy.filter(i => truthy(i.Kupione)).length;
    root.querySelector('[data-progress]').textContent = items.length ? `${bought} / ${toBuy.length} kupione` : '';
    const box = root.querySelector('[data-list]');
    if (!items.length) {
      box.innerHTML = `<div class="empty"><p>Lista na ten tydzień jest pusta.</p>
        <p class="muted small">„Generuj z planu” policzy składniki ze wszystkich zaplanowanych posiłków, odejmie zapasy i zaokrągli do opakowań ze sklepu.</p></div>`;
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
              <span class="name">${h(i.Nazwa)}${i.zapas ? `<br><span class="small muted">w zapasach: ${h(fmtQty(i.zapas, i.Jednostka))}</span>` : ''}</span>
              <span class="qty">${i.opakowanie ? h(pieces(i)) : h(fmtQty(i.Ilosc, i.Jednostka))}${i.opakowanie ? `<br><span class="small muted">${h(fmtQty(i.Ilosc, i.Jednostka))}${i.zostanie ? ` · zostanie ${h(fmtQty(i.zostanie, 'g'))}` : ''}</span>` : ''}</span>
            </label>
            <button class="iconbtn small" data-have="${h(i.ID_Skl)}" aria-label="Mam w domu">⋯</button>
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
    const have = ev.target.closest('[data-have]');
    if (have) {
      const it = data.items.find(i => i.ID_Skl === have.dataset.have);
      const s = sheet(it.Nazwa, `
        <form class="form" data-st>
          <p class="small muted">Potrzeba w tym tygodniu: ${h(fmtQty(it.Potrzeba || it.Ilosc, it.Jednostka))}. Ile masz w domu?</p>
          <label>Mam w zapasach (${h(it.Jednostka || 'g')})<input class="input" name="q" type="number" step="any" min="0" value="${h(it.zapas || '')}"></label>
          <button class="btn">Zapisz i przelicz listę</button>
        </form>`);
      s.el.querySelector('[data-st]').addEventListener('submit', async e => {
        e.preventDefault();
        await busy(e.target.querySelector('button'), async () => {
          await call('setStock', { idSkl: it.ID_Skl, ilosc: num(e.target.elements.q.value), jednostka: it.Jednostka });
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
        toast(r.dodano.length ? 'Do zapasów: ' + r.dodano.map(x => `${x.Nazwa} ${fmtQty(x.Ilosc, 'g')}`).join(', ') : 'Brak nadwyżek do zapisania', 'ok', 6000);
      });
    }
  };

  await live(cacheKey, 'shopping', { idListy }, draw);
}

async function renderStock(root, ctx) {
  root.innerHTML = '<div class="loading">Ładowanie zapasów…</div>';
  const draw = rows => {
    if (!ctx.alive()) return;
    const places = ['lodówka', 'spiżarnia', 'zamrażarka'];
    root.innerHTML = `<div class="toolbar"><button class="btn small" data-add>+ Dodaj produkt</button></div>` +
      (rows.length ? places.map(pl => {
        const list = rows.filter(r => (r.Miejsce || 'spiżarnia') === pl);
        return !list.length ? '' : `<article class="card"><h3>${pl === 'lodówka' ? '🧊' : pl === 'zamrażarka' ? '❄️' : '🥫'} ${h(pl)}</h3>
          ${list.map(r => `<div class="shop-row"><span class="name">${h(r.Nazwa)}</span><span class="qty">${h(fmtQty(r.Ilosc, r.Jednostka))}</span>
            <button class="iconbtn small" data-edit="${h(r.ID_Skl)}" aria-label="Zmień">✎</button></div>`).join('')}</article>`;
      }).join('') : '<div class="empty"><p>Brak zapisanych zapasów.</p><p class="small muted">Dodawaj z listy zakupów („⋯ → mam w domu”) albo „Rozpakuj zakupy” po zakupach – nadwyżki z opakowań trafią tutaj i lista zakupów będzie je odejmować.</p></div>');
    root.onclick = ev => {
      const e = ev.target.closest('[data-edit]');
      if (e) { editStock(rows.find(r => r.ID_Skl === e.dataset.edit), reload); return; }
      if (ev.target.closest('[data-add]')) editStock(null, reload);
    };
  };
  const reload = () => live('stock', 'stock', {}, draw);
  await reload();
}

function editStock(row, reload) {
  const s = sheet(row ? row.Nazwa : 'Dodaj do zapasów', `
    <form class="form" data-f>
      ${row ? '' : `<label>Produkt<input class="input" name="n" list="skl-all" required autocomplete="off"></label>
        <datalist id="skl-all">${Object.values(S.idx.skl).map(x => `<option value="${h(x.Nazwa)}">`).join('')}</datalist>`}
      <label>Ilość (g / szt)<input class="input" name="q" type="number" step="any" min="0" value="${h(row ? row.Ilosc : '')}" required></label>
      <label>Gdzie<select class="input" name="m">${['lodówka', 'spiżarnia', 'zamrażarka'].map(x => `<option ${row && row.Miejsce === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <p class="small muted">Ilość 0 usuwa produkt z zapasów.</p>
      <button class="btn">Zapisz</button>
    </form>`);
  s.el.querySelector('[data-f]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements;
    const skl = row ? S.idx.skl[row.ID_Skl] : Object.values(S.idx.skl).find(x => norm(x.Nazwa) === norm(f.n.value));
    if (!skl) { toast('Nie ma takiego produktu w bazie składników', 'error'); return; }
    await busy(e.target.querySelector('button'), async () => {
      await call('setStock', { idSkl: skl.ID_Skl, ilosc: num(f.q.value), miejsce: f.m.value, jednostka: row ? row.Jednostka : (skl.Jednostka || 'g') });
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
