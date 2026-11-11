// Edytor przepisu: nowy, edycja albo sprawdzenie importu ze strony (szkic → zatwierdzenie do biblioteki).
// Składniki w sekcjach („podprzepisy”: Główne, Sos tzatziki, Dressing…), etapy z etapem/sprzętem/czasem i składnikami kroku.
import { S, ensureBoot } from '../state.js';
import { call } from '../api.js';
import { busy, toast, sheet } from '../ui.js';
import { h, num, truthy } from '../util.js';

const ETAPY = ['przygotowanie', 'marynowanie', 'gotowanie', 'duszenie', 'smażenie', 'pieczenie', 'blendowanie', 'składanie', 'chłodzenie', 'porcjowanie'];
const SPRZET = ['brak', 'garnek', 'patelnia', 'piekarnik', 'blender', 'mikrofala'];
const KATEGORIE = ['Śniadanie', 'Zupa', 'Danie główne', 'Sałatka', 'Przekąska', 'Smoothie', 'Baza'];
const TRYBY = ['lodówka', 'mrożenie', 'na świeżo', 'hybryda'];
const SKL_KAT = ['Owoce i warzywa', 'Mięso i ryby', 'Nabiał', 'Produkty sypkie', 'Pieczywo', 'Tłuszcze', 'Przetwory warzywno-owocowe', 'Przyprawy', 'Sosy', 'Inne'];
const SEKCJE = ['Główne', 'Sos', 'Dressing', 'Marynata', 'Do podania', 'Paczka do zamrażarki', 'Rano dodaj', 'Dodatek: ryż', 'Dodatek: kasza gryczana', 'Dodatek: pęczak', 'Dodatek: makaron', 'Dodatek: ziemniaki'];

const opt = (list, cur) => list.map(x => `<option ${x === cur ? 'selected' : ''}>${h(x)}</option>`).join('');

function fromLibrary(id) {
  const p = S.idx.pot[id];
  if (!p) return null;
  return {
    potrawa: { ...p },
    typy: S.idx.typyByPot[id] || [],
    skladniki: (S.idx.rec[id] || []).map(r => ({ ...r, nazwa: (S.idx.skl[r.ID_Skl] || {}).Nazwa || '' })),
    kroki: (S.idx.kroki[id] || []).map(k => ({ ...k }))
  };
}

/** Grupy w kolejności pierwszego wystąpienia; „Główne” zawsze pierwsze. */
function groupRows(rows) {
  const order = [];
  const by = {};
  rows.forEach(r => {
    const g = r.Sekcja || 'Główne';
    if (!by[g]) { by[g] = []; order.push(g); }
    by[g].push(r);
  });
  if (!order.length) { order.push('Główne'); by['Główne'] = [{}]; }
  order.sort((a, b) => (b === 'Główne') - (a === 'Główne'));
  return order.map(g => ({ name: g, rows: by[g] }));
}

export async function render(root, q, ctx) {
  let model;
  if (q.draft) {
    try { model = JSON.parse(sessionStorage.getItem('planer.draft') || 'null'); } catch { model = null; }
    if (model) model.skladniki.forEach(r => { r.nazwa = r.ID_Skl ? (S.idx.skl[r.ID_Skl] || {}).Nazwa : r.nazwa; });
  } else if (q.id) {
    model = fromLibrary(q.id);
  }
  model ||= { potrawa: { Status: 'szkic', Porcje_bazowe: 2, Tryb: 'lodówka', Lodowka_dni: 3, Zamrazarka_tyg: 0, Aktywna: true }, typy: [], skladniki: [{}], kroki: [{}] };
  const p = model.potrawa;
  const isImport = !!q.draft;
  const sklNames = Object.values(S.idx.skl).map(s => s.Nazwa).sort((a, b) => a.localeCompare(b, 'pl'));
  const sklByName = Object.fromEntries(Object.values(S.idx.skl).map(s => [s.Nazwa.toLowerCase(), s]));
  document.getElementById('title').textContent = q.id ? 'Edycja przepisu' : (isImport ? 'Import – sprawdź' : 'Nowy przepis');

  const ingRow = (r = {}) => {
    const known = r.nazwa && sklByName[String(r.nazwa).toLowerCase()];
    return `<div class="ed-row ing-row">
      ${r.tekst ? `<p class="small muted span-all">ze strony: „${h(r.tekst)}”${(r.kandydaci || []).length ? '<br>' + r.kandydaci.map(c => `<button type="button" class="chip ${c.Nazwa === r.nazwa ? 'on' : ''}" data-pick="${h(c.Nazwa)}">${h(c.Nazwa)}</button>`).join(' ') : ''}</p>` : ''}
      <input class="input" name="nazwa" list="skl-list" placeholder="Składnik" value="${h(r.nazwa || '')}">
      <input class="input num" name="ilosc" type="number" step="any" inputmode="decimal" placeholder="ilość" value="${h(r.Ilosc ?? '')}">
      <select class="input" name="jedn">${opt(['g', 'szt'], r.Jednostka || 'g')}</select>
      <input class="input wide" name="prep" placeholder="Przygotowanie (np. kostka 1 cm)" value="${h(r.Przygotowanie || '')}">
      <span class="row-btns"><button type="button" class="iconbtn small" data-up aria-label="Wyżej">↑</button><button type="button" class="iconbtn small" data-down aria-label="Niżej">↓</button><button type="button" class="iconbtn small" data-del aria-label="Usuń">🗑</button></span>
      <div class="new-ing span-all" ${known || !r.nazwa ? 'hidden' : ''}>
        <span class="small warn-text">Nowy składnik – podaj wartości na 100 g:</span>
        <select class="input" name="kat">${opt(SKL_KAT, 'Inne')}</select>
        <input class="input num" name="kcal" type="number" step="any" placeholder="kcal">
        <input class="input num" name="B" type="number" step="any" placeholder="B">
        <input class="input num" name="T" type="number" step="any" placeholder="T">
        <input class="input num" name="W" type="number" step="any" placeholder="W">
      </div>
    </div>`;
  };
  const groupHtml = (g) => `<section class="ing-group" data-group>
      <div class="ing-group-head">
        <input class="input sec-name" name="grupa" list="sek-list" value="${h(g.name)}" aria-label="Nazwa sekcji" placeholder="Nazwa sekcji, np. Sos tzatziki">
        <button type="button" class="iconbtn small" data-del-group aria-label="Usuń sekcję">🗑</button>
      </div>
      <div data-ings>${g.rows.map(ingRow).join('')}</div>
      <div class="toolbar">
        <button type="button" class="btn ghost small" data-add-ing>+ składnik</button>
        <button type="button" class="btn ghost small" data-paste>📋 Wklej listę</button>
      </div>
    </section>`;
  const stepRow = (k = {}) => `<div class="ed-row step-row">
      <select class="input" name="etap">${opt(ETAPY, k.Etap || 'gotowanie')}</select>
      <select class="input" name="sprzet">${opt(SPRZET, k.Sprzet || 'brak')}</select>
      <input class="input num" name="temp" type="number" placeholder="°C" value="${h(k.Temp_C ?? '')}">
      <input class="input num" name="czas" type="number" placeholder="min" value="${h(k.Czas_min ?? '')}">
      <input class="input num" name="akt" type="number" placeholder="aktywnie" value="${h(k.Aktywny_min ?? '')}">
      <select class="input" name="kiedy">${opt(['sesja', 'świeżo'], k.Kiedy || 'sesja')}</select>
      <input class="input num" name="dziecko" type="number" placeholder="👧 od lat" value="${h(k.Dziecko ?? '')}">
      <textarea class="input span-all" name="opis" rows="2" placeholder="Co zrobić (konkretnie: ile, jak długo, po czym poznać, że gotowe)">${h(k.Opis || '')}</textarea>
      <input type="hidden" name="skl" value="${h(k.Skladniki || '')}">
      <div class="span-all step-skl"><span class="small muted">Składniki kroku (ilości pokażą się w trybie gotowania):</span><div class="chips" data-stepchips></div></div>
      <div class="span-all row-between"><span class="small muted">przesuń</span><span>
        <button type="button" class="iconbtn small" data-up>↑</button><button type="button" class="iconbtn small" data-down>↓</button>
        <button type="button" class="iconbtn small" data-del>🗑</button></span></div>
    </div>`;

  const groups = groupRows(model.skladniki);
  const nNew = model.skladniki.filter(r => r.nazwa && !sklByName[String(r.nazwa).toLowerCase()]).length;
  root.innerHTML = `
    <datalist id="skl-list">${sklNames.map(n => `<option value="${h(n)}">`).join('')}</datalist>
    <datalist id="sek-list">${SEKCJE.map(n => `<option value="${h(n)}">`).join('')}</datalist>
    ${isImport ? `<div class="warnbox"><p><b>Import (${h(model.zrodlo || '')})</b>: ${model.skladniki.length} składników w ${groups.length} ${groups.length === 1 ? 'sekcji' : 'sekcjach'}, ${model.kroki.length} kroków.
      ${nNew ? `<b>${nNew}</b> bez dopasowania w bazie (żółte) – wybierz podpowiedź albo podaj kcal.` : 'Wszystkie składniki dopasowane do bazy.'}
      Sprawdź ilości i etapy, potem „Zapisz i zatwierdź”.</p></div>` : ''}
    <form class="card form grid2" data-ed>
      <label class="span2">Nazwa<input class="input" name="Nazwa" required value="${h(p.Nazwa || '')}"></label>
      <label>Porcje bazowe<input class="input" name="Porcje_bazowe" type="number" min="1" value="${h(p.Porcje_bazowe || 2)}"></label>
      <label>Czas (min)<input class="input" name="Czas_min" type="number" value="${h(p.Czas_min || '')}"></label>
      <label>Kategoria<select class="input" name="Kategoria">${opt(KATEGORIE, p.Kategoria || 'Danie główne')}</select></label>
      <label>Tryb<select class="input" name="Tryb">${opt(TRYBY, p.Tryb || 'lodówka')}</select></label>
      <label>Lodówka (dni)<input class="input" name="Lodowka_dni" type="number" value="${h(p.Lodowka_dni ?? 3)}"></label>
      <label>Zamrażarka (tyg., 0 = nie)<input class="input" name="Zamrazarka_tyg" type="number" value="${h(p.Zamrazarka_tyg ?? 0)}"></label>
      <label class="span2">Tagi (po przecinku)<input class="input" name="Tagi" value="${h(p.Tagi || '')}" placeholder="niski IG, wysokobiałkowe, dla dzieci, lunchbox…"></label>
      <label>Dodaj po odgrzaniu<input class="input" name="Dodaj_po" value="${h(p.Dodaj_po || '')}"></label>
      <label>Pakuj osobno<input class="input" name="Pakuj_osobno" value="${h(p.Pakuj_osobno || '')}"></label>
      <label class="span2">Opis<textarea class="input" name="Opis" rows="2">${h(p.Opis || '')}</textarea></label>
      <label class="span2">Link do źródła<input class="input" name="Link" type="url" value="${h(p.Link || '')}"></label>
      <fieldset class="span2"><legend>Posiłki</legend>${S.meals.map(m => `<label class="check"><input type="checkbox" name="typ" value="${h(m)}" ${model.typy.includes(m) ? 'checked' : ''}> ${h(m)}</label>`).join(' ')}
        <label class="check"><input type="checkbox" name="Dla_dzieci" ${truthy(p.Dla_dzieci) ? 'checked' : ''}> dla dzieci</label></fieldset>

      <h3 class="span2">Składniki</h3>
      <p class="small muted span2">Sekcja = część przepisu z własnymi składnikami (np. <b>Sos tzatziki</b>, Dressing, Marynata). Krojenie wpisz w „Przygotowanie” – trafi do wspólnego krojenia w sesji.</p>
      <div class="span2" data-groups>${groups.map(groupHtml).join('')}</div>
      <div class="span2"><button type="button" class="btn ghost small" data-add-group>+ sekcja (sos, dressing, marynata…)</button></div>

      <h3 class="span2">Etapy</h3>
      <p class="small muted span2">Kolejność jak przy gotowaniu. Krojenia nie opisuj w krokach (jest w „Przygotowanie” składników). Etapy „w sesji” trafiają do planu niedziela/środa, „świeżo” – w dzień jedzenia.</p>
      <div class="span2" data-steps>${model.kroki.map(stepRow).join('')}</div>
      <div class="span2"><button type="button" class="btn ghost small" data-add-step>+ etap</button></div>
      ${p.Instrukcja ? `<details class="span2"><summary>Instrukcja ze źródła</summary><p class="instr small">${h(p.Instrukcja)}</p></details>` : ''}

      <label>Status<select class="input" name="Status">${opt(['szkic', 'zatwierdzony'], p.Status || 'szkic')}</select></label>
      <div class="toolbar span2"><button class="btn">💾 Zapisz</button><button type="button" class="btn ghost" data-approve>✅ Zapisz i zatwierdź</button></div>
    </form>`;

  const form = root.querySelector('[data-ed]');
  const checkNew = row => {
    const name = row.querySelector('[name=nazwa]').value.trim().toLowerCase();
    row.querySelector('.new-ing').hidden = !name || !!sklByName[name];
  };
  /** Nazwy składników z formularza (bez powtórzeń) – do wyboru przy krokach. */
  const ingNames = () => [...new Set([...root.querySelectorAll('.ing-row [name=nazwa]')].map(i => i.value.trim()).filter(Boolean))];
  const refreshChips = () => {
    const names = ingNames();
    root.querySelectorAll('.step-row').forEach(row => {
      const sel = row.querySelector('[name=skl]').value.split('|').map(s => s.trim()).filter(Boolean);
      const all = [...names, ...sel.filter(s => !names.includes(s))];
      row.querySelector('[data-stepchips]').innerHTML = all.map(n =>
        `<button type="button" class="chip ${sel.includes(n) ? 'on' : ''} ${names.includes(n) ? '' : 'warn'}" data-stepskl="${h(n)}">${h(n)}</button>`).join('') || '<span class="small muted">najpierw dodaj składniki</span>';
    });
  };
  refreshChips();

  const addGroup = name => {
    root.querySelector('[data-groups]').insertAdjacentHTML('beforeend', groupHtml({ name, rows: [{}] }));
    return root.querySelector('[data-groups]').lastElementChild;
  };
  const groupByName = name => [...root.querySelectorAll('[data-group]')].find(g => g.querySelector('[name=grupa]').value.trim().toLowerCase() === name.toLowerCase());

  /** Wklejona lista → wiersze (dopasowane do bazy przez API); linie „Sos:” tworzą nowe sekcje. */
  const pasteInto = group => {
    const s = sheet('Wklej listę składników', `
      <form class="form" data-pf>
        <textarea class="input" name="t" rows="9" required placeholder="200 g fety&#10;2 ogórki gruntowe&#10;1 łyżka oliwy&#10;&#10;Sos tzatziki:&#10;180 g jogurtu greckiego&#10;2 ząbki czosnku"></textarea>
        <p class="small muted">Każdy składnik w osobnej linii. Linia zakończona dwukropkiem (np. „Sos:”) zaczyna nową sekcję. Ilości przeliczę na gramy i dopasuję do bazy.</p>
        <button class="btn">Dodaj</button>
      </form>`);
    s.el.querySelector('[data-pf]').addEventListener('submit', async e => {
      e.preventDefault();
      await busy(e.target.querySelector('button'), async () => {
        const d = await call('importRecipe', { text: e.target.elements.t.value, nazwa: '-' });
        d.skladniki.forEach(r => {
          const target = r.Sekcja && r.Sekcja !== 'Główne' ? (groupByName(r.Sekcja) || addGroup(r.Sekcja)) : group;
          const list = target.querySelector('[data-ings]');
          // pusty wiersz-zaślepka zastępujemy
          list.querySelectorAll('.ing-row').forEach(row => { if (!row.querySelector('[name=nazwa]').value.trim() && !row.querySelector('[name=ilosc]').value) row.remove(); });
          list.insertAdjacentHTML('beforeend', ingRow({ ...r, nazwa: r.ID_Skl ? (S.idx.skl[r.ID_Skl] || {}).Nazwa : r.nazwa }));
        });
        refreshChips();
        s.close();
        const nowe = d.skladniki.filter(r => !r.ID_Skl).length;
        toast(`Dodano ${d.skladniki.length} składników${nowe ? ` (${nowe} nowych – podaj kcal)` : ''}`, 'ok');
      });
    });
    setTimeout(() => s.el.querySelector('textarea').focus(), 60);
  };

  root.oninput = ev => {
    const row = ev.target.closest('.ing-row');
    if (row && ev.target.name === 'nazwa') checkNew(row);
  };
  root.onchange = ev => { if (ev.target.name === 'nazwa') refreshChips(); };
  root.onclick = ev => {
    const pick = ev.target.closest('[data-pick]');
    if (pick) {
      const row = pick.closest('.ing-row');
      row.querySelector('[name=nazwa]').value = pick.dataset.pick;
      row.querySelectorAll('[data-pick]').forEach(b => b.classList.toggle('on', b === pick));
      checkNew(row); refreshChips(); return;
    }
    const sk = ev.target.closest('[data-stepskl]');
    if (sk) {
      const inp = sk.closest('.step-row').querySelector('[name=skl]');
      const sel = inp.value.split('|').map(s => s.trim()).filter(Boolean);
      const n = sk.dataset.stepskl;
      inp.value = (sel.includes(n) ? sel.filter(x => x !== n) : [...sel, n]).join('|');
      refreshChips(); return;
    }
    if (ev.target.closest('[data-add-ing]')) {
      ev.target.closest('[data-group]').querySelector('[data-ings]').insertAdjacentHTML('beforeend', ingRow({}));
      ev.target.closest('[data-group]').querySelector('.ing-row:last-child [name=nazwa]').focus();
      return;
    }
    if (ev.target.closest('[data-paste]')) { pasteInto(ev.target.closest('[data-group]')); return; }
    if (ev.target.closest('[data-add-group]')) {
      const g = addGroup('');
      g.querySelector('[name=grupa]').focus();
      return;
    }
    const dg = ev.target.closest('[data-del-group]');
    if (dg) {
      const g = dg.closest('[data-group]');
      const filled = [...g.querySelectorAll('.ing-row [name=nazwa]')].filter(i => i.value.trim()).length;
      if (filled && !confirm(`Usunąć sekcję „${g.querySelector('[name=grupa]').value}” razem z ${filled} składnikami?`)) return;
      g.remove();
      if (!root.querySelector('[data-group]')) addGroup('Główne');
      refreshChips(); return;
    }
    if (ev.target.closest('[data-add-step]')) { root.querySelector('[data-steps]').insertAdjacentHTML('beforeend', stepRow({})); refreshChips(); return; }
    const del = ev.target.closest('[data-del]');
    if (del) { del.closest('.ed-row').remove(); refreshChips(); return; }
    const up = ev.target.closest('[data-up]'), down = ev.target.closest('[data-down]');
    if (up || down) {
      const row = (up || down).closest('.ed-row');
      const isIng = row.classList.contains('ing-row');
      if (up && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      else if (down && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      else if (isIng) {
        // na brzegu sekcji → do sąsiedniej sekcji
        const g = row.closest('[data-group]');
        const other = up ? g.previousElementSibling : g.nextElementSibling;
        if (other) { const list = other.querySelector('[data-ings]'); if (up) list.appendChild(row); else list.insertBefore(row, list.firstChild); }
      }
      return;
    }
    if (ev.target.closest('[data-approve]')) { form.elements.Status.value = 'zatwierdzony'; form.requestSubmit(); }
  };

  root.onsubmit = async ev => {
    ev.preventDefault();
    const e = form.elements;
    const potrawa = {
      ID_Pot: q.id || '', Nazwa: e.Nazwa.value.trim(), Porcje_bazowe: num(e.Porcje_bazowe.value) || 1, Czas_min: num(e.Czas_min.value) || '',
      Kategoria: e.Kategoria.value, Tryb: e.Tryb.value, Lodowka_dni: num(e.Lodowka_dni.value), Zamrazarka_tyg: num(e.Zamrazarka_tyg.value),
      Tagi: e.Tagi.value.trim(), Dodaj_po: e.Dodaj_po.value.trim(), Pakuj_osobno: e.Pakuj_osobno.value.trim(), Opis: e.Opis.value.trim(),
      Link: e.Link.value.trim(), Dla_dzieci: e.Dla_dzieci.checked, Status: e.Status.value, Instrukcja: p.Instrukcja || '', Aktywna: true
    };
    const typy = [...form.querySelectorAll('[name=typ]:checked')].map(x => x.value);
    const skladniki = [];
    root.querySelectorAll('[data-group]').forEach(g => {
      const sekcja = g.querySelector('[name=grupa]').value.trim() || 'Główne';
      g.querySelectorAll('.ing-row').forEach(row => {
        const v = n => row.querySelector(`[name=${n}]`).value.trim();
        const nazwa = v('nazwa');
        if (!nazwa) return;
        const s = sklByName[nazwa.toLowerCase()];
        const base = { Ilosc: num(v('ilosc')), Jednostka: v('jedn'), Sekcja: sekcja, Przygotowanie: v('prep') };
        skladniki.push(s ? { ...base, ID_Skl: s.ID_Skl }
          : { ...base, nowy: { Nazwa: nazwa, Kategoria: v('kat'), kcal_100g: num(v('kcal')), B_100g: num(v('B')), T_100g: num(v('T')), W_100g: num(v('W')) } });
      });
    });
    const kroki = [...root.querySelectorAll('.step-row')].map(row => {
      const v = n => row.querySelector(`[name=${n}]`).value.trim();
      return { Etap: v('etap'), Sprzet: v('sprzet'), Temp_C: v('temp'), Czas_min: v('czas'), Aktywny_min: v('akt'), Kiedy: v('kiedy'),
        Dziecko: v('dziecko'), Opis: v('opis'), Skladniki: v('skl') };
    }).filter(k => k.Opis);
    const noQty = skladniki.filter(x => !(x.Ilosc > 0)).map(x => x.nowy ? x.nowy.Nazwa : (S.idx.skl[x.ID_Skl] || {}).Nazwa);
    if (noQty.length && !confirm('Bez ilości (nie zapiszą się): ' + noQty.join(', ') + '.\nWpisz ilość – np. 2 g soli „do smaku”. Zapisać bez nich?')) return;
    const missing = skladniki.filter(x => x.nowy && !x.nowy.kcal_100g).map(x => x.nowy.Nazwa);
    if (missing.length && !confirm('Nowe składniki bez kcal: ' + missing.join(', ') + '.\nZapisać mimo to (kcal = 0)?')) return;
    await busy(form.querySelector('button'), async () => {
      const r = await call('saveRecipe', { potrawa, typy, skladniki, kroki });
      sessionStorage.removeItem('planer.draft');
      await ensureBoot(true);
      toast(potrawa.Status === 'zatwierdzony' ? 'Przepis zatwierdzony w bibliotece' : 'Zapisano szkic', 'ok');
      ctx.go('#/przepis?id=' + encodeURIComponent(r.ID_Pot));
    });
  };
}
