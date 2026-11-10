// Słowniki z "bootstrap" (potrawy, składniki, osoby, cele) + indeksy i obliczenia porcji po stronie klienta.
import { call, readCache, writeCache } from './api.js';
import { num, truthy, MEALS, parseKey } from './util.js';

export const S = { boot: null };

const byId = (rows, k) => Object.fromEntries((rows || []).map(r => [r[k], r]));
const groupBy = (rows, k) => (rows || []).reduce((m, r) => ((m[r[k]] ||= []).push(r), m), {});

function index(boot) {
  const cele = {};
  (boot.celeKcal || []).forEach(c => { (cele[c.ID_Osoby] ||= {})[c.Typ_posilku] = num(c.Target_kcal); });
  const typyByPot = {};
  const potByTyp = {};
  (boot.potrawyTypy || []).forEach(t => {
    (typyByPot[t.ID_Pot] ||= []).push(t.Typ_posilku);
    (potByTyp[t.Typ_posilku] ||= []).push(t.ID_Pot);
  });
  const aktywne = (boot.osoby || []).filter(o => truthy(o.Aktywna)).map(o => o.ID_Osoby);
  const kroki = groupBy(boot.kroki, 'ID_Pot');
  Object.values(kroki).forEach(list => list.sort((a, b) => num(a.Nr) - num(b.Nr)));
  const produkty = {}; // ID_Pot bazy → [składniki, które wytwarza]
  (boot.skladniki || []).forEach(s => { if (s.Zrodlo_Pot) (produkty[s.Zrodlo_Pot] ||= []).push(s); });
  return {
    pot: byId(boot.potrawy, 'ID_Pot'),
    sum: byId(boot.potSum, 'ID_Pot'),
    skl: byId(boot.skladniki, 'ID_Skl'),
    osoba: byId(boot.osoby, 'ID_Osoby'),
    rec: groupBy(boot.receptury, 'ID_Pot'),
    kroki, produkty,
    oceny: boot.oceny || {},
    cele, typyByPot, potByTyp,
    aktywne: aktywne.length ? aktywne : (boot.osoby || []).map(o => o.ID_Osoby)
  };
}

export const PLACE_ICON = { 'lunchbox': '📦', 'lunchbox ciepły': '📦♨️', 'poza domem': '🏫' };
export const PLACE_LABEL = { 'dom': 'w domu', 'lunchbox': 'lunchbox (na zimno)', 'lunchbox ciepły': 'lunchbox (mikrofala)', 'poza domem': 'poza domem' };

/** Gdzie osoba je posiłek w danym dniu (z harmonogramu). Zwraca {miejsce, uwagi}. */
export function placeOf(id, k, typ) {
  const d = parseKey(k);
  const dow = (d.getDay() + 6) % 7 + 1;
  const r = (S.boot.harmonogram || []).find(x => x.ID_Osoby === id && Number(x.Dzien_tyg) === dow && x.Typ_posilku === typ);
  return r ? { miejsce: r.Miejsce, uwagi: r.Uwagi || '' } : { miejsce: 'dom', uwagi: '' };
}

/** Osoby (aktywne, z tym posiłkiem w profilu), które danego dnia jedzą go poza domem. */
export function awayFor(k, typ) {
  return S.idx.aktywne
    .filter(id => mealsOf(id).includes(typ))
    .map(id => ({ id, ...placeOf(id, k, typ) }))
    .filter(x => x.miejsce === 'poza domem');
}

export const MODE_ICON ={ 'mrożenie': '❄️', 'lodówka': '🧊', 'na świeżo': '🍳', 'hybryda': '🧩' };
export const KID_FACES = ['😖', '🙁', '😐', '🙂', '😋'];

export const tagsOf = p => String((p && p.Tagi) || '').split(',').map(s => s.trim()).filter(Boolean);
export const isKid = id => (S.idx.osoba[id] || {}).Rola === 'dziecko';

/** Posiłki osoby (z profilu). */
export function mealsOf(id) {
  const o = S.idx.osoba[id] || {};
  return o._posilki || String(o.Posilki || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Posiłki, które je przynajmniej jedna aktywna osoba (w kolejności dnia). */
export function mealsInUse() {
  const used = new Set(S.idx.aktywne.flatMap(mealsOf));
  const list = S.meals.filter(m => used.has(m));
  return list.length ? list : S.meals;
}

/** Typy potraw pasujące do posiłku (np. Podwieczorek ← Przekąska). */
export const dishTypesFor = typ => (S.boot.mealAliases || {})[typ] || [typ];

function setBoot(boot) {
  S.boot = boot;
  S.idx = index(boot);
  S.meals = boot.mealTypes || MEALS;
}

/** Słowniki: z cache natychmiast (odświeżenie w tle), bez cache – z sieci. */
export async function ensureBoot(force) {
  if (S.boot && !force) return S.boot;
  const cached = force ? undefined : await readCache('bootstrap');
  if (cached) {
    setBoot(cached);
    call('bootstrap').then(b => { writeCache('bootstrap', b); setBoot(b); }).catch(() => {});
    return S.boot;
  }
  const b = await call('bootstrap');
  await writeCache('bootstrap', b);
  setBoot(b);
  return S.boot;
}

// ── Pomocnicze ─────────────────────────────────────────────

export const potName = id => (S.idx.pot[id] || {}).Nazwa || id;
export const osobaName = id => (S.idx.osoba[id] || {}).Nazwa || id;

/** Mnożnik wpisu planu (jak Portions.multiplierOf na serwerze). */
export function multOf(e) {
  const m = num(e.Mnoznik);
  if (m) return m;
  const s = S.idx.sum[e.ID_Pot];
  const target = (S.idx.cele[e.ID_Osoby] || {})[e.Typ_posilku] || 0;
  if (s && target && num(s.kcal)) return target / num(s.kcal);
  return 1 / (num((S.idx.pot[e.ID_Pot] || {}).Porcje_bazowe) || 1);
}

/** kcal/B/T/W dla ułamka przepisu. */
export function macros(idPot, m) {
  const s = S.idx.sum[idPot] || {};
  return { kcal: num(s.kcal) * m, B: num(s.B) * m, T: num(s.T) * m, W: num(s.W) * m };
}

/** Porcja w gramach: zapisana albo wyliczona z mnożnika. */
export function gramsOf(e) {
  const g = num(e.Porcja_g);
  if (g) return g;
  return multOf(e) * num((S.idx.sum[e.ID_Pot] || {}).Waga_po_obrobce);
}

export function celDnia(idOsoby) {
  const c = S.idx.cele[idOsoby] || {};
  return Object.values(c).reduce((a, b) => a + b, 0);
}

export function activeDishes(typ) {
  const ids = typ ? [...new Set(dishTypesFor(typ).flatMap(t => S.idx.potByTyp[t] || []))] : Object.keys(S.idx.pot);
  return ids
    .map(id => S.idx.pot[id])
    .filter(p => p && truthy(p.Aktywna) && S.idx.sum[p.ID_Pot] && p.Kategoria !== 'Baza')
    .sort((a, b) => a.Nazwa.localeCompare(b.Nazwa, 'pl'));
}

export function sortEntries(rows) {
  return rows.slice().sort((a, b) =>
    String(a.Data).localeCompare(String(b.Data)) ||
    S.meals.indexOf(a.Typ_posilku) - S.meals.indexOf(b.Typ_posilku) ||
    String(a.ID_Osoby).localeCompare(String(b.ID_Osoby)));
}
