// Piper and Stiff diagrams as SVG. Colours are read from the page's CSS custom
// properties and written as fill and stroke attributes, since the page policy blocks
// style attributes, and so the downloaded files keep them. The page draws them again
// when the system turns dark or light, and when their width changes.
import { DIAMOND, piperPoint, triangle } from '../../engine/chem.js';
import { sig } from '../kit.js';
import { saveFile } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'IBM Plex Sans, Helvetica, Arial, sans-serif';
const SHAPES = ['circle', 'square', 'triangle', 'diamond'];

function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
}

export function colours() {
  const css = getComputedStyle(document.documentElement), v = (k) => css.getPropertyValue(k).trim();
  return {
    ink: v('--ink'), ink2: v('--ink-2'), rule: v('--rule'), panel: v('--panel'),
    series: ['--series-corrected', '--series-baro', '--series-tide', '--series-constant', '--series-user', '--series-raw'].map(v),
  };
}

/**
 * The light-scheme colours of styles.css, for the SVG and PNG downloads: a figure for a
 * report is drawn on white paper whatever the screen shows.
 */
export const PRINT_COLOURS = {
  ink: '#10222b', ink2: '#47606b', rule: '#d3dee2', panel: '#ffffff',
  series: ['#1e6fc4', '#d9531e', '#128a60', '#c9860a', '#7a4bb0', '#8d9ba3'],
};

const text = (x, y, s, c, extra = {}) => svg('text', { x, y, fill: c, 'font-family': FONT, 'font-size': 12, ...extra }, s);
const line = (p, q, c, w = 1) => svg('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: c, 'stroke-width': w });

/** Marker i: colour cycles first, then shape, so 24 samples get distinct marks. */
export function marker(i, [x, y], c, r = 4.5) {
  const fill = c.series[i % c.series.length], shape = SHAPES[Math.floor(i / c.series.length) % SHAPES.length];
  const at = { fill, stroke: c.panel, 'stroke-width': 1 };
  if (shape === 'circle') return svg('circle', { cx: x, cy: y, r, ...at });
  if (shape === 'square') return svg('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, ...at });
  const pts = shape === 'triangle'
    ? [[x, y - r * 1.2], [x + r * 1.1, y + r * 0.8], [x - r * 1.1, y + r * 0.8]]
    : [[x, y - r * 1.3], [x + r * 1.1, y], [x, y + r * 1.3], [x - r * 1.1, y]];
  return svg('polygon', { points: points(pts), ...at });
}

const points = (pts) => pts.map((p) => p.join(',')).join(' ');
const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
const STEPS = [0.2, 0.4, 0.6, 0.8];

/** Grid lines at 20 % in a triangle [a, b, top]: lines of constant share for each corner. */
function triangleGrid(T, c) {
  const out = [];
  for (const [v, p, q] of [[T[0], T[1], T[2]], [T[1], T[2], T[0]], [T[2], T[0], T[1]]]) {
    for (const f of STEPS) out.push(line(lerp(p, v, f), lerp(q, v, f), c.rule));
  }
  return out;
}

// Text sizes in px. Each diagram is drawn at the width it is shown at, one unit to a
// pixel, so the text stays this size on a phone instead of shrinking with the drawing.
const LABEL = 13, TICK = 11, KEY = 12.5;
// Room around the Piper triangles for the tick numbers, corner names and captions.
const PAD = { left: 30, right: 30, top: 22, bottom: 58 };
const PIPER_MAX = 300;
/** The width a Piper diagram needs at full size, as it is saved. */
export const PIPER_WIDTH = Math.round(2.1 * PIPER_MAX + PAD.left + PAD.right);

/**
 * samples: analysed samples with ok true. width: the width to draw at, in px. The
 * triangles shrink to fit a narrow width but the text does not, and the key to the
 * samples goes under the diagram, in as many columns as fit.
 */
export function piperSvg(samples, c, width = PIPER_WIDTH) {
  const S = Math.max(100, Math.min(PIPER_MAX, (width - PAD.left - PAD.right) / 2.1));
  const [, , top] = DIAMOND;
  const W = Math.max(width, 2.1 * S + PAD.left + PAD.right), x0 = (W - 2.1 * S - PAD.left - PAD.right) / 2;
  const plotH = PAD.top + top[1] * S + PAD.bottom;
  const cols = Math.max(1, Math.floor((W - 20) / 230)), keyRows = Math.ceil(samples.length / cols), rowH = 20;
  const Hgt = Math.round(plotH + 10 + keyRows * rowH + 10);
  const P = ([x, y]) => [x0 + PAD.left + x * S, PAD.top + (top[1] - y) * S];
  const root = svg('svg', { xmlns: NS, viewBox: `0 0 ${W} ${Hgt}`, width: W, height: Hgt, role: 'img', 'aria-label': 'Piper diagram' });
  root.append(svg('rect', { x: 0, y: 0, width: W, height: Hgt, fill: c.panel }));
  const cat = triangle('cation').map(P), an = triangle('anion').map(P), dia = DIAMOND.map(P);
  root.append(...triangleGrid(cat, c), ...triangleGrid(an, c));
  for (const f of STEPS) {
    root.append(line(lerp(dia[0], dia[1], f), lerp(dia[3], dia[2], f), c.rule), line(lerp(dia[0], dia[3], f), lerp(dia[1], dia[2], f), c.rule));
  }
  const outline = (pts) => svg('polygon', { points: points(pts), fill: 'none', stroke: c.ink2, 'stroke-width': 1.5 });
  root.append(outline(cat), outline(an), outline(dia));
  const small = { 'font-size': TICK, 'text-anchor': 'middle' };
  STEPS.forEach((f) => {
    const n = String(Math.round(f * 100));
    let p = lerp(cat[1], cat[0], f); root.append(text(p[0], p[1] + 14, n, c.ink2, small));
    p = lerp(cat[0], cat[2], f); root.append(text(p[0] - 12, p[1] + 4, n, c.ink2, small));
    p = lerp(an[0], an[1], f); root.append(text(p[0], p[1] + 14, n, c.ink2, small));
    p = lerp(an[1], an[2], f); root.append(text(p[0] + 12, p[1] + 4, n, c.ink2, small));
    p = lerp(dia[1], dia[2], f); root.append(text(p[0] - 12, p[1] - 2, n, c.ink2, small));
    p = lerp(dia[3], dia[2], f); root.append(text(p[0] + 12, p[1] - 2, n, c.ink2, small));
  });
  const label = (p, s, extra) => root.append(text(p[0], p[1], s, c.ink, { 'font-size': LABEL, 'font-weight': 600, 'text-anchor': 'middle', ...extra }));
  label([cat[0][0], cat[0][1] + 32], 'Ca', { 'text-anchor': 'start' });
  label([cat[1][0], cat[1][1] + 32], 'Na+K', { 'text-anchor': 'end' });
  // Mg and SO4 sit beside the apex, clear of the diamond's lower corners.
  label([cat[2][0] - 6, cat[2][1] - 2], 'Mg', { 'text-anchor': 'end' });
  label([an[0][0], an[0][1] + 32], 'HCO3+CO3', { 'text-anchor': 'start' });
  label([an[1][0], an[1][1] + 32], 'Cl', { 'text-anchor': 'end' });
  label([an[2][0] + 6, an[2][1] - 2], 'SO4', { 'text-anchor': 'start' });
  const mid = (p, q, dx, dy) => [(p[0] + q[0]) / 2 + dx, (p[1] + q[1]) / 2 + dy];
  // Beyond the tick numbers on the diamond's upper sides.
  // 7 px further out than the tick numbers' own reach, so the titles never touch 40 and 60.
  let m = mid(dia[1], dia[2], -37, -21); label(m, 'SO4+Cl', { transform: `rotate(-60 ${m[0]} ${m[1]})` });
  m = mid(dia[2], dia[3], 37, -21); label(m, 'Ca+Mg', { transform: `rotate(60 ${m[0]} ${m[1]})` });
  const wide = S >= 200;
  label([(cat[0][0] + cat[1][0]) / 2, cat[0][1] + 50], wide ? 'Cations, percent of meq/L' : 'Cations, %');
  label([(an[0][0] + an[1][0]) / 2, an[0][1] + 50], wide ? 'Anions, percent of meq/L' : 'Anions, %');
  const r = wide ? 4.5 : 3.8;
  samples.forEach((s, i) => {
    const p = piperPoint(s.pct);
    root.append(marker(i, P(p.cation), c, r), marker(i, P(p.anion), c, r), marker(i, P(p.diamond), c, r));
  });
  // The key: numbered by data row, as in the table, filled down each column.
  const colW = (W - 20) / cols, chars = Math.max(8, Math.floor((colW - 40) / 6.6));
  samples.forEach((s, i) => {
    const x = 10 + Math.floor(i / keyRows) * colW, y = plotH + 10 + (i % keyRows) * rowH + 14;
    root.append(marker(i, [x + 6, y - 4], c), text(x + 18, y, `${s.row ?? i + 1}. ${clip(s.name, chars)}`, c.ink, { 'font-size': KEY }));
  });
  return root;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const STIFF_ROWS = [['Na+K', 'Cl'], ['Ca', 'HCO3+CO3'], ['Mg', 'SO4']];
const stiffValues = (s) => [[s.meq.Na + s.meq.K, s.meq.Cl], [s.meq.Ca, s.carbonate], [s.meq.Mg, s.meq.SO4]];

/** Largest single value on any Stiff axis, in meq/L: the common scale. */
export const stiffMax = (samples) => Math.max(...samples.flatMap((s) => stiffValues(s).flat()));

/** The width two Stiff patterns to a row take, as they are saved. */
export const STIFF_WIDTH = 680;

/**
 * One Stiff (1951) pattern per sample, all on the same scale, as many to a row as fit
 * the width (in px): one on a phone, two or three on a wider screen.
 */
export function stiffSvg(samples, c, width = STIFF_WIDTH) {
  const W = Math.max(280, width), cols = Math.max(1, Math.min(3, Math.floor(W / 320)));
  const cellW = W / cols, cellH = 150, room = 72, half = Math.min(100, (cellW - 2 * room) / 2), max = stiffMax(samples);
  const Hgt = Math.ceil(samples.length / cols) * cellH + 10;
  const root = svg('svg', { xmlns: NS, viewBox: `0 0 ${W} ${Hgt}`, width: W, height: Hgt, role: 'img', 'aria-label': 'Stiff diagrams' });
  root.append(svg('rect', { x: 0, y: 0, width: W, height: Hgt, fill: c.panel }));
  const chars = Math.max(10, Math.floor((cellW - 20) / 7.4));
  samples.forEach((s, i) => {
    const x0 = (i % cols) * cellW, y0 = Math.floor(i / cols) * cellH, cx = x0 + cellW / 2;
    const ys = [y0 + 44, y0 + 76, y0 + 108], v = stiffValues(s), k = half / max;
    const pts = [...v.map(([cat], r) => [cx - cat * k, ys[r]]), ...v.map(([, an], r) => [cx + an * k, ys[r]]).reverse()];
    root.append(text(x0 + 10, y0 + 20, `${s.row ?? i + 1}. ${clip(s.name, chars)}`, c.ink, { 'font-size': LABEL, 'font-weight': 600 }));
    ys.forEach((y, r) => {
      root.append(line([cx - half, y], [cx + half, y], c.rule));
      // 10 px clear of the scale's ends, so a full-scale vertex never touches its label.
      root.append(
        text(cx - half - 10, y + 4, STIFF_ROWS[r][0], c.ink2, { 'font-size': TICK, 'text-anchor': 'end' }),
        text(cx + half + 10, y + 4, STIFF_ROWS[r][1], c.ink2, { 'font-size': TICK }));
    });
    root.append(svg('polygon', { points: points(pts), fill: c.series[0], 'fill-opacity': 0.35, stroke: c.series[0], 'stroke-width': 1.5 }));
    root.append(line([cx, ys[0] - 8], [cx, ys[2] + 8], c.ink2));
    const tick = { 'font-size': TICK, 'text-anchor': 'middle' }, below = ys[2] + 24;
    root.append(
      text(cx - half, below, sig(max), c.ink2, tick), text(cx, below, '0', c.ink2, tick), text(cx + half, below, sig(max), c.ink2, tick),
      text(cx + half + 18, below, 'meq/L', c.ink2, { 'font-size': TICK }));
  });
  return root;
}

const svgText = (root) => `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`;

export function saveSvg(root, name) {
  saveFile(name, new Blob([svgText(root)], { type: 'image/svg+xml' }));
}

/** Draws the SVG on a canvas at twice its size and saves it as PNG. */
export function savePng(root, name) {
  const [, , w, h] = root.getAttribute('viewBox').split(' ').map(Number);
  const url = URL.createObjectURL(new Blob([svgText(root)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w * 2; canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => saveFile(name, b), 'image/png');
  };
  img.src = url;
}
