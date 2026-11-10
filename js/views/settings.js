// Ustawienia: połączenie z arkuszem, osoby (profile dorosłych i dzieci), integracje, synchronizacja.
import { getSettings, saveSettings, call, flush, status, isConfigured } from '../api.js';
import { S, ensureBoot } from '../state.js';
import * as db from '../db.js';
import { busy, toast } from '../ui.js';
import { h, truthy, num } from '../util.js';

const MEALS = ['Śniadanie', 'II śniadanie', 'Obiad', 'Podwieczorek', 'Przekąska', 'Kolacja'];
const ACT = ['niska', 'umiarkowana', 'wysoka', 'bardzo wysoka'];
const GOALS = ['utrzymanie', 'masa', 'redukcja'];

function personForm(o) {
  const meals = o._posilki || [];
  const sel = (name, opts, cur) => `<select class="input" name="${name}">${opts.map(x => `<option ${x === cur ? 'selected' : ''}>${h(x)}</option>`).join('')}</select>`;
  return `<details class="person"><summary><b>${h(o.Nazwa)}</b> <span class="muted small">${o.Rola === 'dziecko' ? '👧 dziecko' + (o.Wiek ? ', ' + o.Wiek + ' l.' : '') : 'dorosły'} · ${num(o.Kcal_dzien) || '?'} kcal · ${meals.length} posiłki${truthy(o.Aktywna) ? '' : ' · nieaktywna'}</span></summary>
    <form class="form grid2" data-person="${h(o.ID_Osoby)}">
      <label>Imię<input class="input" name="Nazwa" value="${h(o.Nazwa)}"></label>
      <label>Rola${sel('Rola', ['dorosły', 'dziecko'], o.Rola || 'dorosły')}</label>
      <label>Wiek<input class="input" name="Wiek" type="number" min="1" value="${h(o.Wiek)}"></label>
      <label>Płeć${sel('Plec', ['M', 'K'], o.Plec || 'M')}</label>
      <label>Waga (kg)<input class="input" name="Waga_kg" type="number" step="0.1" value="${h(o.Waga_kg)}"></label>
      <label>Wzrost (cm)<input class="input" name="Wzrost_cm" type="number" value="${h(o.Wzrost_cm)}"></label>
      <label>Aktywność${sel('Aktywnosc', ACT, o.Aktywnosc || 'umiarkowana')}</label>
      <label>Cel${sel('Cel', GOALS, o.Cel || 'utrzymanie')}</label>
      <label>Kcal dziennie<input class="input" name="Kcal_dzien" type="number" step="50" value="${h(o.Kcal_dzien)}"></label>
      <label>Białko g/kg<input class="input" name="Bialko_g_kg" type="number" step="0.1" value="${h(o.Bialko_g_kg)}"></label>
      <label>Niski IG${sel('IG_tryb', ['preferencja', 'twardy'], o.IG_tryb || 'preferencja')}</label>
      <label>Rozkład kcal % (po przecinku)<input class="input" name="Rozklad" value="${h((o._rozklad || []).join(','))}"></label>
      <fieldset class="span2"><legend>Posiłki</legend>${MEALS.map(m => `<label class="check"><input type="checkbox" name="meal" value="${h(m)}" ${meals.includes(m) ? 'checked' : ''}> ${h(m)}</label>`).join(' ')}</fieldset>
      <label class="span2">Nie je (fragmenty nazw, po przecinku)<input class="input" name="Wykluczenia" value="${h(o.Wykluczenia)}" placeholder="np. grzyby, ryba"></label>
      <label class="check span2"><input type="checkbox" name="Aktywna" ${truthy(o.Aktywna) ? 'checked' : ''}> Uwzględniaj w planie</label>
      <div class="toolbar span2">
        <button class="btn">Zapisz</button>
        <button class="btn ghost" type="button" data-auto>Policz kcal${o._szacunek ? ' (≈ ' + o._szacunek + ')' : ''}</button>
      </div>
      <p class="small muted span2">IG „twardy” = „Uzupełnij puste” nie wybierze dań o wysokim IG dla tej osoby (np. insulinooporność).
      Dzieci: kcal z norm wiekowych; dorośli: wzór Mifflin-St Jeor × aktywność, +10% masa / −15% redukcja.</p>
    </form>
    ${scheduleForm(o)}
    </details>`;
}

const DAY_GROUPS = [['Pn–Pt', [1, 2, 3, 4, 5]], ['Sobota', [6]], ['Niedziela', [7]]];
const PLACES = [['dom', '🏠 dom'], ['lunchbox', '📦 lunchbox'], ['lunchbox ciepły', '📦♨️ ciepły'], ['poza domem', '🏫 poza']];

function scheduleForm(o) {
  const rows = (S.boot.harmonogram || []).filter(r => r.ID_Osoby === o.ID_Osoby);
  const get = (d, typ) => (rows.find(r => Number(r.Dzien_tyg) === d && r.Typ_posilku === typ) || {}).Miejsce || 'dom';
  const note = (days) => (rows.find(r => days.includes(Number(r.Dzien_tyg)) && r.Uwagi) || {}).Uwagi || '';
  const meals = o._posilki || [];
  return `<form class="form schedule" data-schedule="${h(o.ID_Osoby)}">
    <h4 class="sec">Gdzie je (harmonogram tygodnia)</h4>
    <table class="table small sched"><tr><th></th>${DAY_GROUPS.map(([n]) => `<th>${n}</th>`).join('')}</tr>
      ${meals.map(m => `<tr><td>${h(m)}</td>${DAY_GROUPS.map(([n, days]) => {
        const mixed = new Set(days.map(d => get(d, m))).size > 1;
        const cur = get(days[0], m);
        const orig = (rows.find(r => Number(r.Dzien_tyg) === days[0] && r.Typ_posilku === m) || {}).Uwagi || '';
        return `<td><select class="input" name="s|${n}|${h(m)}" data-orig="${h(cur)}" data-uwagi="${h(orig)}">${PLACES.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>${mixed ? '<span class="small muted">różne dni</span>' : ''}</td>`;
      }).join('')}</tr>`).join('')}
    </table>
    <label>Uwagi (np. szkoła, przedszkole, praca, babcia)<input class="input" name="uwagi" value="${h(note([1, 2, 3, 4, 5]))}"></label>
    <div class="toolbar"><button class="btn ghost">Zapisz harmonogram</button></div>
    <p class="small muted">🏫 poza domem = planer nie gotuje tego posiłku. 📦 = danie z sesji pakowane do pudełka (na zimno albo do mikrofali).</p>
  </form>`;
}

function readSchedule(form) {
  const rows = [];
  const uwagi = form.elements.uwagi.value.trim();
  [...form.querySelectorAll('select[name^="s|"]')].forEach(sel => {
    const [, grp, meal] = sel.name.split('|');
    const days = DAY_GROUPS.find(g => g[0] === grp)[1];
    // niezmienione miejsce → zachowaj własną notatkę posiłku; zmienione → notatka ogólna (dni robocze)
    const note = sel.value === sel.dataset.orig && sel.dataset.uwagi ? sel.dataset.uwagi : (days.length > 1 ? uwagi : '');
    if (sel.value !== 'dom') days.forEach(d => rows.push({ Dzien_tyg: d, Typ_posilku: meal, Miejsce: sel.value, Uwagi: note }));
  });
  return rows;
}

function readPerson(form) {
  const e = form.elements;
  const meals = [...form.querySelectorAll('[name=meal]:checked')].map(x => x.value);
  const n = v => (v === '' ? '' : Number(v));
  const patch = {
    Nazwa: e.Nazwa.value.trim(), Rola: e.Rola.value, Wiek: n(e.Wiek.value), Plec: e.Plec.value,
    Waga_kg: n(e.Waga_kg.value), Wzrost_cm: n(e.Wzrost_cm.value), Aktywnosc: e.Aktywnosc.value, Cel: e.Cel.value,
    Kcal_dzien: n(e.Kcal_dzien.value), Bialko_g_kg: n(e.Bialko_g_kg.value), IG_tryb: e.IG_tryb.value,
    Posilki: meals.join(','), Wykluczenia: e.Wykluczenia.value.trim(), Aktywna: e.Aktywna.checked
  };
  const split = e.Rozklad.value.split(',').map(x => Number(x.trim())).filter(x => x > 0);
  patch.Rozklad = split.length === meals.length ? split.join(',') : '';
  return patch;
}

export async function render(root) {
  const s = getSettings();
  const st = await status();
  if (isConfigured() && !S.boot) { try { await ensureBoot(); } catch { /* offline / błędne połączenie */ } }
  const connected = isConfigured() && S.boot;

  root.innerHTML = `
    <form class="card form" data-conn>
      <h3>Połączenie z arkuszem</h3>
      <label>Adres API (URL wdrożenia Apps Script)
        <input class="input" name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${h(s.url || '')}" required>
      </label>
      <label>Token API
        <input class="input" name="token" type="password" autocomplete="off" value="${h(s.token || '')}" required>
      </label>
      <p class="small muted">Token wygenerujesz w arkuszu: <b>Planer → Administracja → Wygeneruj token API</b>.</p>
      <div class="toolbar">
        <button class="btn">Zapisz i połącz</button>
        <button class="btn ghost" type="button" data-test>Test połączenia</button>
      </div>
    </form>

    ${connected ? `<article class="card">
      <h3>Domownicy</h3>
      <div data-people>${S.boot.osoby.map(personForm).join('')}</div>
      <form class="inline-form" data-add-person>
        <input class="input" name="name" placeholder="Imię nowej osoby" required>
        <select class="input" name="role" style="max-width:8rem"><option>dorosły</option><option>dziecko</option></select>
        <button class="btn ghost">Dodaj</button>
      </form>
    </article>

    <form class="card form" data-integr>
      <h3>Integracje</h3>
      <label>Token Todoist (Ustawienia Todoist → Integracje → Programiści)
        <input class="input" name="todoistToken" type="password" autocomplete="off" placeholder="zostaw puste, by nie zmieniać">
      </label>
      <label>ID projektu Todoist (opcjonalnie)<input class="input" name="todoistProject" data-k="todoistProject"></label>
      <label>ID Kalendarza Google (puste = główny kalendarz)<input class="input" name="calendarId" data-k="calendarId" placeholder="np. rodzina@group.calendar.google.com"></label>
      <p class="small muted" data-integr-status>Sprawdzam…</p>
      <div class="toolbar"><button class="btn">Zapisz integracje</button></div>
    </form>` : ''}

    <article class="card">
      <h3>Synchronizacja</h3>
      <p>${st.online ? 'Online' : 'Offline'} · w kolejce: <b data-queued>${st.queued}</b></p>
      <div class="toolbar">
        <button class="btn ghost" data-flush>Wyślij teraz</button>
        <button class="btn ghost" data-refresh>Odśwież słowniki</button>
        <button class="btn ghost danger" data-clear>Wyczyść pamięć</button>
      </div>
      <p class="small muted">„Wyczyść pamięć” usuwa dane zapisane w telefonie (bez niewysłanych zmian).</p>
    </article>`;

  if (connected) {
    call('integrations').then(i => {
      const el = root.querySelector('[data-integr-status]');
      if (!el) return;
      el.textContent = `Todoist: ${i.todoist ? 'połączony ✓' : 'brak tokenu'} · Kalendarz: ${i.calendarId || 'główny'}`;
      root.querySelector('[data-k=todoistProject]').value = i.todoistProject || '';
      root.querySelector('[data-k=calendarId]').value = i.calendarId || '';
    }).catch(() => {});
  }

  const rerender = async () => { await ensureBoot(true); await render(root); };

  root.onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button:not([type=button])');
    if (f.matches('[data-conn]')) {
      saveSettings({ url: f.url.value, token: f.token.value });
      await busy(btn, async () => {
        const r = await call('ping');
        await ensureBoot(true);
        toast(`Połączono (schemat v${r.schema})`, 'ok');
        location.hash = '#/dzis';
      });
    } else if (f.matches('[data-schedule]')) {
      await busy(btn, async () => {
        await call('setSchedule', { id: f.dataset.schedule, rows: readSchedule(f) });
        toast('Zapisano harmonogram – „Uzupełnij puste” uwzględni go przy nowych posiłkach', 'ok');
        await rerender();
      });
    } else if (f.matches('[data-person]')) {
      await busy(btn, async () => {
        await call('updateProfile', { id: f.dataset.person, patch: readPerson(f) });
        toast('Zapisano profil', 'ok');
        await rerender();
      });
    } else if (f.matches('[data-add-person]')) {
      await busy(btn, async () => {
        const role = f.elements.role.value;
        const kid = role === 'dziecko';
        await call('addProfile', { patch: { Nazwa: f.elements.name.value.trim(), Rola: role, Aktywna: !kid,
          Posilki: kid ? 'Śniadanie,II śniadanie,Obiad,Podwieczorek,Kolacja' : 'Śniadanie,Obiad,Przekąska,Kolacja' } });
        toast(kid ? 'Dodano – uzupełnij wiek i zaznacz „Uwzględniaj w planie”' : 'Dodano osobę', 'ok');
        await rerender();
      });
    } else if (f.matches('[data-integr]')) {
      await busy(btn, async () => {
        const body = { todoistProject: f.todoistProject.value.trim(), calendarId: f.calendarId.value.trim() };
        if (f.todoistToken.value.trim()) body.todoistToken = f.todoistToken.value.trim();
        await call('saveIntegrations', body);
        toast('Zapisano integracje', 'ok');
        await render(root);
      });
    }
  };

  root.onclick = async ev => {
    const auto = ev.target.closest('[data-auto]');
    if (auto) {
      const f = auto.closest('form');
      await busy(auto, async () => {
        const o = await call('updateProfile', { id: f.dataset.person, patch: readPerson(f), auto: true });
        toast(`Ustawiono ${o.Kcal_dzien} kcal`, 'ok');
        await rerender();
      });
      return;
    }
    const b = ev.target.closest('button[data-test], button[data-flush], button[data-refresh], button[data-clear]');
    if (!b) return;
    if (b.dataset.test !== undefined) {
      const f = root.querySelector('[data-conn]');
      saveSettings({ url: f.url.value, token: f.token.value });
      await busy(b, async () => { const r = await call('ping'); toast(`OK · schemat v${r.schema}`, 'ok'); });
    }
    if (b.dataset.flush !== undefined) {
      await busy(b, async () => {
        const failed = await flush();
        const st2 = await status();
        root.querySelector('[data-queued]').textContent = st2.queued;
        toast(st2.queued ? 'Nadal offline – zmiany czekają' : (failed.length ? 'Część zmian odrzucona' : 'Wszystko wysłane'), st2.queued ? 'error' : 'ok');
      });
    }
    if (b.dataset.refresh !== undefined) {
      await busy(b, async () => { await ensureBoot(true); toast('Słowniki odświeżone', 'ok'); });
    }
    if (b.dataset.clear !== undefined) {
      if (!confirm('Usunąć dane zapisane w telefonie? Niewysłane zmiany zostaną zachowane.')) return;
      const keys = await db.keys();
      await Promise.all(keys.filter(k => String(k).startsWith('c:')).map(k => db.del(k)));
      toast('Pamięć wyczyszczona', 'ok');
    }
  };
}
