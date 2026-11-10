// Dziś: posiłki dnia per osoba, odhaczanie "zjedzone", bilans kcal.
import { live, call, enqueue, patchCache } from '../api.js';
import { S, potName, osobaName, multOf, macros, gramsOf, celDnia, sortEntries, mealsInUse, mealsOf, placeOf, awayFor, PLACE_ICON, PLACE_LABEL } from '../state.js';
import { pickDish, chooseAction, busy, toast } from '../ui.js';
import { h, today, addDays, fmtDay, fmtNum, truthy, isKey } from '../util.js';

export async function render(root, q, ctx) {
  const d = isKey(q.d) ? q.d : today();
  const cacheKey = `plan:${d}:${d}`;
  let rows = [];

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="#/dzis?d=${addDays(d, -1)}" aria-label="Poprzedni dzień">‹</a>
      <div class="datenav-title">
        <strong>${h(fmtDay(d, true))}</strong>
        ${d !== today() ? `<a href="#/dzis" class="small">wróć do dziś</a>` : '<span class="small muted">dziś</span>'}
      </div>
      <a class="iconbtn" href="#/dzis?d=${addDays(d, 1)}" aria-label="Następny dzień">›</a>
    </div>
    <section data-summary></section>
    <section data-meals><div class="loading">Ładowanie planu…</div></section>`;

  const draw = data => {
    if (!ctx.alive()) return;
    rows = sortEntries(data);
    drawSummary();
    drawMeals();
  };

  function drawSummary() {
    const people = [...new Set([...S.idx.aktywne, ...rows.map(r => r.ID_Osoby)])];
    root.querySelector('[data-summary]').innerHTML = `<div class="summary">${people.map(id => {
      const mine = rows.filter(r => r.ID_Osoby === id);
      const plan = mine.reduce((s, e) => s + macros(e.ID_Pot, multOf(e)).kcal, 0);
      const eatenM = mine.filter(e => truthy(e.Zjedzone)).map(e => macros(e.ID_Pot, multOf(e)));
      const eaten = eatenM.reduce((s, m) => s + m.kcal, 0);
      // posiłki poza domem (szkoła, przedszkole, babcia) – ich kcal nie liczymy do celu „z domu”
      const cele = S.idx.cele[id] || {};
      const awayMeals = mealsOf(id).filter(t => placeOf(id, d, t).miejsce === 'poza domem');
      const awayKcal = awayMeals.reduce((s, t) => s + (cele[t] || 0), 0);
      const homeGoal = (celDnia(id) - awayKcal) || plan || 1;
      const pct = Math.min(100, Math.round(eaten / homeGoal * 100));
      const sum = k => fmtNum(eatenM.reduce((s, m) => s + m[k], 0));
      return `<div class="person-sum">
        <div class="row-between"><strong>${h(osobaName(id))}</strong>
          <span><b>${fmtNum(eaten)}</b> / ${fmtNum(homeGoal)} kcal</span></div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <div class="small muted">B ${sum('B')} g · T ${sum('T')} g · W ${sum('W')} g · zaplanowane ${fmtNum(plan)} kcal</div>
        ${awayMeals.length ? `<div class="small muted">🏫 + ok. ${fmtNum(awayKcal)} kcal poza domem (${awayMeals.map(h).join(', ')})</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function drawMeals() {
    root.querySelector('[data-meals]').innerHTML = mealsInUse().map(typ => {
      const entries = rows.filter(r => r.Typ_posilku === typ);
      const away = awayFor(d, typ);
      const awayHtml = away.length ? `<p class="away small">🏫 ${away.map(a => `${h(osobaName(a.id))}${a.uwagi ? ' – ' + h(a.uwagi) : ''}`).join(' · ')}</p>` : '';
      if (!entries.length) {
        const someoneHome = S.idx.aktywne.some(id => mealsOf(id).includes(typ) && placeOf(id, d, typ).miejsce !== 'poza domem');
        return `<article class="card meal empty-slot">
          <div class="row-between"><h3>${h(typ)}</h3>${someoneHome ? `<button class="btn small ghost" data-add="${h(typ)}">+ Dodaj</button>` : ''}</div>
          ${awayHtml}
        </article>`;
      }
      const dishes = [...new Set(entries.map(e => e.ID_Pot))];
      return `<article class="card meal">
        <div class="row-between"><h3>${h(typ)}</h3>
          <button class="iconbtn small" data-slot="${h(typ)}" aria-label="Opcje posiłku">⋯</button></div>
        ${awayHtml}
        ${dishes.map(idPot => `
          <div class="dish">
            <a class="dish-name" href="#/przepis?id=${encodeURIComponent(idPot)}">${h(potName(idPot))}</a>
            ${entries.filter(e => e.ID_Pot === idPot).map(e => {
              const done = truthy(e.Zjedzone);
              return `<label class="portion ${done ? 'done' : ''}">
                <input type="checkbox" data-eat="${h(e.ID_Wpisu)}" ${done ? 'checked' : ''}>
                <span class="who">${h(osobaName(e.ID_Osoby))}${PLACE_ICON[e.Miejsce] ? ` <span class="place" title="${h(PLACE_LABEL[e.Miejsce])}">${PLACE_ICON[e.Miejsce]}</span>` : ''}</span>
                <span class="grams">${fmtNum(gramsOf(e))} g</span>
                <span class="kcal">${fmtNum(macros(e.ID_Pot, multOf(e)).kcal)} kcal</span>
              </label>`;
            }).join('')}
          </div>`).join('')}
      </article>`;
    }).join('');
  }

  root.onchange = async ev => {
    const cb = ev.target.closest('[data-eat]');
    if (!cb) return;
    const id = cb.dataset.eat;
    const done = cb.checked;
    rows.forEach(r => { if (r.ID_Wpisu === id) r.Zjedzone = done; });
    await patchCache(cacheKey, data => data.map(r => (r.ID_Wpisu === id ? { ...r, Zjedzone: done } : r)));
    drawSummary();
    drawMeals();
    enqueue(done ? 'logEaten' : 'unlogEaten', { id });
  };

  root.onclick = async ev => {
    const add = ev.target.closest('[data-add]');
    if (add) {
      const typ = add.dataset.add;
      const idPot = await pickDish(typ);
      if (idPot) await busy(add, async () => { await call('setMeals', { items: [{ data: d, typ, idPot }] }); ctx.refresh(); });
      return;
    }
    const slot = ev.target.closest('[data-slot]');
    if (slot) {
      const typ = slot.dataset.slot;
      const act = await chooseAction(typ, [
        { id: 'change', label: 'Zmień potrawę' },
        { id: 'remove', label: 'Usuń z planu', danger: true }
      ]);
      if (act === 'change') {
        const idPot = await pickDish(typ);
        if (idPot) await busy(slot, async () => { await call('setMeals', { items: [{ data: d, typ, idPot }] }); ctx.refresh(); });
      } else if (act === 'remove') {
        await busy(slot, async () => { await call('removeMeal', { data: d, typ }); toast('Usunięto ' + typ); ctx.refresh(); });
      }
    }
  };

  await live(cacheKey, 'plan', { from: d, to: d }, draw);
}
