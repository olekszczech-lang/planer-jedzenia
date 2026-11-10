// Etykiety na pojemniki: arkusz A4 (np. 70×37 mm, 24 szt.) albo pojedyncze 50×30 mm (drukarka etykiet).
// Obrazki PNG 50×30 mm (203 dpi) można udostępnić do aplikacji drukarki (Web Share) albo pobrać.
import { h, fmtNum, parseKey } from './util.js';

export const FORMATS = {
  'a4-70x37': { nazwa: 'Arkusz A4, 24 etykiety 70×37 mm', w: 70, h: 37, cols: 3, rows: 8 },
  'a4-48x25': { nazwa: 'Arkusz A4, 40 etykiet 48,5×25,4 mm', w: 48.5, h: 25.4, cols: 4, rows: 10 },
  'roll-50x30': { nazwa: 'Rolka 50×30 mm (drukarka etykiet)', w: 50, h: 30, cols: 1, rows: 1 }
};

const dShort = k => parseKey(k).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric' });

/** item: {potrawa, osoba, data, typ, gramy, kcal, akcja, zjescDo, dodajPo} */
function labelHtml(it) {
  const icon = it.akcja === 'zamrażarka' ? '❄️' : '🧊';
  return `<div class="lbl">
    <div class="lbl-top"><b>${h(it.osoba)}${/^lunchbox/.test(it.miejsce || '') ? ' · 📦' : ''}</b><span>${icon} ${h(dShort(it.data))} · ${h(it.typ || '')}</span></div>
    <div class="lbl-name">${h(it.potrawa)}</div>
    <div class="lbl-bot"><span>${fmtNum(it.gramy)} g · ${fmtNum(it.kcal)} kcal</span><span>do ${h(dShort(it.zjescDo))}</span></div>
    ${it.dodajPo ? `<div class="lbl-add">+ ${h(it.dodajPo)}</div>` : ''}
  </div>`;
}

/** Otwiera podgląd wydruku (druk systemowy – działa z każdą drukarką, także etykiet przez sterownik). */
export function printLabels(items, formatKey) {
  const f = FORMATS[formatKey] || FORMATS['a4-70x37'];
  const perPage = f.cols * f.rows;
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  const isRoll = formatKey === 'roll-50x30';
  const css = `
    @page { size: ${isRoll ? `${f.w}mm ${f.h}mm` : 'A4'}; margin: ${isRoll ? 0 : '10mm 4mm'}; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 9pt/1.2 system-ui, sans-serif; color: #000; }
    .page { display: grid; grid-template-columns: repeat(${f.cols}, ${f.w}mm); grid-auto-rows: ${f.h}mm; page-break-after: always; justify-content: center; }
    .lbl { padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; ${isRoll ? '' : 'outline: 0.1mm dashed #bbb;'} }
    .lbl-top, .lbl-bot { display: flex; justify-content: space-between; gap: 2mm; font-size: 7.5pt; }
    .lbl-name { font-weight: 700; font-size: ${f.h < 30 ? 8.5 : 10}pt; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
    .lbl-add { font-size: 7pt; }`;
  const w = window.open('', '_blank');
  if (!w) throw new Error('Przeglądarka zablokowała okno wydruku – zezwól na wyskakujące okna.');
  w.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Etykiety</title><style>${css}</style></head><body>
    ${pages.map(p => `<div class="page">${p.map(labelHtml).join('')}</div>`).join('')}
    <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script></body></html>`);
  w.document.close();
}

/** Rysuje etykietę 50×30 mm @203 dpi (400×240 px) – format drukarek termicznych (Niimbot B1, Phomemo). */
export function drawLabel(it) {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 240);
  g.fillStyle = '#000';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillText(it.osoba + (/^lunchbox/.test(it.miejsce || '') ? ' · box' : ''), 16, 40);
  g.font = '24px system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillText((it.akcja === 'zamrażarka' ? '❄ ' : '') + dShort(it.data), 384, 40);
  g.textAlign = 'left';
  g.font = 'bold 32px system-ui, sans-serif';
  const words = String(it.potrawa).split(' ');
  let line = '', y = 92;
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (g.measureText(test).width > 368 && line) { g.fillText(line, 16, y); line = wd; y += 36; if (y > 140) break; }
    else line = test;
  }
  if (y <= 140) g.fillText(line, 16, y);
  g.font = '24px system-ui, sans-serif';
  g.fillText(`${fmtNum(it.gramy)} g · ${fmtNum(it.kcal)} kcal`, 16, 196);
  g.textAlign = 'right';
  g.fillText('do ' + dShort(it.zjescDo), 384, 196);
  g.textAlign = 'left';
  if (it.dodajPo) { g.font = '20px system-ui, sans-serif'; g.fillText('+ ' + it.dodajPo, 16, 226); }
  return c;
}

/** Udostępnia PNG-i do aplikacji drukarki (Android: „Udostępnij → Niimbot/Phomemo”) albo pobiera. */
export async function shareLabelImages(items) {
  const files = await Promise.all(items.map((it, i) => new Promise(res => drawLabel(it).toBlob(b =>
    res(new File([b], `etykieta-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' })), 'image/png'))));
  if (navigator.canShare && navigator.canShare({ files })) {
    await navigator.share({ files, title: 'Etykiety' });
    return 'shared';
  }
  files.forEach(f => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  return 'downloaded';
}
