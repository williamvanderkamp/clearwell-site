// How pumping test numbers are shown, and the tables the page and workbook share.
import { theisCurve } from '../engine/index.js';
import { figures } from './method-text.js';
import { fixed, sig } from '../engine/format.js';

const FT2 = 0.3048 ** 2;
export const tUnit = (m) => (m.lengthUnit === 'ft' ? 'ft²/d' : 'm²/d');
export const shownT = (T, m) => (m.lengthUnit === 'ft' ? T / FT2 : T);

/**
 * A time in days, in the unit a person would say. Minutes have 3 significant figures,
 * so a window edge of 13.1 min or a t0 of 0.253 min reads as the number it is.
 */
export function durationText(days) {
  const min = days * 1440;
  if (min < 120) return `${sig(min, 3)} min`;
  if (days < 2) return `${(min / 60).toFixed(1)} h`;
  return `${days.toFixed(1)} d`;
}

export const fitLabel = (f) => `${durationText(f.from)} to ${durationText(f.to)}, ${f.rows} points`;

// T and S to 3 significant figures on the page.
const FIGURES = 3;
const full = (v) => (Number.isFinite(v) ? v : null);

/**
 * One row per method, as numbers at full precision, so the workbook keeps them as
 * numbers that can be worked with. The page rounds them in resultCells(). The raw T
 * column is there only when something was removed, since otherwise it is the same.
 */
export function resultRows(r) {
  const m = r.method, a = r.analysis, b = r.rawAnalysis;
  const T = (x) => (x ? full(shownT(x.T, m)) : null);
  const row = (label, fit, raw, S) => (fit ? [label, T(fit), ...(b ? [T(raw)] : []), Number.isFinite(S) ? S : null, fitLabel(fit)] : null);
  return [
    row('Theis curve', a.theis, b && b.theis, a.theis && a.theis.S),
    row('Cooper and Jacob line', a.line, b && b.line, a.line && a.line.S),
    row("Theis recovery line (over t')", a.recovery, b && b.recovery),
    row('Line through extended drawdown', a.extended && a.extended.line, b && b.extended && b.extended.line),
  ].filter(Boolean);
}

export const resultHeader = (r) => (r.rawAnalysis
  ? ['Method', `T, corrected (${tUnit(r.method)})`, `T, raw (${tUnit(r.method)})`, 'S', 'Fitted over']
  : ['Method', `T (${tUnit(r.method)})`, 'S', 'Fitted over']);

/**
 * The same rows as text for the page, to 3 significant figures. S keeps its trailing
 * zeros, so 2.00 × 10⁻⁴ sits beside 1.94 × 10⁻⁴ at the same precision. A dash means
 * the method gives no value.
 */
export const resultCells = (r) => resultRows(r).map((row) => row.map((v, i) => {
  if (v === null) return '—';
  if (typeof v !== 'number') return v;
  return figures(v, FIGURES, i === row.length - 2);
}));

/** A drawdown to the millimetre, with a typeset minus when it is below zero. */
export const reachText = (v) => fixed(v, 3, '—');

/**
 * Drawdown at the last extended point, against the standard methods carried forward
 * from the pumping data alone. Null when there is no extended drawdown.
 */
export function extendedReach(r) {
  const m = r.method, a = r.analysis, e = a.extended, L = m.lengthToM;
  if (!e || !e.t.length) return null;
  const at = e.t[e.t.length - 1], reached = e.y[e.y.length - 1] / L;
  const num = (v) => Number(v.toFixed(3));
  const carried = (label, s) => [label, num(s / L), num(s / L - reached)];
  const rows = [['Extended drawdown, from recovery', num(reached), null]];
  if (a.line) rows.push(carried('Cooper and Jacob line, carried forward', a.line.slope * Math.log10(at) + a.line.intercept));
  if (a.theis) rows.push(carried('Theis curve, carried forward', theisCurve(a.theis, [at])[0]));
  return { at, header: ['Method', `Drawdown at ${durationText(at)} (${m.lengthUnit})`, `Difference from extended (${m.lengthUnit})`], rows };
}

/** The averaged curves, in the file's length unit and minutes. */
export function curveRows(r, theis) {
  const m = r.method, a = r.analysis, L = m.lengthToM;
  const rows = a.pump.t.map((t, i) => [t * 1440, 'pumping', a.pump.y[i] / L, a.derivative[i] / L, theis ? theis[i] / L : null]);
  if (a.extended) a.extended.t.forEach((t, i) => rows.push([t * 1440, 'extended', a.extended.y[i] / L, null, null]));
  return rows;
}

export const curveHeader = (r) => {
  const u = r.method.lengthUnit;
  return ['Minutes since pumping began', 'Part', `Drawdown (${u})`, `Log derivative (${u})`, `Theis curve (${u})`];
};
