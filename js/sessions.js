// Sesje gotowania w interfejsie: opisy („nd 15.11 → pn–śr”), podgląd harmonogramu z Ustawień
// i okno „Zmień termin / dodaj sesję” (gotuję dziś, przesuwam na czwartek…).
import { call } from './api.js';
import { busy, toast, sheet } from './ui.js';
import { h, today, addDays, parseKey } from './util.js';

export const DAY_SHORT = ['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
export const DAY_LONG = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

/** 1 = poniedziałek … 7 = niedziela */
export const dow = k => (parseKey(k).getDay() + 6) % 7 + 1;
const dd = k => `${parseKey(k).getDate()}.${String(parseKey(k).getMonth() + 1).padStart(2, '0')}`;

/** „nd 15.11” */
export const shortDay = k => `${DAY_SHORT[dow(k) - 1]} ${dd(k)}`;

/** Dni sesji zwięźle: „pn–śr”, „pt–pn”, „pn, wt, czw”. */
export function coverText(dni) {
  if (!dni || !dni.length) return '–';
  const contiguous = dni.every((k, i) => !i || addDays(dni[i - 1], 1) === k);
  if (dni.length === 1) return DAY_SHORT[dow(dni[0]) - 1];
  if (contiguous) return `${DAY_SHORT[dow(dni[0]) - 1]}–${DAY_SHORT[dow(dni[dni.length - 1]) - 1]}`;
  return dni.map(k => DAY_SHORT[dow(k) - 1]).join(', ');
}

const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
export const daysWord = n => `${n} ${plural(n, 'dzień', 'dni', 'dni')}`;

/** Harmonogram z Ustawień: dla każdego dnia gotowania – na które dni tygodnia gotuje (jak w API). */
export function schedulePreview(dni) {
  const list = [...new Set(dni.map(Number))].filter(d => d >= 1 && d <= 7).sort((a, b) => a - b);
  return list.map(d => {
    const cover = [];
    for (let i = 1; i <= 7; i++) {
      const x = (d - 1 + i) % 7 + 1;
      cover.push(x);
      if (list.includes(x)) break;
    }
    const txt = cover.length === 1 ? DAY_SHORT[cover[0] - 1] : `${DAY_SHORT[cover[0] - 1]}–${DAY_SHORT[cover[cover.length - 1] - 1]}`;
    return { dzien: d, dni: cover, opis: cover.length === 7 ? 'cały tydzień' : txt };
  });
}

/** Ile dni między a i b (włącznie). */
const span = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5) + 1;

/**
 * Okno sesji: s = istniejąca sesja (stała „R…” → przesunięcie, dodatkowa → zmiana) albo null (nowa).
 * known: sesje, które już widać (do ostrzeżenia, które przejmą dni). onSaved(id, od) po zapisie.
 * init: wartości startowe pól (np. {od, do} – dołączenie dni bez sesji).
 */
export function editSession(s, known, onSaved, init = {}) {
  const t = today();
  const v = { ...(s ? { data: s.data, od: s.od || s.dni[0], do: s.do || s.dni[s.dni.length - 1], nazwa: s.staly ? '' : s.nazwa, godzina: s.godzina || '' }
    : { data: t, od: addDays(t, 1), do: addDays(t, 4), nazwa: '', godzina: '' }), ...init };
  const title = !s ? 'Dodatkowa sesja gotowania' : (s.staly ? `Przesuń sesję: ${s.nazwa} ${shortDay(s.data)}` : `Sesja: ${s.nazwa} ${shortDay(s.data)}`);
  const m = sheet(title, `
    <form class="form" data-sess>
      ${s ? '' : `<div class="chips">
        <button type="button" class="chip" data-quick="now">🔥 Gotuję dziś na kolejne dni</button>
        <button type="button" class="chip" data-quick="morning">🌅 Dziś rano – też na dziś</button></div>`}
      <label>Dzień gotowania<input class="input" type="date" name="data" value="${h(v.data)}" required></label>
      <div class="grid2">
        <label>Gotujesz na dni: od<input class="input" type="date" name="od" value="${h(v.od)}" required></label>
        <label>do<input class="input" type="date" name="do" value="${h(v.do)}" required></label>
      </div>
      <p class="small" data-prev></p>
      <div class="grid2">
        <label>Nazwa (opcjonalnie)<input class="input" name="nazwa" value="${h(v.nazwa)}" placeholder="np. Gotowanie z dziećmi"></label>
        <label>Godzina (przypomnienie)<input class="input" type="time" name="godzina" value="${h(v.godzina)}"></label>
      </div>
      <p class="small muted">Dni z tego zakresu wypadną z innych sesji. Dania z planu w tych dniach ugotujesz w tej sesji – lista krojenia, kroki i porcjowanie przeliczą się same.
        Stały harmonogram (dni gotowania co tydzień) zmienisz w Ustawieniach.</p>
      <div class="toolbar">
        <button class="btn">Zapisz sesję</button>
        ${s && !s.staly ? '<button type="button" class="btn ghost danger" data-del>Usuń – wróć do harmonogramu</button>' : ''}
      </div>
    </form>`);
  const f = m.el.querySelector('[data-sess]');
  const e = f.elements;
  const prev = () => {
    const ok = e.od.value && e.do.value && e.do.value >= e.od.value;
    const box = m.el.querySelector('[data-prev]');
    if (!ok) { box.innerHTML = '<span class="warn-text">Koniec zakresu jest przed początkiem.</span>'; return; }
    const dni = [];
    for (let k = e.od.value; k <= e.do.value && dni.length < 30; k = addDays(k, 1)) dni.push(k);
    const lose = (known || []).filter(x => x.id !== (s && s.id) && x.dni.some(k => k >= e.od.value && k <= e.do.value));
    box.innerHTML = `Gotujesz ${e.data.value === t ? 'dziś' : shortDay(e.data.value)} na: <b>${h(coverText(dni))}</b> (${daysWord(dni.length)})` +
      (e.od.value < e.data.value ? '<br><span class="warn-text">Zakres nie może zaczynać się przed dniem gotowania.</span>' : '') +
      (dni.length > 14 ? '<br><span class="warn-text">Najwyżej 14 dni.</span>' : '') +
      (dni.length > 4 ? '<br><span class="muted">Dłużej niż 3–4 dni: część porcji pójdzie do zamrażarki (plan sesji to podpowie).</span>' : '') +
      (lose.length ? `<br><span class="muted">Przejmie dni z: ${lose.map(x => h(`${x.nazwa} ${shortDay(x.data)}`)).join(', ')}.</span>` : '');
  };
  f.addEventListener('input', prev);
  f.addEventListener('change', prev);
  prev();
  m.el.addEventListener('click', async ev => {
    const q = ev.target.closest('[data-quick]');
    if (q) {
      e.data.value = t;
      e.od.value = q.dataset.quick === 'morning' ? t : addDays(t, 1);
      if (!e.do.value || e.do.value < e.od.value) e.do.value = addDays(e.od.value, 3);
      prev();
      return;
    }
    const del = ev.target.closest('[data-del]');
    if (del) {
      if (!confirm('Usunąć tę sesję? Jej dni wrócą do stałego harmonogramu.')) return;
      await busy(del, async () => {
        await call('deleteSession', { id: s.id });
        toast('Sesja usunięta', 'ok');
        m.close();
        onSaved && onSaved(null, v.od);
      });
    }
  });
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (e.do.value < e.od.value || e.od.value < e.data.value) { toast('Sprawdź daty sesji', 'error'); return; }
    if (span(e.od.value, e.do.value) > 14) { toast('Sesja może obejmować najwyżej 14 dni', 'error'); return; }
    await busy(f.querySelector('button:not([type=button])'), async () => {
      const r = await call('saveSession', { id: s ? s.id : undefined, data: e.data.value, od: e.od.value, do: e.do.value,
        nazwa: e.nazwa.value.trim(), godzina: e.godzina.value });
      toast('Zapisano sesję', 'ok');
      m.close();
      onSaved && onSaved(r.id, e.od.value);
    });
  });
  return m;
}
