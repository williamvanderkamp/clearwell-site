// Pumping test analysis, in order:
//   1. Background effects are fitted on the record before pumping starts, using the
//      standard correction, and removed from the whole record.
//   2. Drawdown is measured from the static level just before pumping.
//   3. Theis (1935) curve fit, and the Cooper and Jacob (1946) straight line.
//   4. Theis (1935) recovery line.
//   5. Extended drawdown from the recovery data (van der Kamp 1989; Neville and van
//      der Kamp 2012), which assumes only superposition and a constant rate.
// Everything here is metres and days unless a name says otherwise.

import { correct, LAG_HOURS } from './correct.js';
import { DAY, EULER, fitLine, goldenMin, HOUR, isNum, mean, median, rms } from './numeric.js';
import { orderRows, prepare, isMissingCode } from './prepare.js';
import { RATE_UNITS, UNITS } from './units.js';
import * as libm from './libm.js';

const LN10 = Math.LN10;

// Below this much record before pumping, nothing is fitted.
export const MIN_PRETEST_DAYS = 1;
// From here the full response function is fitted. On less, a constant efficiency is
// used, because the many lag coefficients cost more than they gain on a short fit.
export const RESPONSE_PRETEST_DAYS = 14;
// The practical limit for the straight line methods (Kruseman and de Ridder 1994, 3.2.2).
export const STRAIGHT_LINE_U = 0.1;
const BINS_PER_DECADE = 20;
const DERIVATIVE_L = 0.2; // log cycles either side
const MIN_LINE_POINTS = 4;
// Residual drawdown smaller than this many times the pre-pumping scatter is not used.
const RESIDUAL_NOISE_RATIO = 3;
// Share of the drawdown at shut-off taken to be a real break in the extended curve.
const SHIFT_LIMIT = 0.02;
// A straight barrier doubles the slope. Beyond that, or below half, the extended curve is
// doing something the end of pumping gave no sign of.
const SLOPE_LIMIT = 2;
// Ratio of late to early slope beyond which drawdown against log time is not a straight line.
const BEND_LIMIT = 1.25;

/** The Theis well function W(u), also written E1(u). */
export function wellFunction(u) {
  if (!(u > 0)) return Infinity;
  if (u <= 1) {
    let sum = -EULER - libm.log(u), term = 1;
    for (let n = 1; n < 40; n++) {
      term *= -u / n;
      sum -= term / n;
      if (Math.abs(term) < 1e-17) break;
    }
    return sum;
  }
  // Continued fraction, by the modified Lentz method.
  let b = u + 1, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 200; i++) {
    const a = -i * i;
    b += 2;
    d = 1 / (a * d + b);
    c = b + a / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * libm.exp(-u);
}

/** Averages points into equal widths of log time, so each log cycle counts the same. */
export function logBins(t, y, perDecade = BINS_PER_DECADE) {
  const groups = new Map();
  for (let i = 0; i < t.length; i++) {
    if (!(t[i] > 0) || !isNum(y[i])) continue;
    const k = Math.floor(libm.log10(t[i]) * perDecade + 1e-9);
    if (!groups.has(k)) groups.set(k, { lt: 0, y: 0, n: 0 });
    const g = groups.get(k);
    g.lt += libm.log(t[i]); g.y += y[i]; g.n++;
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  return {
    t: keys.map((k) => libm.exp(groups.get(k).lt / groups.get(k).n)),
    y: keys.map((k) => groups.get(k).y / groups.get(k).n),
    n: keys.map((k) => groups.get(k).n),
  };
}

/**
 * Least squares fit of the Theis curve. For a given r2S/4T the best Q/4piT is a plain
 * ratio, so only one number has to be searched for.
 * t: days, s: drawdown in m, Q: m3/d. r in m, or undefined, which gives T alone.
 */
export function fitTheis(t, s, Q, r) {
  let ss = 0;
  for (let i = 0; i < t.length; i++) ss += s[i] * s[i];
  // W is divided by its largest value before squaring. Above u of about 370, W squared is
  // below the smallest double and becomes 0, which made the error minus infinity.
  const sse = (a) => {
    const w = t.map((x) => wellFunction(a / x));
    let m = 0;
    for (const x of w) if (x > m) m = x;
    if (!(m > 0 && m < Infinity)) return { c: NaN, e: ss };
    let sw = 0, ww = 0;
    for (let i = 0; i < t.length; i++) {
      const x = w[i] / m;
      sw += s[i] * x; ww += x * x;
    }
    return { c: sw / ww / m, e: ss - sw * sw / ww };
  };
  const tMin = Math.min(...t), tMax = Math.max(...t);
  let lo = libm.log(tMin * 1e-4), hi = libm.log(tMax * 1e4);
  let best = lo, bestE = Infinity;
  const STEPS = 240;
  for (let i = 0; i <= STEPS; i++) {
    const x = lo + (hi - lo) * i / STEPS, e = sse(libm.exp(x)).e;
    if (e < bestE) { bestE = e; best = x; }
  }
  const width = (hi - lo) / STEPS;
  const a = libm.exp(goldenMin((x) => sse(libm.exp(x)).e, best - width, best + width, 80));
  const { c, e } = sse(a);
  const T = Q / (4 * Math.PI * c);
  return { T, S: isNum(r) ? 4 * T * a / (r * r) : NaN, a, c, rmse: Math.sqrt(Math.max(e, 0) / t.length), rows: t.length };
}

/** Theis drawdown, from a fit. */
export const theisCurve = (fit, t) => t.map((x) => fit.c * wellFunction(fit.a / x));

/**
 * Cooper and Jacob straight line through s against log10 t.
 * Slope is the drawdown per log cycle, and t0 is where the line reaches zero drawdown.
 */
export function fitSemilog(t, s, Q, r) {
  const line = fitLine(t.map(libm.log10), s);
  const T = LN10 * Q / (4 * Math.PI * line.slope);
  const t0 = libm.pow(10, -line.intercept / line.slope);
  return { T, S: isNum(r) ? 2.25 * T * t0 / (r * r) : NaN, slope: line.slope, intercept: line.intercept, t0, rows: line.rows };
}

// Slopes of the two halves of a line, in log time. A straight line has one slope.
function bendOf(t, s) {
  const mid = (libm.log10(t[0]) + libm.log10(t[t.length - 1])) / 2;
  const half = (keep) => {
    const use = t.map((_, i) => i).filter((i) => keep(libm.log10(t[i])));
    return use.length >= MIN_LINE_POINTS ? fitLine(use.map((i) => libm.log10(t[i])), use.map((i) => s[i])).slope : NaN;
  };
  const early = half((x) => x <= mid), late = half((x) => x > mid);
  return isNum(early) && isNum(late) ? { early, late, ratio: late / early } : null;
}

/**
 * Theis recovery line through residual drawdown against log10(t/t').
 * ratio0 is t/t' at zero residual drawdown. It should be close to 1.
 */
export function fitRecovery(tp, tr, s, Q) {
  const line = fitLine(tr.map((x) => libm.log10((tp + x) / x)), s);
  return {
    T: LN10 * Q / (4 * Math.PI * line.slope), slope: line.slope, intercept: line.intercept,
    ratio0: libm.pow(10, -line.intercept / line.slope), rows: line.rows,
  };
}

/**
 * Drawdown that would have continued had pumping not stopped:
 *   s1(t) = s(t) + s1(t - toff), for t > toff
 * s1 at the earlier time is read from the pumping curve and, past two pumping periods,
 * from this same series (van der Kamp, Grunsky and Wei 2021, equation 4b).
 * pump: { t, y } measured drawdown, sorted. recovery: { t, y } residual drawdown
 * against time since pumping stopped, sorted.
 */
export function extendedDrawdown(pump, recovery, toff, minResidual = 0) {
  const lx = pump.t.map(libm.log), ly = pump.y.slice();
  const at = (t) => {
    const x = libm.log(t);
    if (x < lx[0]) return NaN;
    let hi = lx.length - 1;
    if (x >= lx[hi]) return ly[hi];
    let lo = 0;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lx[mid] <= x) lo = mid; else hi = mid; }
    return ly[lo] + (ly[hi] - ly[lo]) * (x - lx[lo]) / (lx[hi] - lx[lo]);
  };
  const t = [], y = [], since = [];
  for (let i = 0; i < recovery.t.length; i++) {
    const tr = recovery.t[i];
    if (Math.abs(recovery.y[i]) < minResidual) break;
    const earlier = at(tr);
    if (!isNum(earlier)) continue;
    const when = toff + tr, value = recovery.y[i] + earlier;
    t.push(when); y.push(value); since.push(tr);
    lx.push(libm.log(when)); ly.push(value);
  }
  return { t, y, since };
}

/** Bourdet derivative of s with respect to ln t, on log-spaced points. */
export function bourdetDerivative(t, s, L = DERIVATIVE_L) {
  const x = t.map(libm.log), width = L * LN10, n = t.length;
  return t.map((_, i) => {
    let j = i, k = i;
    while (j > 0 && x[i] - x[j] < width) j--;
    while (k < n - 1 && x[k] - x[i] < width) k++;
    if (x[i] - x[j] < width || x[k] - x[i] < width) return NaN;
    const a = x[i] - x[j], b = x[k] - x[i];
    return ((s[i] - s[j]) / a) * (b / (a + b)) + ((s[k] - s[i]) / b) * (a / (a + b));
  });
}

// A smooth curve runs straight through shut-off and keeps climbing, because it stands for
// pumping that never stopped. A jump, or a curve that falls, means the assumptions failed
// (van der Kamp, Grunsky and Wei 2021). The median keeps the short spike those authors
// saw at the very start of recovery from counting as a jump.
function transitionCheck(pump, ext, toff, noise, extSlope) {
  const before = pump.t.map((_, i) => i).filter((i) => pump.t[i] >= toff / 2);
  const after = ext.t.map((_, i) => i).filter((i) => ext.t[i] <= toff * 1.25);
  if (before.length < 3 || after.length < 3) return null;
  const line = fitLine(before.map((i) => libm.log10(pump.t[i])), before.map((i) => pump.y[i]));
  const expected = (t) => line.slope * libm.log10(t) + line.intercept;
  const atOff = expected(toff);
  const shift = median(after.map((i) => ext.y[i] - expected(ext.t[i])));
  const limit = Math.max(SHIFT_LIMIT * Math.abs(atOff), noise);
  const rising = extSlope > 0 && line.slope > 0;
  return {
    shift, atOff, share: shift / atOff, ok: Math.abs(shift) <= limit, limit: limit / Math.abs(atOff),
    falling: extSlope <= 0, slopeRatio: rising ? extSlope / line.slope : NaN,
  };
}

function straightLineFrom(u, fit, r) {
  return isNum(fit.S) && fit.S > 0 && fit.T > 0 ? (r * r * fit.S) / (4 * fit.T * u) : NaN;
}

/**
 * Runs every analysis on one drawdown series.
 * series: { t: days since pumping began, s: drawdown in m }
 * test: { Q, r, pumpedWell, toff (days, or undefined), fitFrom, fitTo, minResidual }
 */
export function analyzeDrawdown(series, test) {
  const { Q, r, pumpedWell, toff, fitFrom, fitTo, minResidual = 0 } = test;
  const hasR = isNum(r) && r > 0 && !pumpedWell;
  const inPump = series.t.map((t) => t > 0 && (!isNum(toff) || t <= toff));
  const pump = logBins(series.t.filter((_, i) => inPump[i]), series.s.filter((_, i) => inPump[i]));
  if (pump.t.length < MIN_LINE_POINTS) throw new Error('There are too few drawdown readings during pumping to analyze. Check the pumping start and stop.');
  const out = { pump, derivative: bourdetDerivative(pump.t, pump.y) };
  const lastT = pump.t[pump.t.length - 1];
  // A bin's time is the mean of its log times, so a bin holding one reading at exactly
  // the edge of the window can come back a hair outside it (exp(ln 1.4) < 1.4). The
  // window edges are widened by that rounding, so "Fit from 1.4" keeps the 1.4 reading.
  const pick = (from, to) => pump.t.map((_, i) => i).filter((i) => pump.t[i] >= from * (1 - 1e-12) && pump.t[i] <= to * (1 + 1e-12));
  const userFrom = isNum(fitFrom) ? fitFrom : 0, userTo = isNum(fitTo) ? fitTo : Infinity;

  // Theis needs early data, which a pumped well's casing and well losses spoil.
  if (hasR) {
    const use = pick(userFrom, userTo).filter((i) => pump.y[i] > 0);
    if (use.length >= MIN_LINE_POINTS) {
      out.theis = { ...fitTheis(use.map((i) => pump.t[i]), use.map((i) => pump.y[i]), Q, r), from: pump.t[use[0]], to: pump.t[use[use.length - 1]] };
    }
  }

  // The line starts where u is small enough, which depends on the answer, so a few
  // passes settle it. With no distance, the last log cycle of pumping is used.
  const lineOn = (from) => {
    const use = pick(from, userTo);
    if (use.length < MIN_LINE_POINTS) return null;
    const tt = use.map((i) => pump.t[i]), ss = use.map((i) => pump.y[i]);
    return { ...fitSemilog(tt, ss, Q, hasR ? r : undefined), from: tt[0], to: tt[tt.length - 1], bend: bendOf(tt, ss) };
  };
  if (isNum(fitFrom)) out.line = lineOn(fitFrom);
  else if (hasR && out.theis) {
    let from = straightLineFrom(STRAIGHT_LINE_U, out.theis, r);
    for (let i = 0; i < 5 && isNum(from); i++) {
      const line = lineOn(from);
      if (!line) break;
      out.line = line;
      from = straightLineFrom(STRAIGHT_LINE_U, line, r);
    }
  } else out.line = lineOn(lastT / 10);
  const uLimit = out.line && hasR ? straightLineFrom(STRAIGHT_LINE_U, out.line, r) : NaN;

  if (isNum(toff)) {
    const since = [], residual = [];
    series.t.forEach((t, i) => { if (t > toff && isNum(series.s[i])) { since.push(t - toff); residual.push(series.s[i]); } });
    const rec = logBins(since, residual);
    out.recoveryBins = rec;
    if (rec.t.length) {
      const lastR = rec.t[rec.t.length - 1];
      const from = isNum(uLimit) ? uLimit : lastR / 10;
      const use = rec.t.map((_, i) => i).filter((i) => rec.t[i] >= from && rec.y[i] > minResidual);
      if (use.length >= MIN_LINE_POINTS) {
        out.recovery = { ...fitRecovery(toff, use.map((i) => rec.t[i]), use.map((i) => rec.y[i]), Q), from: rec.t[use[0]], to: rec.t[use[use.length - 1]] };
      }
      const ext = extendedDrawdown(pump, rec, toff, minResidual);
      const line = ext.t.length >= MIN_LINE_POINTS ? fitSemilog(ext.t, ext.y, Q) : null;
      out.extended = { ...ext, check: transitionCheck(pump, ext, toff, minResidual, line ? line.slope : NaN), derivative: null };
      // A falling curve has no transmissivity to report.
      if (line) {
        const T = line.slope > 0 ? line.T : NaN;
        out.extended.line = { T, slope: line.slope, intercept: line.intercept, rows: line.rows, from: ext.t[0], to: ext.t[ext.t.length - 1] };
      }
    }
  }
  return out;
}

/**
 * Likely pumping start and stop: the sharpest fall in the level, then the sharpest rise.
 * A distant well recovers too gently for one step to stand out, so if the level climbed
 * well back from its lowest point, the stop is taken as that lowest point.
 */
export function detectPumping(t, h) {
  const rows = t.map((_, i) => i).filter((i) => isNum(t[i]) && isNum(h[i]));
  if (rows.length < 4) return {};
  rows.sort((a, b) => t[a] - t[b]);
  let start = -1, fall = 0;
  for (let k = 1; k < rows.length; k++) {
    const d = h[rows[k - 1]] - h[rows[k]];
    if (d > fall) { fall = d; start = k; }
  }
  if (start < 0) return {};
  let stop = -1, rise = 0, lowest = Infinity, bottom = start;
  for (let k = start; k < rows.length; k++) {
    if (h[rows[k]] < lowest) { lowest = h[rows[k]]; bottom = k; }
    if (k > start) {
      const d = h[rows[k]] - h[rows[k - 1]];
      if (d > rise) { rise = d; stop = k; }
    }
  }
  const depth = h[rows[start - 1]] - lowest;
  const sharp = stop > 0 && rise >= 0.25 * depth;
  const climbed = h[rows[rows.length - 1]] - lowest >= 0.25 * depth;
  return { start: t[rows[start - 1]], stop: sharp ? t[rows[stop - 1]] : climbed ? t[rows[bottom]] : undefined };
}

// Water level rows in metres, up positive, with no barometer involved.
function plainRows(input, sign, lu) {
  const rows = orderRows({ ...input, baro: input.t.map(() => NaN) });
  const h = rows.level.map((x) => (isMissingCode(x) ? NaN : sign * x * lu));
  return {
    t: rows.t, srcRow: rows.srcRow, h, baro: null,
    flags: rows.level.map((x) => (isMissingCode(x) ? 'level fill code' : '')),
    counts: { untimed: rows.untimed, duplicates: rows.duplicates, levelCodes: rows.level.filter(isMissingCode).length },
  };
}

// Line through the corrected level before pumping. Its scatter is the noise floor.
function pretestLine(t, h, start) {
  const use = t.map((_, i) => i).filter((i) => t[i] < start && isNum(h[i]));
  if (use.length < 3 || start - t[use[0]] < MIN_PRETEST_DAYS * DAY) return null;
  const line = fitLine(use.map((i) => (t[i] - start) / DAY), use.map((i) => h[i]));
  const scatter = rms(use.map((i) => h[i] - line.slope * (t[i] - start) / DAY - line.intercept));
  return { perDay: line.slope, scatter, rows: use.length };
}

function background(prep, input, o, pretestDays) {
  const { h, baro } = prep;
  if (!baro) return { mode: 'none', reason: 'no-barometer', h, baroEffect: null, tideEffect: null };
  const toM = (x) => (isNum(x) ? prep.sign * x * prep.levelToM : NaN);
  if (isNum(o.userBE)) {
    const p = mean(baro);
    const baroEffect = baro.map((x) => (isNum(x) ? -o.userBE * (x - p) : NaN));
    return { mode: 'user', be: o.userBE, h: h.map((x, i) => x - baroEffect[i]), baroEffect, tideEffect: null };
  }
  if (pretestDays < MIN_PRETEST_DAYS) return { mode: 'none', reason: 'pretest-too-short', h, baroEffect: null, tideEffect: null };

  const full = pretestDays >= RESPONSE_PRETEST_DAYS;
  // Levels from the start of pumping are blanked, so no part of the fit can see them.
  const before = { ...input, level: input.level.map((x, i) => (input.t[i] < o.pumpStart ? x : NaN)) };
  const fit = correct(before, {
    ...o, fitStart: undefined, fitEnd: o.pumpStart,
    lagHours: full ? LAG_HOURS : 0, tide: full ? 'auto' : 'off', userBE: undefined,
  });
  const m = fit.method;
  if (!full) {
    const baroEffect = fit.constant.effect.map(toM);
    return {
      mode: 'constant', be: m.constant.be, range: m.constant.range, rows: m.constant.rows, explained: m.constantExplained,
      h: h.map((x, i) => x - baroEffect[i]), baroEffect, tideEffect: null, notes: [],
    };
  }
  const baroEffect = fit.standard.baroEffect.map(toM), tideEffect = fit.standard.tideEffect.map(toM);
  return {
    mode: 'response', be: m.be, range: m.beRange, rows: m.fitRows, explained: m.explained, lagHours: m.lagHours, stepResponse: m.stepResponse, tide: m.tide,
    h: h.map((x, i) => x - baroEffect[i] - tideEffect[i]), baroEffect, tideEffect,
    notes: fit.warnings.filter((w) => !/spikes were left out|have no corrected value/.test(w)),
  };
}

/**
 * input: { t: ms[], level: number[], baro?: number[] }
 * opts:  { levelKind: 'head'|'depth'|'absolute'|'drawdown', levelUnit, baroUnit,
 *          pumpStart: ms, pumpStop?: ms, rate, rateUnit, distance?, distanceUnit?,
 *          pumpedWell?, userBE?, lat?, lon?, utcOffsetHours?, staticLevel?,
 *          removeTrend?, fitFromMin?, fitToMin?, elapsed? }
 * elapsed says the times count from the start of the test and are not dates.
 */
export function pumpingTest(input, opts) {
  const o = opts;
  const lu = UNITS[o.levelUnit], Q = o.rate * RATE_UNITS[o.rateUnit];
  if (!['head', 'depth', 'absolute', 'drawdown'].includes(o.levelKind)) throw new Error('Say whether the water level is a height, a depth, an absolute pressure or drawdown.');
  if (!lu) throw new Error(`Unknown unit: ${o.levelUnit}`);
  if (!RATE_UNITS[o.rateUnit]) throw new Error(`Unknown rate unit: ${o.rateUnit}`);
  if (isNum(o.distance) && !UNITS[o.distanceUnit]) throw new Error(`Unknown distance unit: ${o.distanceUnit}`);
  if (!isNum(o.rate)) throw new Error('Enter the pumping rate. Transmissivity scales directly with it.');
  if (!(Q > 0)) throw new Error('The pumping rate must be above zero.');
  if (isNum(o.distance) && !o.pumpedWell && !(o.distance > 0)) throw new Error('The distance from the pumped well must be above zero.');
  if (isNum(o.fitFromMin) && o.fitFromMin < 0) throw new Error('The fit window must start at zero minutes or later.');
  if (isNum(o.fitFromMin) && isNum(o.fitToMin) && o.fitToMin <= o.fitFromMin) throw new Error('The fit window must end after it starts.');
  if (!isNum(o.pumpStart)) throw new Error('Enter when pumping started.');
  if (isNum(o.pumpStop) && o.pumpStop <= o.pumpStart) throw new Error('Pumping must stop after it starts.');
  const hasBaro = Boolean(input.baro && input.baro.some(isNum));
  if (o.levelKind === 'absolute' && !hasBaro) throw new Error('A sensor reading absolute pressure needs a barometer column.');

  const given = o.levelKind === 'drawdown';
  const kind = given ? 'depth' : o.levelKind;
  const sign = kind === 'depth' ? -1 : 1;
  const prep = hasBaro ? prepare(input, { ...o, levelKind: kind }) : plainRows(input, sign, lu);
  const { t } = prep;
  const start = o.pumpStart, stop = o.pumpStop;
  if (start > t[t.length - 1]) throw new Error('Pumping starts after the last reading.');
  const pretestDays = Math.max(0, (start - t[0]) / DAY);

  const bg = background(prep, input, { ...o, levelKind: kind }, pretestDays);
  const line = pretestLine(t, bg.h, start);
  const rawLine = pretestLine(t, prep.h, start);
  const applyTrend = Boolean(o.removeTrend && line);
  const cleaned = applyTrend ? bg.h.map((x, i) => x - line.perDay * (t[i] - start) / DAY) : bg.h;

  const staticOf = (h) => {
    if (isNum(o.staticLevel)) return { value: sign * o.staticLevel * lu, source: 'entered' };
    if (given) return { value: 0, source: 'drawdown-given' };
    const inHour = t.map((_, i) => i).filter((i) => t[i] < start && t[i] >= start - HOUR && isNum(h[i]));
    if (inHour.length) return { value: mean(inHour.map((i) => h[i])), source: 'last-hour', rows: inHour.length };
    let k = -1;
    for (let i = 0; i < t.length && t[i] < start; i++) if (isNum(h[i])) k = i;
    if (k < 0) throw new Error('There is no reading before pumping started, so drawdown has no starting level. Enter the static water level.');
    return { value: h[k], source: 'last-reading', rows: 1 };
  };
  const statics = staticOf(cleaned), rawStatic = staticOf(prep.h);
  const drawdown = cleaned.map((x) => statics.value - x);
  const rawDrawdown = prep.h.map((x) => rawStatic.value - x);

  const days = t.map((x) => (x - start) / DAY);
  const r = isNum(o.distance) && o.distance > 0 ? o.distance * UNITS[o.distanceUnit] : undefined;
  const test = {
    Q, r, pumpedWell: Boolean(o.pumpedWell), toff: isNum(stop) ? (stop - start) / DAY : undefined,
    fitFrom: isNum(o.fitFromMin) ? o.fitFromMin / 1440 : undefined, fitTo: isNum(o.fitToMin) ? o.fitToMin / 1440 : undefined,
    minResidual: line ? RESIDUAL_NOISE_RATIO * line.scatter : 0,
  };
  const analysis = analyzeDrawdown({ t: days, s: drawdown }, test);
  const corrected = bg.mode !== 'none' || applyTrend;
  const rawAnalysis = corrected
    ? analyzeDrawdown({ t: days, s: rawDrawdown }, { ...test, minResidual: rawLine ? RESIDUAL_NOISE_RATIO * rawLine.scatter : 0 })
    : null;

  const lengthUnit = ['m', 'ft', 'cm', 'mm', 'in'].includes(o.levelUnit) ? o.levelUnit : 'm';
  const toLength = (x) => (isNum(x) ? x / UNITS[lengthUnit] : NaN);
  const toShown = (x) => `${toLength(x).toFixed(3)} ${lengthUnit}`;
  const warnings = [];
  const { counts } = prep;
  if (bg.reason === 'no-barometer') warnings.push('No barometer was given, so nothing was removed. This is the raw drawdown.');
  if (bg.reason === 'pretest-too-short') warnings.push(`The record before pumping is shorter than ${MIN_PRETEST_DAYS} day, so no barometric efficiency could be fitted and nothing was removed. If you know the efficiency, enter it. The well record tool can fit one from a longer record of this well.`);
  (bg.notes || []).forEach((w) => warnings.push(w));
  if (isNum(bg.be) && (bg.be < 0 || bg.be > 1)) warnings.push(`The fitted barometric efficiency of ${bg.be.toFixed(2)} is outside 0 to 1, so the correction is not reliable. Check the level direction and units, or enter an efficiency from a longer record.`);
  if (!isNum(stop)) warnings.push('No pumping stop was given, so there is no recovery analysis or extended drawdown.');
  if (test.pumpedWell) warnings.push('This is the pumped well. Storativity is not reported, because well losses and casing storage distort it. The Theis curve fit is left out for the same reason.');
  else if (!r) warnings.push('No distance from the pumped well was given, so storativity is not reported and the Theis curve fit is left out.');
  if (line && !applyTrend) {
    const span = (t[t.length - 1] - start) / DAY;
    const over = Math.abs(line.perDay * span);
    const peak = Math.max(...drawdown.filter(isNum));
    if (over > 0.05 * peak) warnings.push(`The level was trending ${line.perDay > 0 ? 'up' : 'down'} before pumping. Carried through the test that is ${(100 * over / peak).toFixed(0)}% of the largest drawdown, and it was not removed. Tick the trend option if you trust it.`);
  }
  const bend = analysis.line && analysis.line.bend;
  if (bend && (bend.ratio > BEND_LIMIT || bend.ratio < 1 / BEND_LIMIT)) {
    warnings.push(`Drawdown against log time is not a straight line. Its slope ${bend.ratio < 1 ? 'flattens' : 'steepens'} from ${toShown(bend.early)} to ${toShown(bend.late)} per log cycle, which ${bend.ratio < 1 ? 'can mean leakage or recharge' : 'can mean a barrier or a limited aquifer'}. One line through both is a compromise, so set the fit window to the part you trust.`);
  }
  const ext = analysis.extended;
  if (ext && ext.check && !ext.check.ok) warnings.push(`The extended drawdown jumps by ${(100 * Math.abs(ext.check.share)).toFixed(1)}% of the drawdown at shut-off where it should run smoothly. This is a warning that a condition failed: a rate change, a moving static level, dewatering, or interference. Treat every result here with caution.`);
  const slopeRatio = ext && ext.check ? ext.check.slopeRatio : NaN;
  if (ext && ext.check && ext.check.falling) warnings.push('The extended drawdown falls after shut-off. It stands for pumping that never stopped, so it should keep climbing. The usual cause is a static level that was already rising, for example after a step test or earlier pumping. No transmissivity is reported from it, and the other results here may be off too.');
  else if (slopeRatio < 1 / SLOPE_LIMIT) warnings.push(`The extended drawdown flattens to ${slopeRatio.toFixed(2)} times the slope at the end of pumping. A static level that was rising can do this, and so can recharge or leakage. Check the level before pumping before reading this as the aquifer.`);
  else if (slopeRatio > SLOPE_LIMIT) warnings.push(`The extended drawdown steepens to ${slopeRatio.toFixed(1)} times the slope at the end of pumping. A static level that was falling can do this, and so can a barrier or dewatering. Check the level before pumping before reading this as the aquifer.`);
  if (ext && minResidualHit(analysis.recoveryBins, ext, test.minResidual)) warnings.push(`Recovery readings with less than ${(test.minResidual * 1000).toFixed(0)} mm of residual drawdown, 3 times the scatter before pumping, were not used.`);
  if (analysis.recovery && (analysis.recovery.ratio0 < 0.5 || analysis.recovery.ratio0 > 2)) warnings.push(`The recovery line reaches zero at t/t' = ${analysis.recovery.ratio0.toFixed(2)}, not near 1. The static level may have moved, or storage may differ between pumping and recovery.`);
  const Ts = [analysis.theis, analysis.line, analysis.recovery].filter(Boolean).map((x) => x.T);
  if (Ts.length > 1 && Math.max(...Ts) > 1.25 * Math.min(...Ts)) warnings.push('The methods disagree by more than 25% on transmissivity, so this aquifer is not behaving like the ideal one they assume. Read the diagnostic chart before using any one number.');
  if (counts.levelCodes) warnings.push(`${counts.levelCodes} water level fill codes were left blank.`);
  if (counts.untimed) warnings.push(`${counts.untimed} rows had no readable time and were left out.`);
  if (counts.duplicates) warnings.push(`${counts.duplicates} rows repeated an earlier timestamp and were merged into it.`);

  const toLevel = (x) => (isNum(x) ? (sign * x) / lu : NaN);
  return {
    t, srcRow: prep.srcRow, flags: prep.flags.map((f) => f.replace(/level spike(; )?/, '')),
    elapsedMin: days.map((d) => d * 1440),
    level: prep.h.map(toLevel),
    cleanLevel: cleaned.map(toLevel),
    baroEffect: bg.baroEffect ? bg.baroEffect.map(toLevel) : null,
    tideEffect: bg.mode === 'response' ? bg.tideEffect.map(toLevel) : null,
    rawDrawdown: rawDrawdown.map(toLength), drawdown: drawdown.map(toLength),
    analysis, rawAnalysis, warnings,
    method: {
      start, stop, elapsed: Boolean(o.elapsed), pretestDays, rowsInFile: input.t.length,
      levelKind: o.levelKind, levelUnit: o.levelUnit, baroUnit: o.baroUnit, lengthUnit,
      lengthToM: UNITS[lengthUnit], Q, rate: o.rate, rateUnit: o.rateUnit, r, distance: o.distance, distanceUnit: o.distanceUnit, pumpedWell: test.pumpedWell,
      background: {
        mode: bg.mode, reason: bg.reason, be: bg.be, range: bg.range, rows: bg.rows, explained: bg.explained, lagHours: bg.lagHours, tide: bg.tide,
      },
      statics, trend: line, rawScatter: rawLine ? rawLine.scatter : NaN, trendRemoved: applyTrend, minResidual: test.minResidual,
      durationDays: isNum(test.toff) ? test.toff : days[days.length - 1],
    },
  };
}

const minResidualHit = (rec, ext, floor) => floor > 0 && ext.t.length < rec.t.length && rec.y.some((y) => Math.abs(y) < floor);
