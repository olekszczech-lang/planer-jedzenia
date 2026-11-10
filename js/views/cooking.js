// Gotowanie: sesje (niedziela / środa) – wspólne bazy, piekarnik dual cook, etapy, pakowanie, etykiety,
// dania na świeżo, eksport do Kalendarza i Todoist.
import { live, call } from '../api.js';
import { MODE_ICON } from '../state.js';
import { busy, toast, sheet } from '../ui.js';
import { FORMATS, printLabels, shareLabelImages } from '../labels.js';
import { h, today, addDays, mondayOf, fmtDay, fmtRange, fmtNum, fmtQty, isKey } from '../util.js';

const DONE_KEY = 'planer.sessionDone';

export async function render(root, q, ctx) {
  const from = mondayOf(isKey(q.w) ? q.w : today());
  const to = addDays(from, 6);
  let data = null;
  let done = {};
  try { done = JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { /* puste */ }

  root.innerHTML = `
    <div class="datenav">
      <a class="iconbtn" href="#/gotowanie?w=${addDays(from, -7)}" aria-label="Poprzedni tydzień">‹</a>
      <div class="datenav-title"><strong>${h(fmtRange(from, to))}</strong><span class="small muted">sesje gotowania</span></div>
      <a class="iconbtn" href="#/gotowanie?w=${addDays(from, 7)}" aria-label="Następny tydzień">›</a>
    </div>
    <div class="toolbar">
      <button class="btn ghost small" data-export="calendar">📅 Do Kalendarza</button>
      <button class="btn ghost small" data-export="todoist">✅ Do Todoist</button>
    </div>
    <section data-list><div class="loading">Układam plan sesji…</div></section>`;

  const stepId = (s, fi, ki) => `${s.data}|${fi}|${ki}`;

  const draw = d => {
    if (!ctx.alive()) return;
    data = d;
    const box = root.querySelector('[data-list]');
    const any = d.sesje.some(s => s.potrawy.length) || d.swieze.length;
    if (!any) {
      box.innerHTML = `<div class="empty"><p>Brak zaplanowanych posiłków w tym tygodniu.</p><p><a class="btn" href="#/tydzien?w=${from}">Zaplanuj tydzień</a></p></div>`;
      return;
    }
    box.innerHTML = d.sesje.map(s => !s.potrawy.length ? '' : `
      <article class="card session">
        <div class="row-between"><h3>🍳 ${h(s.nazwa)} · ${h(fmtDay(s.data))}</h3><span class="chip">≈ ${fmtNum(s.czas_min / 60, 1)} h</span></div>
        <p class="small muted">Na dni: ${s.dni.map(k => h(fmtDay(k))).join(', ')}</p>
        <div class="chips">${s.potrawy.map(p => `<a class="chip ${p.baza ? 'strong' : ''}" href="#/przepis?id=${encodeURIComponent(p.ID_Pot)}">${MODE_ICON[p.tryb] || ''} ${h(p.Nazwa)} ×${fmtNum(p.mnoznik, 2)}</a>`).join('')}</div>
        ${s.ostrzezenia.length ? `<div class="warnbox">${s.ostrzezenia.map(w => `<p>⚠️ ${h(w)}</p>`).join('')}</div>` : ''}

        ${s.bazy.length ? `<h4 class="sec">Wspólne bazy (jeden garnek)</h4>
          <ul class="plain">${s.bazy.map(b => `<li><b>${h(b.Nazwa)} – ${fmtQty(b.ilosc, 'g')}</b> <span class="small muted">(${b.dla.map(x => h(x.potrawa) + ' ' + x.ilosc + ' g').join(', ')})</span><br><span class="small">${h(b.uwaga)}</span></li>`).join('')}</ul>` : ''}

        ${s.piekarnik.length ? `<h4 class="sec">Piekarnik dual cook</h4>
          ${s.piekarnik.map(o => `<div class="oven">
            <div><span class="small muted">Góra</span><br><b>${h(o.gora.potrawa)}</b><br><span class="small">${o.gora.temp}°C · ${o.gora.czas} min</span></div>
            <div><span class="small muted">Dół</span><br>${o.dol ? `<b>${h(o.dol.potrawa)}</b><br><span class="small">${o.dol.temp}°C · ${o.dol.czas} min</span>` : '<span class="muted">wolne</span>'}</div>
            ${o.razem ? '<p class="small span2">Ta sama temperatura – można też razem w całym piekarniku, bez przegrody.</p>' : ''}
          </div>`).join('')}` : ''}

        <h4 class="sec">Kolejność pracy</h4>
        ${s.fazy.map((f, fi) => `<details ${fi < 2 ? 'open' : ''}><summary>${fi + 1}. ${h(f.nazwa)} <span class="muted small">(${f.kroki.length})</span></summary>
          <ul class="checklist">${f.kroki.map((k, ki) => {
            const id = stepId(s, fi, ki);
            return `<li><label class="${done[id] ? 'done' : ''}"><input type="checkbox" data-step="${h(id)}" ${done[id] ? 'checked' : ''}>
              <span><b>${h(k.potrawa || '')}</b>${k.mnoznik ? ` <span class="muted small">×${fmtNum(k.mnoznik, 2)}</span>` : ''}${k.temp ? ` <span class="chip">${k.temp}°C</span>` : ''}${k.czas ? ` <span class="chip">⏱ ${k.czas} min</span>` : ''}${k.dziecko ? ` <span class="chip kid">👧 ${k.dziecko}+</span>` : ''}<br>${h(k.opis)}</span></label></li>`;
          }).join('')}</ul></details>`).join('')}

        <h4 class="sec">Pakowanie (${s.pakowanie.length} porcji)</h4>
        <table class="table small">${s.pakowanie.map(p => `<tr>
          <td>${h(fmtDay(p.data))}<br><span class="muted">${h(p.typ)}</span></td>
          <td><b>${h(p.osoba)}</b>${/^lunchbox/.test(p.miejsce || '') ? ' 📦' : ''}<br>${h(p.potrawa)}</td>
          <td class="num">${fmtNum(p.gramy)} g<br><span class="muted">${fmtNum(p.kcal)} kcal</span></td>
          <td class="num">${p.akcja === 'zamrażarka' ? `❄️<br><span class="muted">${p.rozmrozic ? 'rozmroź ' + h(fmtDay(p.rozmrozic)) : 'prosto do blendera'}</span>` : '🧊'}</td></tr>`).join('')}</table>
        <div class="toolbar"><button class="btn" data-labels="${h(s.data)}">🏷️ Etykiety (${s.pakowanie.length})</button></div>
        <details><summary>⚖️ Korekta porcji po zważeniu gotowego dania</summary>
          <form class="inline-form" data-weigh="${h(s.dni[0])}|${h(s.dni[s.dni.length - 1])}">
            <select class="input" name="idPot">${s.potrawy.filter(p => !p.baza).map(p => `<option value="${h(p.ID_Pot)}">${h(p.Nazwa)}</option>`).join('')}</select>
            <input class="input" name="waga" type="number" inputmode="numeric" min="1" placeholder="g" required style="max-width:6.5rem">
            <button class="btn ghost">OK</button>
          </form>
          <p class="small muted">Gramy porcji każdej osoby przeliczą się proporcjonalnie – kalorie zostają takie jak w planie.</p>
        </details>
      </article>`).join('') +

      (d.swieze.length ? `<article class="card">
        <h3>🥚 Na świeżo (w dniu jedzenia)</h3>
        ${d.swieze.map(day => `<h4 class="sec">${h(fmtDay(day.data, true))}</h4>
          <ul class="plain">${day.potrawy.map(p => `<li><a href="#/przepis?id=${encodeURIComponent(p.ID_Pot)}"><b>${h(p.Nazwa)}</b></a> ×${fmtNum(p.mnoznik, 2)}${p.hybryda ? ' <span class="chip">🧩 finisz</span>' : ''}
            <span class="small muted">(${p.porcje.map(x => h(x.osoba) + ' ' + fmtNum(x.gramy) + ' g').join(', ')})</span>
            ${p.kroki.length ? `<ol class="small">${p.kroki.map(k => `<li>${h(k.opis)}</li>`).join('')}</ol>` : ''}</li>`).join('')}</ul>`).join('')}
      </article>` : '');
  };

  root.onchange = ev => {
    const cb = ev.target.closest('[data-step]');
    if (!cb) return;
    if (cb.checked) done[cb.dataset.step] = 1; else delete done[cb.dataset.step];
    cb.closest('label').classList.toggle('done', cb.checked);
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch { /* brak miejsca */ }
  };

  root.onclick = async ev => {
    const ex = ev.target.closest('[data-export]');
    if (ex) {
      const kind = ex.dataset.export;
      await busy(ex, async () => {
        const r = await call(kind === 'calendar' ? 'exportCalendar' : 'exportTodoist', { from });
        toast(`${kind === 'calendar' ? 'Kalendarz' : 'Todoist'}: dodano ${r.utworzono} pozycji`, 'ok');
      });
      return;
    }
    const lb = ev.target.closest('[data-labels]');
    if (lb && data) {
      const s = data.sesje.find(x => x.data === lb.dataset.labels);
      openLabels(s.pakowanie);
    }
  };

  root.onsubmit = async ev => {
    const f = ev.target.closest('[data-weigh]');
    if (!f) return;
    ev.preventDefault();
    const [wf, wt] = f.dataset.weigh.split('|');
    await busy(f.querySelector('button'), async () => {
      const r = await call('setActualWeight', { from: wf, to: wt, idPot: f.elements.idPot.value, waga: Number(f.elements.waga.value) });
      toast(`Przeliczono ${r.zmieniono} porcji`, 'ok');
      await live(`sessions:${from}`, 'sessions', { from }, draw);
    });
  };

  await live(`sessions:${from}`, 'sessions', { from }, draw);
}

function openLabels(items) {
  const saved = localStorage.getItem('planer.labelFormat') || 'a4-70x37';
  const s = sheet('Etykiety', `
    <p class="small muted">${items.length} etykiet: osoba, danie, data, gramy, kcal, „zjeść do”, co dodać po odgrzaniu.</p>
    <label class="form-row">Format
      <select class="input" data-format>${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${k === saved ? 'selected' : ''}>${h(f.nazwa)}</option>`).join('')}</select>
    </label>
    <div class="actions-list">
      <button class="btn" data-print>🖨️ Drukuj</button>
      <button class="btn ghost" data-share>📲 Obrazy 50×30 do aplikacji drukarki</button>
    </div>
    <p class="small muted">Drukarka etykiet Bluetooth (np. Niimbot B1): „Obrazy” → Udostępnij → aplikacja drukarki. Bezpośredni druk z aplikacji – w kolejnym etapie.</p>`);
  s.el.addEventListener('click', async e => {
    const fmt = s.el.querySelector('[data-format]').value;
    localStorage.setItem('planer.labelFormat', fmt);
    if (e.target.closest('[data-print]')) {
      try { printLabels(items, fmt); } catch (err) { toast(err.message, 'error'); }
    }
    if (e.target.closest('[data-share]')) {
      try {
        const r = await shareLabelImages(items);
        if (r === 'downloaded') toast('Pobrano obrazy etykiet', 'ok');
      } catch (err) { if (err.name !== 'AbortError') toast(err.message, 'error'); }
    }
  });
}
