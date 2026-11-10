// Tydzień: siatka dzień × posiłek, zmiana potraw, autouzupełnianie, szablony.
import { live, call } from '../api.js';
import { S, potName, osobaName, gramsOf, sortEntries, mealsInUse, awayFor, isKid, PLACE_ICON } from '../state.js';
import { pickDish, chooseAction, busy, toast, sheet } from '../ui.js';
import { h, today, addDays, mondayOf, fmtDay, fmtRange, fmtNum, truthy, isKey } from '../util.js';

export async function render(root, q, ctx) {
  const from = mondayOf(isKey(q.w) ? q.w : today());
  const to = addDays(from, 6);
  let rows = [];

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="#/tydzien?w=${addDays(from, -7)}" aria-label="Poprzedni tydzień">‹</a>
      <div class="datenav-title"><strong>${h(fmtRange(from, to))}</strong>
        ${from !== mondayOf(today()) ? `<a href="#/tydzien" class="small">bieżący tydzień</a>` : '<span class="small muted">ten tydzień</span>'}</div>
      <a class="iconbtn" href="#/tydzien?w=${addDays(from, 7)}" aria-label="Następny tydzień">›</a>
    </div>
    <div class="toolbar">
      <button class="btn" data-autofill>Uzupełnij puste</button>
      <button class="btn ghost" data-templates>Szablony</button>
    </div>
    <section data-days><div class="loading">Ładowanie planu…</div></section>`;

  const draw = data => {
    if (!ctx.alive()) return;
    rows = sortEntries(data);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    root.querySelector('[data-days]').innerHTML = days.map(d => `
      <article class="card day ${d === today() ? 'is-today' : ''}">
        <a class="day-title" href="#/dzis?d=${d}">${h(fmtDay(d, true))}</a>
        ${mealsInUse().map(typ => {
          const es = rows.filter(r => r.Data === d && r.Typ_posilku === typ);
          const dishes = [...new Set(es.map(e => e.ID_Pot))];
          return `<button class="slot ${es.length ? '' : 'free'}" data-d="${d}" data-typ="${h(typ)}">
            <span class="slot-type">${h(typ)}</span>
            <span class="slot-body">${dishes.length ? dishes.map(id => `
              <span class="slot-dish ${es.filter(e => e.ID_Pot === id).every(e => truthy(e.Zjedzone)) ? 'done' : ''}">${h(potName(id))}</span>
              <span class="slot-people">${es.filter(e => e.ID_Pot === id).map(e => `${h(osobaName(e.ID_Osoby))}${PLACE_ICON[e.Miejsce] ? ' ' + PLACE_ICON[e.Miejsce] : ''} ${fmtNum(gramsOf(e))} g`).join(' · ')}</span>`).join('')
              : '<span class="muted">+ dodaj</span>'}
              ${awayFor(d, typ).length ? `<span class="slot-people">🏫 ${awayFor(d, typ).map(a => h(osobaName(a.id))).join(', ')}</span>` : ''}</span>
          </button>`;
        }).join('')}
      </article>`).join('');
  };

  const reload = async () => { await live(`plan:${from}:${to}`, 'plan', { from, to }, draw); };

  root.onclick = async ev => {
    const slot = ev.target.closest('.slot');
    if (slot) {
      const { d, typ } = slot.dataset;
      const filled = !slot.classList.contains('free');
      const inSlot = [...new Set(rows.filter(r => r.Data === d && r.Typ_posilku === typ).map(r => r.ID_Osoby))];
      const kids = inSlot.filter(isKid), adults = inSlot.filter(x => !isKid(x));
      const split = kids.length && adults.length;
      let act = 'change';
      if (filled) {
        act = await chooseAction(`${typ} · ${fmtDay(d)}`, [
          { id: 'change', label: split ? 'Zmień dla wszystkich' : 'Zmień potrawę' },
          ...(split ? [{ id: 'change-adults', label: 'Zmień tylko dorosłym' }, { id: 'change-kids', label: 'Zmień tylko dzieciom' }] : []),
          { id: 'day', label: 'Otwórz dzień' },
          { id: 'remove', label: 'Usuń z planu', danger: true }
        ]);
      }
      if (act === 'day') ctx.go('#/dzis?d=' + d);
      if (act && act.startsWith('change')) {
        const osoby = act === 'change-adults' ? adults : act === 'change-kids' ? kids : (filled ? inSlot : undefined);
        const idPot = await pickDish(typ, `${typ} · ${fmtDay(d)}`);
        if (idPot) await busy(slot, async () => { await call('setMeals', { items: [{ data: d, typ, idPot, osoby }] }); await reload(); });
      }
      if (act === 'remove') await busy(slot, async () => { await call('removeMeal', { data: d, typ }); await reload(); });
      return;
    }

    const auto = ev.target.closest('[data-autofill]');
    if (auto) {
      await busy(auto, async () => {
        const created = await call('autoFill', { from, to });
        toast(created.length ? `Dodano ${created.length} wpisów` : 'Wszystkie posiłki są już zaplanowane');
        await reload();
      });
      return;
    }

    if (ev.target.closest('[data-templates]')) openTemplates();
  };

  function openTemplates() {
    const list = S.boot.szablony || [];
    const s = sheet('Szablony tygodnia', `
      <p class="small muted">Wczytanie zastępuje posiłki w tygodniu ${h(fmtRange(from, to))}.</p>
      <ul class="picklist">${list.length ? list.map(t => `
        <li><button data-apply="${h(t.nazwa)}"><span>${h(t.nazwa)}</span><small>${t.posilki} posiłków · wczytaj</small></button></li>`).join('')
        : '<li class="muted pad">Brak zapisanych szablonów</li>'}</ul>
      <form class="inline-form" data-save>
        <input class="input" name="name" placeholder="Nazwa nowego szablonu" required>
        <button class="btn">Zapisz ten tydzień</button>
      </form>`);
    s.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-apply]');
      if (!b) return;
      await busy(b, async () => {
        const r = await call('applyTemplate', { name: b.dataset.apply, from });
        toast(`Wczytano „${r.nazwa}”: ${r.posilki} posiłków`);
        s.close();
        await reload();
      });
    });
    s.el.querySelector('[data-save]').addEventListener('submit', async e => {
      e.preventDefault();
      const name = e.target.elements.name.value.trim();
      await busy(e.target.querySelector('button'), async () => {
        const r = await call('saveTemplate', { name, from });
        S.boot.szablony = (await call('templates'));
        toast(`Zapisano szablon „${r.nazwa}”`);
        s.close();
      });
    });
  }

  await reload();
}
