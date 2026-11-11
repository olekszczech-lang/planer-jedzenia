// Edytor przepisu: nowy, edycja albo sprawdzenie importu ze strony (szkic → zatwierdzenie do biblioteki).
// Struktura jak w bibliotece: składniki z sekcją i sposobem krojenia, etapy z etapem/sprzętem/czasem/składnikami.
import { S, ensureBoot } from '../state.js';
import { call } from '../api.js';
import { busy, toast } from '../ui.js';
import { h, num, truthy } from '../util.js';

const ETAPY = ['przygotowanie', 'marynowanie', 'gotowanie', 'duszenie', 'smażenie', 'pieczenie', 'blendowanie', 'składanie', 'chłodzenie', 'porcjowanie'];
const SPRZET = ['brak', 'garnek', 'patelnia', 'piekarnik', 'blender', 'mikrofala'];
const KATEGORIE = ['Śniadanie', 'Zupa', 'Danie główne', 'Sałatka', 'Przekąska', 'Smoothie', 'Baza'];
const TRYBY = ['lodówka', 'mrożenie', 'na świeżo', 'hybryda'];
const SKL_KAT = ['Owoce i warzywa', 'Mięso i ryby', 'Nabiał', 'Produkty sypkie', 'Pieczywo', 'Tłuszcze', 'Przetwory warzywno-owocowe', 'Przyprawy', 'Sosy', 'Inne'];

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
      ${r.tekst ? `<p class="small muted span-all">ze strony: „${h(r.tekst)}”${(r.kandydaci || []).length ? ' · ' + r.kandydaci.map(c => `<button type="button" class="chip" data-pick="${h(c.Nazwa)}">${h(c.Nazwa)}</button>`).join(' ') : ''}</p>` : ''}
      <input class="input" name="nazwa" list="skl-list" placeholder="Składnik" value="${h(r.nazwa || '')}">
      <input class="input num" name="ilosc" type="number" step="any" placeholder="ilość" value="${h(r.Ilosc ?? '')}">
      <select class="input" name="jedn">${opt(['g', 'szt'], r.Jednostka || 'g')}</select>
      <input class="input" name="sekcja" list="sek-list" placeholder="Sekcja" value="${h(r.Sekcja || 'Główne')}">
      <input class="input wide" name="prep" placeholder="Przygotowanie (np. kostka 1 cm)" value="${h(r.Przygotowanie || '')}">
      <button type="button" class="iconbtn small" data-del aria-label="Usuń">🗑</button>
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
  const stepRow = (k = {}) => `<div class="ed-row step-row">
      <select class="input" name="etap">${opt(ETAPY, k.Etap || 'gotowanie')}</select>
      <select class="input" name="sprzet">${opt(SPRZET, k.Sprzet || 'brak')}</select>
      <input class="input num" name="temp" type="number" placeholder="°C" value="${h(k.Temp_C ?? '')}">
      <input class="input num" name="czas" type="number" placeholder="min" value="${h(k.Czas_min ?? '')}">
      <input class="input num" name="akt" type="number" placeholder="aktywnie" value="${h(k.Aktywny_min ?? '')}">
      <select class="input" name="kiedy">${opt(['sesja', 'świeżo'], k.Kiedy || 'sesja')}</select>
      <input class="input num" name="dziecko" type="number" placeholder="👧 od lat" value="${h(k.Dziecko ?? '')}">
      <textarea class="input span-all" name="opis" rows="2" placeholder="Co zrobić (konkretnie: ile, jak długo, po czym poznać, że gotowe)">${h(k.Opis || '')}</textarea>
      <input class="input span-all" name="skl" placeholder="Składniki kroku, rozdziel | (np. Cebula|Oliwa z oliwek)" value="${h(k.Skladniki || '')}">
      <div class="span-all row-between"><span class="small muted">przesuń</span><span>
        <button type="button" class="iconbtn small" data-up>↑</button><button type="button" class="iconbtn small" data-down>↓</button>
        <button type="button" class="iconbtn small" data-del>🗑</button></span></div>
    </div>`;

  root.innerHTML = `
    <datalist id="skl-list">${sklNames.map(n => `<option value="${h(n)}">`).join('')}</datalist>
    <datalist id="sek-list">${['Główne', 'Sos', 'Dressing', 'Do podania', 'Paczka do zamrażarki', 'Rano dodaj', 'Dodatek: ryż', 'Dodatek: kasza gryczana', 'Dodatek: pęczak', 'Dodatek: makaron', 'Dodatek: ziemniaki'].map(n => `<option value="${h(n)}">`).join('')}</datalist>
    ${isImport ? `<div class="warnbox"><p>Import (${h(model.zrodlo || '')}): sprawdź dopasowanie składników (podświetlone na żółto = nowy składnik), ilości i podział na etapy. Krojenie wpisz w „Przygotowanie” – trafi do wspólnego mise en place sesji.</p></div>` : ''}
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
      <div class="span2" data-ings>${model.skladniki.map(ingRow).join('')}</div>
      <div class="span2"><button type="button" class="btn ghost small" data-add-ing>+ składnik</button></div>

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

  root.oninput = ev => {
    const row = ev.target.closest('.ing-row');
    if (row && ev.target.name === 'nazwa') checkNew(row);
  };
  root.onclick = ev => {
    const pick = ev.target.closest('[data-pick]');
    if (pick) { const row = pick.closest('.ing-row'); row.querySelector('[name=nazwa]').value = pick.dataset.pick; checkNew(row); return; }
    if (ev.target.closest('[data-add-ing]')) { root.querySelector('[data-ings]').insertAdjacentHTML('beforeend', ingRow({})); return; }
    if (ev.target.closest('[data-add-step]')) { root.querySelector('[data-steps]').insertAdjacentHTML('beforeend', stepRow({})); return; }
    const del = ev.target.closest('[data-del]');
    if (del) { del.closest('.ed-row').remove(); return; }
    const up = ev.target.closest('[data-up]'), down = ev.target.closest('[data-down]');
    if (up || down) {
      const row = (up || down).closest('.ed-row');
      if (up && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      if (down && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
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
    const skladniki = [...root.querySelectorAll('.ing-row')].map(row => {
      const g = n => row.querySelector(`[name=${n}]`).value.trim();
      const nazwa = g('nazwa');
      if (!nazwa) return null;
      const s = sklByName[nazwa.toLowerCase()];
      const base = { Ilosc: num(g('ilosc')), Jednostka: g('jedn'), Sekcja: g('sekcja') || 'Główne', Przygotowanie: g('prep') };
      return s ? { ...base, ID_Skl: s.ID_Skl }
        : { ...base, nowy: { Nazwa: nazwa, Kategoria: g('kat'), kcal_100g: num(g('kcal')), B_100g: num(g('B')), T_100g: num(g('T')), W_100g: num(g('W')) } };
    }).filter(Boolean);
    const kroki = [...root.querySelectorAll('.step-row')].map(row => {
      const g = n => row.querySelector(`[name=${n}]`).value.trim();
      return { Etap: g('etap'), Sprzet: g('sprzet'), Temp_C: g('temp'), Czas_min: g('czas'), Aktywny_min: g('akt'), Kiedy: g('kiedy'),
        Dziecko: g('dziecko'), Opis: g('opis'), Skladniki: g('skl') };
    }).filter(k => k.Opis);
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
