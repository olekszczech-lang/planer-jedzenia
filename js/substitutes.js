// Zamienniki składników: najpierw sprawdzone kuchennie (z powodem), potem podobne z bazy (ta sama grupa, zbliżone kcal).
import { S } from './state.js';
import { num, norm } from './util.js';

// fragment nazwy → [fragment zamiennika, powód]
const CURATED = [
  ['karkówka', [['wołowina gulaszowa', 'mniej tłuszczu, więcej białka'], ['mięso mielone z indyka', 'chude, szybkie'], ['pierś indyka', 'najchudsze']]],
  ['łopatka', [['wołowina gulaszowa', 'mniej tłuszczu'], ['udziec indyka', 'chude, dobrze się dusi']]],
  ['boczek', [['szynka z indyka', '−40 g tłuszczu na 100 g'], ['wędzona pierś z kurczaka', 'wędzony smak, chude']]],
  ['śmietanka kremowa', [['jogurt grecki', 'dodaj po zdjęciu z ognia – nie zważy się'], ['serek śmietankowy', 'kremowość, mniej tłuszczu'], ['mleko kokosowe light', 'do curry i zup']]],
  ['śmietana, 18', [['jogurt grecki', 'mniej tłuszczu, więcej białka']]],
  ['ryż biały', [['ryż brązowy', 'niższy IG, więcej błonnika'], ['kasza jęczmienna pęczak', 'najniższy IG'], ['kasza gryczana', 'niski IG, sycąca']]],
  ['arborio', [['kasza jęczmienna pęczak', 'pęczotto – dużo niższy IG']]],
  ['kuskus', [['kasza bulgur', 'niższy IG'], ['kasza jęczmienna pęczak', 'najniższy IG'], ['komosa', 'więcej białka']]],
  ['ziemniaki', [['słodki ziemniak', 'niższy IG, więcej witamin'], ['kasza jęczmienna pęczak', 'niski IG, można gotować w sesji'], ['kalafior', 'mało kcal (puree)']]],
  ['makaron rurki', [['makaron penne pełnoziarnisty', 'niższy IG, błonnik']]],
  ['makaron orzo', [['makaron penne pełnoziarnisty', 'niższy IG'], ['kasza jęczmienna pęczak', 'niski IG']]],
  ['tortilla pszenna', [['tortilla pełnoziarnista', 'niższy IG, błonnik']]],
  ['bułka', [['chleb żytni razowy', 'niższy IG, błonnik']]],
  ['grahamka', [['chleb żytni razowy', 'niższy IG']]],
  ['mąka pszenna typ 500', [['mąka pszenna typ 1850', 'pełnoziarnista, niższy IG'], ['płatki owsiane', 'zmielone na mąkę – niższy IG']]],
  ['cukier', [['erytrol', '0 kcal, nie podnosi cukru'], ['banan', 'naturalna słodycz (do placków)']]],
  ['miód', [['erytrol', 'bez wpływu na cukier']]],
  ['tuńczyk w oleju', [['tuńczyk w sosie własnym', '−25 g tłuszczu na puszkę']]],
  ['granola', [['płatki owsiane', 'bez cukru, niski IG'], ['orzechy włoskie', 'chrupkość bez cukru']]],
  ['mozzarella', [['ser mozzarella light', 'połowa tłuszczu']]],
  ['ser gorgonzola', [['ser typu "feta"', 'mniej tłuszczu, wyrazisty smak'], ['ser parmezan', 'mniej potrzeba']]],
  ['bulion drobiowy', [['rosół domowy', 'z sesji – bez glutaminianu']]],
  ['pierś kurczaka', [['pierś indyka', 'podobne, chudsze'], ['udko kurczaka bez skóry', 'soczystsze do duszenia'], ['tofu', 'wersja wege']]],
  ['mięso mielone', [['soczewica czerwona', 'pół na pół z mięsem – więcej błonnika']]],
  ['jogurt naturalny', [['skyr naturalny', '3× więcej białka'], ['jogurt grecki', 'gęstszy']]],
  ['mleko', [['napój sojowy', 'bez laktozy, podobne białko']]],
  ['orzechy piniowe', [['pestki dyni', 'tańsze, więcej białka'], ['pestki słonecznika', 'tańsze']]]
];

/** Zwraca listę zamienników: [{ID_Skl, Nazwa, kcal_100g, B_100g, powod}] */
export function substitutesFor(idSkl) {
  const s = S.idx.skl[idSkl];
  if (!s) return [];
  const all = Object.values(S.idx.skl);
  const name = String(s.Nazwa).toLowerCase();
  const out = [];
  const seen = new Set([idSkl]);
  CURATED.filter(([frag]) => name.includes(frag)).forEach(([, list]) => list.forEach(([target, powod]) => {
    const hit = all.find(x => !seen.has(x.ID_Skl) && norm(x.Nazwa).includes(norm(target)));
    if (hit) { seen.add(hit.ID_Skl); out.push({ ...hit, powod }); }
  }));
  // podobne z bazy: ta sama grupa i kategoria, kcal ±35%; wędlina nie zastępuje surowego mięsa (i odwrotnie)
  const PROCESSED = /kiełbas|szynk|salami|parówk|pasztet|kabanos|baleron|polędwica|wędzon|pieczeń|pieczon|smażon|schab pieczony|kaszanka/i;
  const FISH = /łoso|dorsz|śledź|halibut|tuńczyk|makrel|pstrąg|mintaj|morszczuk|sola |szczupak|sandacz|karp|flądr|krewet|sardyn|szprot|paluszek krab/i;
  const srcProcessed = PROCESSED.test(s.Nazwa);
  const srcFish = FISH.test(s.Nazwa);
  const k = num(s.kcal_100g) || 1;
  all.filter(x => !seen.has(x.ID_Skl) && x.Grupa === s.Grupa && x.Kategoria === s.Kategoria && !x.Zrodlo_Pot && PROCESSED.test(x.Nazwa) === srcProcessed && FISH.test(x.Nazwa) === srcFish)
    .map(x => ({ x, d: Math.abs(num(x.kcal_100g) - k) / k }))
    .filter(o => o.d <= 0.35)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6 - Math.min(out.length, 5))
    .forEach(o => out.push({ ...o.x, powod: 'podobny produkt (' + (o.x.IG_klasa || '?') + ' IG)' }));
  return out;
}
