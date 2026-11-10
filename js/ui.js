// Wspólne elementy interfejsu: toasty, arkusz dolny (bottom sheet), wybór potrawy.
import { S, activeDishes } from './state.js';
import { h, norm, num, fmtNum } from './util.js';

export function toast(msg, type = 'info', ms = 3200) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Arkusz dolny. Zwraca {el, close}. onClose wywoływane przy zamknięciu. */
export function sheet(title, bodyHtml, onClose) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${h(title)}">
      <div class="sheet-head"><h3>${h(title)}</h3><button class="iconbtn" data-close aria-label="Zamknij">✕</button></div>
      <div class="sheet-body">${bodyHtml}</div>
    </div>`;
  const close = () => {
    wrap.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 200);
    onClose && onClose();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  return { el: wrap, close };
}

/** Wybór potrawy (filtrowane po typie posiłku, z wyszukiwarką). Zwraca Promise<ID_Pot|null>. */
export function pickDish(typ, title) {
  return new Promise(resolve => {
    let picked = null;
    let onlyType = !!typ;
    const s = sheet(title || ('Wybierz: ' + (typ || 'potrawa')), `
      <input type="search" class="input" placeholder="Szukaj potrawy…" data-q autocomplete="off">
      ${typ ? `<label class="check small"><input type="checkbox" data-all> Pokaż wszystkie typy posiłków</label>` : ''}
      <ul class="picklist" data-list></ul>`, () => resolve(picked));
    const list = s.el.querySelector('[data-list]');
    const q = s.el.querySelector('[data-q]');

    const draw = () => {
      const needle = norm(q.value);
      const rows = activeDishes(onlyType ? typ : null).filter(p => !needle || norm(p.Nazwa).includes(needle));
      list.innerHTML = rows.length ? rows.map(p => {
        const sum = S.idx.sum[p.ID_Pot] || {};
        return `<li><button data-pick="${h(p.ID_Pot)}">
          <span>${h(p.Nazwa)}</span>
          <small>${fmtNum(num(sum.kcal_100g))} kcal/100 g · ${(S.idx.typyByPot[p.ID_Pot] || []).map(h).join(', ')}</small>
        </button></li>`;
      }).join('') : '<li class="muted pad">Brak pasujących potraw</li>';
    };
    q.addEventListener('input', draw);
    const all = s.el.querySelector('[data-all]');
    if (all) all.addEventListener('change', () => { onlyType = !all.checked; draw(); });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) { picked = b.dataset.pick; s.close(); }
    });
    draw();
    setTimeout(() => q.focus(), 50);
  });
}

/** Menu akcji w arkuszu dolnym. actions: [{id, label, danger?}]. Zwraca Promise<id|null>. */
export function chooseAction(title, actions) {
  return new Promise(resolve => {
    let chosen = null;
    const s = sheet(title, `<div class="actions-list">${actions.map(a =>
      `<button class="btn ${a.danger ? 'danger' : ''}" data-act="${h(a.id)}">${h(a.label)}</button>`).join('')}</div>`,
    () => resolve(chosen));
    s.el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b) { chosen = b.dataset.act; s.close(); }
    });
  });
}

/** Blokuje przycisk na czas operacji i pokazuje błąd jako toast. */
export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'error', 5000); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('busy'); } }
}
