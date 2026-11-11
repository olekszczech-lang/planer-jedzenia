// Dziś: posiłki dnia per osoba, odhaczanie „zjedzone”, wpisy spoza planu (jak w Fitatu),
// niezjedzone porcje z pomysłem na ich uratowanie, bilans kcal.
import { live, call, enqueue, patchCache, readCache, writeCache } from '../api.js';
import { S, potName, osobaName, multOf, macros, gramsOf, celDnia, sortEntries, mealsInUse, mealsOf, placeOf, awayFor, PLACE_ICON, PLACE_LABEL, activeDishes, mealsShown } from '../state.js';
import { pickDish, chooseAction, busy, toast, sheet } from '../ui.js';
import { h, today, addDays, fmtDay, fmtNum, truthy, isKey, num, norm } from '../util.js';

/** Podpowiedź kucharza: co zrobić z niezjedzoną porcją. */
function rescueTip(idPot) {
  const p = S.idx.pot[idPot] || {};
  const zam = num(p.Zamrazarka_tyg) > 0;
  if (p.Kategoria === 'Smoothie') return 'Paczka smoothie wraca do zamrażarki – nic się nie dzieje.';
  if (p.Kategoria === 'Zupa') return 'Zupę najlepiej zamrozić (porcja na szybki obiad) albo zjeść jutro w lunchboxie.';
  if (p.Kategoria === 'Sałatka') return 'Sałatki nie mroź. Zjedz jutro (sos osobno) albo zawiń w tortillę jako wrap.';
  if (p.Kategoria === 'Śniadanie') return 'Owsiankę i placki zjedz jutro. Jajek nie odgrzewaj – wrzuć je do tortilli z warzywami.';
  return zam ? 'Jutro do lunchboxa albo zamroź – to danie dobrze znosi mrożenie (zjedz w ciągu 2–3 mies.).'
    : 'Zjedz jutro (lodówka max 1 dzień więcej) – tego dania nie mroź.';
}

export async function render(root, q, ctx) {
  const d = isKey(q.d) ? q.d : today();
  const cacheKey = `plan:${d}:${d}`;
  const logKey = `log:${d}`;
  let rows = [];
  let log = (await readCache(logKey)) || [];

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
    <div class="toolbar"><button class="btn ghost small" data-custom>+ Zjedzone spoza planu</button></div>
    <section data-custom-list></section>
    <section data-meals><div class="loading">Ładowanie planu…</div></section>`;

  const customs = () => log.filter(r => !r.ID_Planu);

  const draw = data => {
    if (!ctx.alive()) return;
    rows = sortEntries(data);
    drawAll();
  };
  const drawAll = () => { drawSummary(); drawCustom(); drawMeals(); };

  function drawSummary() {
    const people = [...new Set([...S.idx.aktywne, ...rows.map(r => r.ID_Osoby)])];
    root.querySelector('[data-summary]').innerHTML = `<div class="summary">${people.map(id => {
      const mine = rows.filter(r => r.ID_Osoby === id && !truthy(r.Pominiete));
      const plan = mine.reduce((s, e) => s + macros(e.ID_Pot, multOf(e)).kcal, 0);
      const eatenM = mine.filter(e => truthy(e.Zjedzone)).map(e => macros(e.ID_Pot, multOf(e)))
        .concat(customs().filter(c => c.ID_Osoby === id).map(c => ({ kcal: num(c.kcal), B: num(c.B), T: num(c.T), W: num(c.W) })));
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
        <div class="bar ${eaten > homeGoal * 1.1 ? 'over' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <div class="small muted">B ${sum('B')} g · T ${sum('T')} g · W ${sum('W')} g · zaplanowane ${fmtNum(plan)} kcal</div>
        ${awayMeals.length ? `<div class="small muted">🏫 + ok. ${fmtNum(awayKcal)} kcal poza domem (${awayMeals.map(h).join(', ')})</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function drawCustom() {
    const list = customs();
    root.querySelector('[data-custom-list]').innerHTML = !list.length ? '' : `<article class="card">
      <h3 class="meal-h">Spoza planu</h3>
      ${list.map(c => `<div class="portion">
        <span></span><span class="who">${h(osobaName(c.ID_Osoby))}: ${h(c.Uwagi || potName(c.ID_Pot) || 'wpis')}</span>
        <span class="grams">${c.Gramy ? fmtNum(c.Gramy) + ' g' : ''}</span>
        <span class="kcal">${fmtNum(c.kcal)} kcal <button class="iconbtn small" data-uncustom="${h(c.ID_Wpisu)}" aria-label="Usuń">✕</button></span>
      </div>`).join('')}</article>`;
  }

  function drawMeals() {
    root.querySelector('[data-meals]').innerHTML = mealsShown(rows).map(typ => {
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
            <a class="dish-name" href="#/przepis?id=${encodeURIComponent(idPot)}&back=1">${h(potName(idPot))}</a>
            ${entries.filter(e => e.ID_Pot === idPot).map(e => {
              const done = truthy(e.Zjedzone);
              const skipped = truthy(e.Pominiete);
              return `<div class="portion-row">
                <label class="portion ${done || skipped ? 'done' : ''}">
                  <input type="checkbox" data-eat="${h(e.ID_Wpisu)}" ${done ? 'checked' : ''} ${skipped ? 'disabled' : ''}>
                  <span class="who">${h(osobaName(e.ID_Osoby))}${PLACE_ICON[e.Miejsce] ? ` <span class="place" title="${h(PLACE_LABEL[e.Miejsce])}">${PLACE_ICON[e.Miejsce]}</span>` : ''}
                    ${skipped ? `<br><span class="small warn-text">niezjedzone: ${h(e.Uwagi || '')}</span>` : (e.Uwagi ? `<br><span class="small muted">${h(e.Uwagi)}</span>` : '')}</span>
                  <span class="grams">${fmtNum(gramsOf(e))} g</span>
                  <span class="kcal">${fmtNum(macros(e.ID_Pot, multOf(e)).kcal)} kcal</span>
                </label>
                <button class="iconbtn small" data-more="${h(e.ID_Wpisu)}" aria-label="Nie zjedzone / opcje">⋯</button>
              </div>`;
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
    if (ev.target.closest('[data-custom]')) { addCustom(); return; }
    const unc = ev.target.closest('[data-uncustom]');
    if (unc) {
      log = log.filter(r => r.ID_Wpisu !== unc.dataset.uncustom);
      await writeCache(logKey, log);
      drawAll();
      enqueue('unlogCustom', { id: unc.dataset.uncustom });
      return;
    }
    const more = ev.target.closest('[data-more]');
    if (more) { skipMenu(rows.find(r => r.ID_Wpisu === more.dataset.more)); return; }
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

  async function skipMenu(e) {
    if (!e) return;
    if (truthy(e.Pominiete)) {
      const act = await chooseAction('Niezjedzone: ' + (e.Uwagi || ''), [{ id: 'undo', label: 'Cofnij (jednak zjedzone / do zjedzenia)' }]);
      if (act === 'undo') { await call('unskipEntry', { id: e.ID_Wpisu }); ctx.refresh(); }
      return;
    }
    const others = S.idx.aktywne.filter(id => id !== e.ID_Osoby);
    const s = sheet(`Nie zjedzone: ${potName(e.ID_Pot)}`, `
      <p class="small">👨‍🍳 ${h(rescueTip(e.ID_Pot))}</p>
      <div class="actions-list">
        <button class="btn" data-sk="jutro">➡️ Przenieś na jutro (${h(e.Typ_posilku)})</button>
        <button class="btn ghost" data-sk="lunchbox">📦 Jutro do lunchboxa (obiad)</button>
        <button class="btn ghost" data-sk="zamroz">❄️ Zamroź (rejestr zamrażarki)</button>
        ${others.map(o => `<button class="btn ghost" data-sk="osoba" data-os="${h(o)}">🙋 Zje ${h(osobaName(o))}</button>`).join('')}
        <button class="btn ghost danger" data-sk="wyrzucone">🗑 Wyrzucone</button>
      </div>`);
    s.el.addEventListener('click', async ev2 => {
      const b = ev2.target.closest('[data-sk]');
      if (!b) return;
      await busy(b, async () => {
        await call('skipEntry', { id: e.ID_Wpisu, akcja: b.dataset.sk, osoba: b.dataset.os });
        s.close();
        toast('Zapisane – porcja się nie zmarnuje', 'ok');
        ctx.refresh();
      });
    });
  }

  function addCustom() {
    const people = S.idx.aktywne;
    const s = sheet('Zjedzone spoza planu', `
      <form class="form" data-cf>
        <label>Kto<select class="input" name="os">${people.map(o => `<option value="${h(o)}">${h(osobaName(o))}</option>`).join('')}</select></label>
        <label>Rodzaj<select class="input" name="kind"><option value="skl">Produkt (z bazy)</option><option value="pot">Danie z przepisów</option><option value="own">Własne (wpisz kcal)</option></select></label>
        <div data-k="skl"><label>Produkt<input class="input" name="skl" list="cf-skl" autocomplete="off" placeholder="np. Banan, Jogurt grecki"></label>
          <datalist id="cf-skl">${Object.values(S.idx.skl).map(x => `<option value="${h(x.Nazwa)}">`).join('')}</datalist></div>
        <div data-k="pot" hidden><label>Danie<select class="input" name="pot">${activeDishes(null).map(p => `<option value="${h(p.ID_Pot)}">${h(p.Nazwa)}</option>`).join('')}</select></label></div>
        <div data-k="own" hidden><label>Nazwa<input class="input" name="nm" placeholder="np. pizza na mieście"></label>
          <div class="grid4"><label>kcal<input class="input" name="kc" type="number"></label><label>B<input class="input" name="B" type="number" step="any"></label>
          <label>T<input class="input" name="T" type="number" step="any"></label><label>W<input class="input" name="W" type="number" step="any"></label></div></div>
        <label data-grams>Ilość (g)<input class="input" name="g" type="number" step="any" min="1" value="100"></label>
        <p class="small muted" data-preview></p>
        <button class="btn">Dodaj</button>
      </form>`);
    const f = s.el.querySelector('[data-cf]');
    const E = f.elements;
    const calc = () => {
      const g = num(E.g.value);
      if (E.kind.value === 'skl') {
        const x = Object.values(S.idx.skl).find(y => norm(y.Nazwa) === norm(E.skl.value));
        return x ? { kcal: num(x.kcal_100g) * g / 100, B: num(x.B_100g) * g / 100, T: num(x.T_100g) * g / 100, W: num(x.W_100g) * g / 100, nazwa: x.Nazwa, gramy: g } : null;
      }
      if (E.kind.value === 'pot') {
        const sm = S.idx.sum[E.pot.value] || {};
        const w = num(sm.Waga_po_obrobce) || 1;
        return { kcal: num(sm.kcal) * g / w, B: num(sm.B) * g / w, T: num(sm.T) * g / w, W: num(sm.W) * g / w, nazwa: potName(E.pot.value), idPot: E.pot.value, gramy: g };
      }
      return E.nm.value.trim() && num(E.kc.value) ? { kcal: num(E.kc.value), B: num(E.B.value), T: num(E.T.value), W: num(E.W.value), nazwa: E.nm.value.trim(), gramy: '' } : null;
    };
    const preview = () => {
      ['skl', 'pot', 'own'].forEach(k => { f.querySelector(`[data-k=${k}]`).hidden = E.kind.value !== k; });
      f.querySelector('[data-grams]').hidden = E.kind.value === 'own';
      const c = calc();
      f.querySelector('[data-preview]').textContent = c ? `${fmtNum(c.kcal)} kcal · B ${fmtNum(c.B, 1)} · T ${fmtNum(c.T, 1)} · W ${fmtNum(c.W, 1)}` : '';
    };
    f.addEventListener('input', preview);
    f.addEventListener('change', preview);
    preview();
    let sent = false;
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (sent) return;
      const c = calc();
      if (!c) { toast('Uzupełnij produkt i ilość', 'error'); return; }
      sent = true;
      const row = { ID_Wpisu: 'D' + Math.random().toString(16).slice(2, 10), Data: d, ID_Osoby: E.os.value, ID_Pot: c.idPot || '',
        Gramy: c.gramy, kcal: Math.round(c.kcal), B: Math.round(c.B * 10) / 10, T: Math.round(c.T * 10) / 10, W: Math.round(c.W * 10) / 10, Uwagi: c.nazwa, ID_Planu: '' };
      log.push(row);
      await writeCache(logKey, log);
      s.close();
      drawAll();
      enqueue('logCustom', { id: row.ID_Wpisu, data: d, idOsoby: row.ID_Osoby, idPot: row.ID_Pot, gramy: row.Gramy, kcal: row.kcal, B: row.B, T: row.T, W: row.W, uwagi: row.Uwagi });
    });
  }

  live(logKey, 'dayLog', { data: d }, l => { if (!ctx.alive()) return; log = l; if (rows.length) drawAll(); }).catch(() => {});
  await live(cacheKey, 'plan', { from: d, to: d }, draw);
}
