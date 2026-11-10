// Zakupy: lista z planu tygodnia, odhaczanie działa offline (kolejka).
import { live, call, enqueue, patchCache, writeCache } from '../api.js';
import { busy, toast } from '../ui.js';
import { h, today, addDays, mondayOf, fmtRange, fmtQty, truthy, isKey } from '../util.js';

const HIDE_KEY = 'planer.hideBought';

export async function render(root, q, ctx) {
  const from = mondayOf(isKey(q.w) ? q.w : today());
  const to = addDays(from, 6);
  const idListy = `L${from}_${to}`;
  const cacheKey = 'shop:' + idListy;
  let items = [];
  let hide = localStorage.getItem(HIDE_KEY) === '1';

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="#/zakupy?w=${addDays(from, -7)}" aria-label="Poprzedni tydzień">‹</a>
      <div class="datenav-title"><strong>${h(fmtRange(from, to))}</strong><span class="small muted" data-progress></span></div>
      <a class="iconbtn" href="#/zakupy?w=${addDays(from, 7)}" aria-label="Następny tydzień">›</a>
    </div>
    <div class="toolbar">
      <button class="btn" data-build>Generuj z planu</button>
      <label class="check"><input type="checkbox" data-hide ${hide ? 'checked' : ''}> Ukryj kupione</label>
    </div>
    <section data-list><div class="loading">Ładowanie listy…</div></section>`;

  const draw = data => {
    if (!ctx.alive()) return;
    items = data.items || [];
    const bought = items.filter(i => truthy(i.Kupione)).length;
    root.querySelector('[data-progress]').textContent = items.length ? `${bought} / ${items.length} kupione` : '';
    const box = root.querySelector('[data-list]');
    if (!items.length) {
      box.innerHTML = `<div class="empty"><p>Lista na ten tydzień jest pusta.</p>
        <p class="muted small">„Generuj z planu” policzy składniki ze wszystkich zaplanowanych posiłków (minus magazyn).</p></div>`;
      return;
    }
    const visible = items.filter(i => !hide || !truthy(i.Kupione));
    const cats = [...new Set(visible.map(i => i.Kategoria))];
    box.innerHTML = cats.map(cat => `
      <article class="card shop-cat">
        <h3>${h(cat)}</h3>
        ${visible.filter(i => i.Kategoria === cat).map(i => `
          <label class="shop-item ${truthy(i.Kupione) ? 'done' : ''}">
            <input type="checkbox" data-skl="${h(i.ID_Skl)}" ${truthy(i.Kupione) ? 'checked' : ''}>
            <span class="name">${h(i.Nazwa)}</span>
            <span class="qty">${h(fmtQty(i.Ilosc, i.Jednostka))}</span>
          </label>`).join('')}
      </article>`).join('') || '<div class="empty"><p>Wszystko kupione 🎉</p></div>';
  };

  root.onchange = async ev => {
    if (ev.target.matches('[data-hide]')) {
      hide = ev.target.checked;
      localStorage.setItem(HIDE_KEY, hide ? '1' : '0');
      draw({ items });
      return;
    }
    const cb = ev.target.closest('[data-skl]');
    if (!cb) return;
    const idSkl = cb.dataset.skl;
    const kupione = cb.checked;
    items.forEach(i => { if (i.ID_Skl === idSkl) i.Kupione = kupione; });
    await patchCache(cacheKey, d => ({ ...d, items: d.items.map(i => (i.ID_Skl === idSkl ? { ...i, Kupione: kupione } : i)) }));
    draw({ items });
    enqueue('toggleBought', { idListy, idSkl, kupione });
  };

  root.onclick = async ev => {
    const b = ev.target.closest('[data-build]');
    if (!b) return;
    await busy(b, async () => {
      const data = await call('buildShopping', { from, to });
      await writeCache(cacheKey, data);
      draw(data);
      toast(`Lista: ${data.items.length} pozycji`);
    });
  };

  await live(cacheKey, 'shopping', { idListy }, draw);
}
