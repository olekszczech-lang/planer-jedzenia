// Tydzień: siatka dzień × posiłek, zmiana potraw, autouzupełnianie, szablony.
import { live, call } from '../api.js';
import { S, potName, osobaName, gramsOf, sortEntries, mealsInUse, mealsShown, offProfile, awayFor, isKid, PLACE_ICON } from '../state.js';

const VIEWS = [['dni', '📅 Dni'], ['tabela', '▦ Tabela'], ['osoba', '🙋 Osoba'], ['potrawy', '🍲 Potrawy']];
import { pickDish, chooseAction, busy, toast, sheet } from '../ui.js';
import { h, today, addDays, mondayOf, fmtDay, fmtRange, fmtNum, truthy, isKey } from '../util.js';
import { shortDay, coverText } from '../sessions.js';

const porcje = (n, one) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'porcje' : 'porcji');

export async function render(root, q, ctx) {
  const from = mondayOf(isKey(q.w) ? q.w : today());
  const to = addDays(from, 6);
  let rows = [];
  let lastData = null;
  let cal = null; // sesje gotowania obejmujące ten tydzień
  const sessOf = d => cal && cal.sesje.find(s => s.dni.includes(d));
  const cookingOn = d => cal ? cal.sesje.filter(s => s.data === d) : [];
  const sessChips = d => {
    const s = sessOf(d);
    const cook = cookingOn(d);
    return (cook.length ? cook.map(c => `<a class="chip strong" href="#/gotowanie?w=${mondayOf(c.od)}&sid=${encodeURIComponent(c.id)}">🔪 gotujesz na ${h(coverText(c.dni))}</a>`).join('') : '') +
      (s ? `<span class="chip">🍳 z sesji ${h(shortDay(s.data))}</span>`
        : !cal ? ''
        : (cal.ustawienia && cal.ustawienia.dni.length && d >= today()
          ? `<a class="chip warn" href="#/gotowanie?w=${from}" title="Ten dzień nie jest w żadnej sesji gotowania">⚠️ bez sesji – na świeżo</a>`
          : '<span class="chip">🥚 na świeżo</span>'));
  };
  let view = localStorage.getItem('planer.weekView') || 'dni';
  let person = localStorage.getItem('planer.weekPerson') || S.idx.aktywne[0];
  if (!S.idx.osoba[person]) person = S.idx.aktywne[0];

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
    <div class="chips filter" data-views>${VIEWS.map(([v, l]) => `<button class="chip ${v === view ? 'on' : ''}" data-view="${v}">${l}</button>`).join('')}
      ${view === 'osoba' ? S.idx.aktywne.map(o => `<button class="chip ${o === person ? 'on' : ''}" data-person="${h(o)}">${h(osobaName(o))}</button>`).join('') : ''}</div>
    <div data-orphans></div>
    <section data-days><div class="loading">Ładowanie planu…</div></section>`;

  // Posiłki spoza profilu (np. dzieci miały „Podwieczorek”, a teraz w profilu jest „Przekąska”) – widoczne i do usunięcia
  const drawOrphans = () => {
    const box = root.querySelector('[data-orphans]');
    if (!box) return;
    const t = today();
    const orph = rows.filter(e => e.Data >= t && offProfile(e));
    if (!orph.length) { box.innerHTML = ''; return; }
    const by = {};
    orph.forEach(e => { (by[e.ID_Osoby] ||= new Set()).add(e.Typ_posilku); });
    box.innerHTML = `<div class="warnbox">
      <p>⚠️ W planie są posiłki, których te osoby już nie jedzą (zmienione „Posiłki” w profilu):
        <b>${Object.keys(by).map(o => `${h(osobaName(o))} – ${[...by[o]].map(h).join(', ')}`).join('; ')}</b>.
        Gotowanie i zakupy wciąż je liczą (${orph.length} ${porcje(orph.length, 'porcja')} od dziś).</p>
      <p><button class="btn small" data-orphfix>🧹 Usuń je z planu (od dziś)</button></p>
    </div>`;
  };

  const draw = data => {
    if (!ctx.alive() || !data) return;
    lastData = data;
    rows = sortEntries(data);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const box = root.querySelector('[data-days]');
    drawOrphans();
    if (view === 'tabela') { box.innerHTML = tableView(days); return; }
    if (view === 'osoba') { box.innerHTML = personView(days); return; }
    if (view === 'potrawy') { box.innerHTML = dishView(); return; }
    box.innerHTML = days.map(d => `
      <article class="card day ${d === today() ? 'is-today' : ''}">
        <a class="day-title" href="#/dzis?d=${d}">${h(fmtDay(d, true))}</a>
        <div class="chips day-sess">${sessChips(d)}</div>
        ${mealsShown(rows.filter(r => r.Data === d)).map(typ => {
          const es = rows.filter(r => r.Data === d && r.Typ_posilku === typ);
          const dishes = [...new Set(es.map(e => e.ID_Pot))];
          return `<button class="slot ${es.length ? '' : 'free'}" data-d="${d}" data-typ="${h(typ)}">
            <span class="slot-type">${h(typ)}</span>
            <span class="slot-body">${dishes.length ? dishes.map(id => `
              <span class="slot-dish ${es.filter(e => e.ID_Pot === id).every(e => truthy(e.Zjedzone)) ? 'done' : ''}">${h(potName(id))}</span>
              <span class="slot-people">${es.filter(e => e.ID_Pot === id).map(e => `${h(osobaName(e.ID_Osoby))}${PLACE_ICON[e.Miejsce] ? ' ' + PLACE_ICON[e.Miejsce] : ''} ${fmtNum(gramsOf(e))} g${offProfile(e) ? ' <span class="warn-text" title="Tej osoby nie ma już w tym posiłku (profil)">⚠️ spoza profilu</span>' : ''}`).join(' · ')}</span>`).join('')
              : '<span class="muted">+ dodaj</span>'}
              ${awayFor(d, typ).length ? `<span class="slot-people">🏫 ${awayFor(d, typ).map(a => h(osobaName(a.id))).join(', ')}</span>` : ''}</span>
          </button>`;
        }).join('')}
      </article>`).join('');
  };

  const short = n => n.length > 28 ? n.slice(0, 26) + '…' : n;
  const tableView = days => `<div class="wtable-wrap"><table class="wtable">
      <tr><th></th>${days.map(d => `<th class="${d === today() ? 'is-today' : ''}"><a href="#/dzis?d=${d}">${h(fmtDay(d))}</a></th>`).join('')}</tr>
      ${mealsShown(rows).map(typ => `<tr><th>${h(typ)}</th>${days.map(d => {
        const es = rows.filter(r => r.Data === d && r.Typ_posilku === typ);
        const ids = [...new Set(es.map(e => e.ID_Pot))];
        return `<td class="slot-cell" data-d="${d}" data-typ="${h(typ)}">${ids.map(id => `<div>${h(short(potName(id)))}<span class="muted">${es.filter(e => e.ID_Pot === id).map(e => ' ' + h(osobaName(e.ID_Osoby)).slice(0, 1)).join('')}</span></div>`).join('') || '<span class="muted">+</span>'}</td>`;
      }).join('')}</tr>`).join('')}
    </table></div><p class="small muted">Litery = osoby. Przewiń w bok. Kliknij komórkę, by zmienić.</p>`;
  const personView = days => days.map(d => {
    const es = rows.filter(r => r.Data === d && r.ID_Osoby === person);
    const kcal = es.reduce((a, e) => a + (S.idx.sum[e.ID_Pot] ? Number(S.idx.sum[e.ID_Pot].kcal) * (Number(e.Mnoznik) || 0) : 0), 0);
    return `<article class="card day ${d === today() ? 'is-today' : ''}"><div class="row-between"><a class="day-title" href="#/dzis?d=${d}">${h(fmtDay(d, true))}</a><span class="small muted">${fmtNum(kcal)} kcal</span></div>
      ${es.map(e => `<div class="slot"><span class="slot-type">${h(e.Typ_posilku)}</span><span class="slot-body"><span class="slot-dish">${h(potName(e.ID_Pot))}${PLACE_ICON[e.Miejsce] ? ' ' + PLACE_ICON[e.Miejsce] : ''}</span><span class="slot-people">${fmtNum(gramsOf(e))} g</span></span></div>`).join('') || '<p class="muted small">brak posiłków w domu</p>'}</article>`;
  }).join('');
  const dishView = () => {
    const by = {};
    rows.forEach(e => { (by[e.ID_Pot] ||= []).push(e); });
    return Object.keys(by).sort((a, b) => by[b].length - by[a].length).map(id => {
      const es = by[id];
      const dni = [...new Set(es.map(e => e.Data))];
      return `<article class="card"><div class="row-between"><a href="#/przepis?id=${encodeURIComponent(id)}&back=1"><b>${h(potName(id))}</b></a><span class="chip">${es.length} porcji</span></div>
        <p class="small muted">${dni.map(d => h(fmtDay(d))).join(' · ')} · ${[...new Set(es.map(e => osobaName(e.ID_Osoby)))].map(h).join(', ')} · ${fmtNum(es.reduce((a, e) => a + gramsOf(e), 0))} g łącznie</p></article>`;
    }).join('') || '<div class="empty"><p>Brak zaplanowanych posiłków.</p></div>';
  };

  const reload = async () => {
    const calP = live(`scal:${from}`, 'sessionCalendar', { from, to }, c => { cal = c; draw(lastData); }).catch(() => null);
    await live(`plan:${from}:${to}`, 'plan', { from, to }, draw);
    await calP;
  };

  root.onclick = async ev => {
    const vb = ev.target.closest('[data-view]');
    if (vb) { localStorage.setItem('planer.weekView', vb.dataset.view); ctx.refresh(); return; }
    const pb = ev.target.closest('[data-person]');
    if (pb) { localStorage.setItem('planer.weekPerson', pb.dataset.person); ctx.refresh(); return; }
    const slot = ev.target.closest('.slot[data-d], .slot-cell');
    if (slot) {
      const { d, typ } = slot.dataset;
      const filled = rows.some(r => r.Data === d && r.Typ_posilku === typ);
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

    if (ev.target.closest('[data-autofill]')) { openAutofill(); return; }

    if (ev.target.closest('[data-templates]')) openTemplates();
    const of = ev.target.closest('[data-orphfix]');
    if (of) {
      await busy(of, async () => {
        const r = await call('removeOrphans', { from: today() });
        toast(`Usunięto ${r.usunieto} ${porcje(r.usunieto, 'porcję')} spoza profilu`, 'ok');
        await reload();
      });
    }
  };

  /** „Uzupełnij puste” z parametrami: zakres dni, posiłki, ile różnych dań w sesji, nadpisywanie. */
  function openAutofill() {
    const t = today();
    const start = t > from && t <= to ? t : from; // w bieżącym tygodniu – od dziś, bez dni, które minęły
    const u = S.boot.sesjeUst || { warianty: 2 };
    const meals = mealsInUse();
    const s = sheet('Uzupełnij plan', `
      <form class="form" data-af>
        <div class="grid2">
          <label>Od<input class="input" type="date" name="od" value="${start}" required></label>
          <label>Do<input class="input" type="date" name="do" value="${to}" required></label>
        </div>
        <fieldset><legend>Posiłki</legend>${meals.map(m => `<label class="check"><input type="checkbox" name="typ" value="${h(m)}" checked> ${h(m)}</label>`).join(' ')}</fieldset>
        <label>Różnych dań na ten sam posiłek w sesji
          <select class="input" name="warianty">${[1, 2, 3].map(v => `<option value="${v}" ${Number(u.warianty) === v ? 'selected' : ''}>${v}${v === 1 ? ' – to samo przez całą sesję' : v === 2 ? ' – na zmianę A, B' : ''}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="nadpisz"> Zastąp też zaplanowane posiłki w tym zakresie</label>
        <p class="small muted">Dania dobierane są pod sesje gotowania${cal && cal.sesje.length ? ` (${cal.sesje.map(x => `${h(shortDay(x.data))} → ${h(coverText(x.dni))}`).join(', ')})` : ''}: w jednej sesji ten sam posiłek ma najwyżej tyle różnych dań, ile wybierzesz. Uwzględnia profile, miejsca (lunchbox) i oceny.</p>
        <button class="btn">Uzupełnij</button>
      </form>`);
    s.el.querySelector('[data-af]').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target.elements;
      const typy = [...e.target.querySelectorAll('[name=typ]:checked')].map(x => x.value);
      if (!typy.length) { toast('Zaznacz przynajmniej jeden posiłek', 'error'); return; }
      if (f.do.value < f.od.value) { toast('Koniec zakresu jest przed początkiem', 'error'); return; }
      if (f.nadpisz.checked && !confirm(`Zastąpić zaplanowane posiłki (${typy.join(', ')}) od ${fmtDay(f.od.value)} do ${fmtDay(f.do.value)}?`)) return;
      await busy(e.target.querySelector('button'), async () => {
        const created = await call('autoFill', { from: f.od.value, to: f.do.value, typy, warianty: Number(f.warianty.value), nadpisz: f.nadpisz.checked });
        toast(created.length ? `Dodano ${created.length} wpisów` : 'Wszystkie posiłki w tym zakresie są już zaplanowane');
        s.close();
        await reload();
      });
    });
  }

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
