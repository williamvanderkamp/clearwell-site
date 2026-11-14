// Number and unit formatting shared by every tool. Nothing here needs a browser, so the
// method text built in the Node tests uses the same functions as the pages.

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** 10 to the power n, written with superscripts: 10⁻⁴. */
export const tenTo = (n) => `10${String(n).replace(/./g, (c) => SUPERSCRIPT[c])}`;

/**
 * x to p significant figures, or n/a. Below 0.001 or from a million up it is written
 * 1.92 × 10⁻⁶, as in a report, with no-break spaces so it never splits across lines.
 * keepZeros keeps trailing zeros (2.00 × 10⁻⁴), so a column carries one precision.
 */
export function sig(x, p = 3, keepZeros = false) {
  if (!Number.isFinite(x)) return 'n/a';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e6) {
    const s = x.toPrecision(p);
    return minus(keepZeros && !s.includes('e') ? s : String(Number(s))); // 1.34e+3 is 1340
  }
  const [m, e] = x.toExponential(p - 1).split('e');
  return minus(`${keepZeros ? m : Number(m)} × ${tenTo(Number(e))}`);
}

/** A unit as people write it: m2/d becomes m²/d, ft3 becomes ft³, deg C becomes °C. */
export const unit = (u) => String(u).replace(/\b(m|cm|mm|ft|in|km)([23])\b/g, (_, l, n) => l + (n === '2' ? '²' : '³')).replace(/\bdeg\s*C\b/g, '°C');

/** A typeset minus sign (U+2212) in place of the hyphen, to match the ⁻ in exponents. */
export const minus = (s) => String(s).replace(/^-/, '−');

// Units and counts that must stay on the line of the number before them.
const UNIT_AFTER = /(\d) (?=(?:m²\/d|m³\/d|ft²\/d|ft³\/d|m\/d|m\/s|ft\/d|mm|cm|m|ft|in|km|d|h|min|s|kPa|hPa|mmHg|°C|%|days?|hours?|minutes?|wells?|readings?|rows?|points?|piezometers?)(?![\p{L}\d²³]))/gu;

/**
 * Prose with no-break spaces where a line must not break: between a number and its
 * unit (738 m, 1731 m²/d, 12 rows) and around the × of 5.2 × 10⁻⁴, as sig() writes it.
 */
export const together = (text) => String(text).replace(/ × (?=10)/g, '\u00a0×\u00a0').replace(UNIT_AFTER, '$1\u00a0');

/** v to d decimal places with a typeset minus, or missing when v is not a number. */
export const fixed = (v, d, missing = 'n/a') => (Number.isFinite(v) ? minus(v.toFixed(d)) : missing);

/** "S", "S and xf", "T, S and xf"; with word 'or', "d10, d50 or d84". */
export const listed = (xs, word = 'and') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`);

/**
 * A correlation to three decimals, so 0.996 is not printed as a perfect 1.00, and one
 * that would round to ±1.000 as "above 0.999".
 */
export const corrText = (c) => (Math.abs(c) >= 0.9995 ? (c > 0 ? 'above 0.999' : 'below −0.999') : fixed(c, 3));

/** A count and its noun: "1 reading", "12 readings", "1 time step", "3 analyses". */
export const countOf = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/**
 * A number in a workbook, to 6 figures, as on the pumping test page; anything else as it
 * is, or as blank.
 */
export const six = (x, blank = x) => (Number.isFinite(x) ? Number(x.toPrecision(6)) : blank);

/** A CSV text from a header row and data rows, as the built-in examples are written. */
export const toCsv = (header, rows) => [header, ...rows].map((r) => r.join(',')).join('\n');
