// What the sections of the model page share that needs no page: reading a number typed
// in a field, a labelled field, and how values, levels and lengths are written.
import { el, fixed, sig, together } from '../../kit.js';

// What the map can show and paint, cell by cell.
export const SHOW_PROPS = ['k', 'k22', 'k33', 'ss', 'sy', 'strt', 'top', 'botm', 'idomain', 'rch'];
export const num = (s) => { const t = String(s).trim(); if (t === '') return undefined; const v = Number(t); return Number.isFinite(v) ? v : NaN; };
export const withUnit = (v, u, p = 4) => together(`${sig(v, p)}${u ? ` ${u}` : ''}`);
// Levels and lengths by decimal places: a head of 31.611 m, not 31.61.
export const level = (v) => `${fixed(Math.abs(v) < 5e-4 ? 0 : v, 3)} m`;
export const metres = (v, d = Math.abs(v) >= 100 ? 0 : 2) => `${fixed(v, d)} m`;
export const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { for: input.id }, label), input, hint ? el('span', { class: 'hint' }, hint) : null);
// A value a field would show as typed, 1e-10 or 0.00001, which the page says in powers of ten.
export const tiny = (v) => typeof v === 'number' && v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6);
