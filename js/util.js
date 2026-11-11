// Daty jako klucze "yyyy-mm-dd" w czasie lokalnym, formatowanie liczb, escapowanie HTML.

export const APP_VERSION = 'v13';

export const MEALS = ['Śniadanie', 'Obiad', 'Kolacja', 'Przekąska'];

const pad = n => String(n).padStart(2, '0');

export function key(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(k) {
  const [y, m, d] = String(k).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => key(new Date());

export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return key(d);
}

export function mondayOf(k) {
  const d = parseKey(k);
  return addDays(k, -((d.getDay() + 6) % 7));
}

export function isKey(k) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));
}

export function fmtDay(k, long) {
  return parseKey(k).toLocaleDateString('pl-PL', long
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtRange(from, to) {
  const o = { day: 'numeric', month: 'short' };
  return `${parseKey(from).toLocaleDateString('pl-PL', o)} – ${parseKey(to).toLocaleDateString('pl-PL', o)}`;
}

export function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export function fmtNum(n, digits = 0) {
  return Number(n || 0).toLocaleString('pl-PL', { maximumFractionDigits: digits });
}

export function fmtQty(q, unit) {
  q = num(q);
  if ((unit || 'g') === 'g' && q >= 1000) return `${fmtNum(q / 1000, 2)} kg`;
  if (unit === 'ml' && q >= 1000) return `${fmtNum(q / 1000, 2)} l`;
  return `${fmtNum(q, 1)} ${unit || 'g'}`;
}

export const truthy = v => v === true || String(v).toUpperCase() === 'TRUE';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const h = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}
