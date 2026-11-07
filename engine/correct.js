// The standard correction, in order:
//   1. An absolute sensor has air pressure subtracted to give water column.
//   2. Constant barometric efficiency: first-difference regression (Clark 1967 style).
//   3. Regression deconvolution for the barometric response function, with a fixed
//      lag length (Rasmussen and Crawford 1997; Toll and Rasmussen 2007; Butler et
//      al. 2011).
//   4. Lagged regression on a computed earth tide, jointly with step 3, where the
//      location is known and the well shows a response at M2 or O1.
// Fitted effects are subtracted in level space, so drift is never removed.

import { DAY, HOUR, diffs, isNum, mean, rms } from './numeric.js';
import { prepare } from './prepare.js';
import { effectOf, fitDifferences, lagColumns } from './regression.js';
import { LINES, TIDE_SNR_THRESHOLD, amplitudeAt, gravityTide, tideResponse, tideSeries } from './tide.js';

export const LAG_HOURS = 48;
export const TIDE_LAG_HOURS = 12;
const MAX_TIDE_STEP_H = 3;
const MIN_TIDE_DAYS = 15;
const SEGMENTS = 6;

const stepsIn = (hours, stepH) => Math.max(0, Math.round(hours / stepH));
const lagList = (m) => Array.from({ length: m + 1 }, (_, k) => k);

// Interpolate a gridded series onto a row time. Blank across missing nodes.
function atRow(grid, series, ms) {
  const x = (ms - grid.t[0]) / grid.stepMs;
  const i = Math.floor(x);
  if (i < 0 || i >= grid.n) return NaN;
  if (x === i) return series[i];
  if (i === grid.n - 1) return NaN;
  const a = series[i], c = series[i + 1];
  return isNum(a) && isNum(c) ? a + (c - a) * (x - i) : NaN;
}

function fitMask(prep, opts) {
  const t = prep.grid.t;
  const inWindow = (ms) => (!isNum(opts.fitStart) || ms >= opts.fitStart) && (!isNum(opts.fitEnd) || ms <= opts.fitEnd);
  return (i) => inWindow(t[i]);
}

// Barometric efficiency in each of several equal stretches of the fit period. A plain
// picture of how stable the number is, not a confidence interval.
function segmentRange(prep, columns, mask, toBE) {
  const n = prep.grid.n, out = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const lo = Math.floor(n * s / SEGMENTS), hi = Math.floor(n * (s + 1) / SEGMENTS);
    const fit = fitDifferences(prep.grid.h, columns, (i) => i >= lo && i < hi && mask(i));
    if (fit.enough) out.push(toBE(fit.coef));
  }
  return out.length >= 3 ? { min: Math.min(...out), max: Math.max(...out), parts: out.length } : null;
}

/**
 * Fits one model on prepared data. `spec` names the model:
 *   lags:     lag steps, each with its own coefficient, or [] for none
 *   tideLags: lag steps for the computed tide, or [] for none
 *   extra:    further columns, [{ name, series, removed }]. Fitted always;
 *             subtracted only when `removed` is true.
 *   drop:     row filter passed to the regression
 * This is the one place every model goes through, so the evaluation can fit its
 * variants with exactly the shipped code.
 */
export function fitModel(prep, spec, opts = {}) {
  const { grid } = prep;
  const baroCols = spec.baroColumns || lagColumns(grid.b, spec.lags);
  const tideCols = (spec.tideLags || []).map((k) => ({
    name: `tide${k}`, series: tideSeries(grid.t, grid.stepMs, k, opts.lat, opts.lon, opts.utcOffsetHours),
  }));
  const extra = spec.extra || [];
  const columns = [...baroCols, ...tideCols, ...extra];
  const fit = fitDifferences(grid.h, columns, fitMask(prep, opts), spec.drop);
  if (!fit.enough) return { ...fit, baroCols, tideCols };
  const nB = baroCols.length, nT = tideCols.length;
  const uB = fit.coef.slice(0, nB), uT = fit.coef.slice(nB, nB + nT), uX = fit.coef.slice(nB + nT);
  const center = (a) => { const m = mean(a); return a.map((x) => (isNum(x) ? x - m : NaN)); };
  const baroRaw = effectOf(baroCols, uB);
  const baroEffect = center(baroRaw);
  const tideEffect = nT ? center(effectOf(tideCols, uT)) : new Array(grid.n).fill(0);
  const shown = extra.filter((c) => c.removed);
  const extraEffect = shown.length ? center(effectOf(shown, uX.filter((_, k) => extra[k].removed))) : new Array(grid.n).fill(0);
  return { ...fit, baroCols, tideCols, uB, uT, uX, baroEffect, baroOffset: mean(baroRaw), tideEffect, extraEffect };
}

function tideChoice(prep, opts, baroFit, mask) {
  const { t } = prep;
  const first = isNum(opts.fitStart) ? Math.max(opts.fitStart, t[0]) : t[0];
  const last = isNum(opts.fitEnd) ? Math.min(opts.fitEnd, t[t.length - 1]) : t[t.length - 1];
  const days = (last - first) / DAY;
  const hasSite = isNum(opts.lat) && isNum(opts.lon);
  if (!hasSite) return { use: false, reason: 'no-location' };
  if (prep.stepH > MAX_TIDE_STEP_H) return { use: false, reason: 'step-too-long' };
  if (days < MIN_TIDE_DAYS) return { use: false, reason: 'too-short' };
  const { grid } = prep;
  const afterBaro = grid.h.map((x, i) => (isNum(x) && isNum(baroFit.baroEffect[i]) ? x - baroFit.baroEffect[i] : NaN));
  const test = tideResponse(afterBaro, grid.t, mask);
  return { use: test.detected, reason: test.detected ? 'response' : 'no-response', test };
}

/**
 * input: { t: ms[], level: number[], baro: number[] }
 * opts:  { levelKind, levelUnit, baroUnit, lat?, lon?, utcOffsetHours?, fitStart?, fitEnd?,
 *          userBE?, lagHours?, tide?: 'auto'|'off' }
 * Times are the file's own clock. utcOffsetHours says how far that clock is ahead
 * of UTC, and only matters to the computed tide.
 */
export function correct(input, opts) {
  const o = { lagHours: LAG_HOURS, tide: 'auto', ...opts };
  const prep = prepare(input, o);
  const { grid, stepH, levelToM: lu, sign } = prep;
  const mask = fitMask(prep, o);

  // Step 2: constant barometric efficiency.
  const constantCols = lagColumns(grid.b, [0]);
  const constantFit = fitDifferences(grid.h, constantCols, mask);
  if (!constantFit.enough) {
    throw new Error('There are not enough overlapping water level and barometer readings to fit a response.');
  }
  const constantBE = -constantFit.coef[0];

  // Step 3: deconvolution with the fixed lag length.
  const nLags = stepsIn(o.lagHours, stepH);
  const lags = lagList(nLags);
  const baroOnly = fitModel(prep, { lags }, o);
  if (!baroOnly.enough) {
    throw new Error(`This record has ${baroOnly.rows} usable steps. A ${o.lagHours}-hour response needs at least ${3 * (nLags + 2)}.`);
  }

  // Step 4: earth tide, fitted jointly when there is a response to fit.
  const tide = o.tide === 'off' ? { use: false, reason: 'turned-off' } : tideChoice(prep, o, baroOnly, mask);
  let model = baroOnly;
  if (tide.use) {
    const tideLags = lagList(stepsIn(TIDE_LAG_HOURS, stepH));
    const joint = fitModel(prep, { lags, tideLags }, o);
    if (joint.enough) model = joint;
    else { tide.use = false; tide.reason = 'too-short'; }
  }

  const stepResponse = [];
  let cum = 0;
  model.uB.forEach((u, k) => { cum += u; stepResponse.push({ lagH: k * stepH, u, step: cum }); });
  const be = -cum;

  // Effects at every original row. Constant effects use the row's own barometer.
  const baroMean = mean(prep.baro);
  const toUser = (m) => (isNum(m) ? (sign * m) / lu : NaN);
  const baroEff = prep.t.map((ms) => atRow(grid, model.baroEffect, ms));
  const tideEff = prep.t.map((ms) => atRow(grid, model.tideEffect, ms));
  const constEff = prep.baro.map((p) => (isNum(p) ? -constantBE * (p - baroMean) : NaN));
  const userEff = isNum(o.userBE) ? prep.baro.map((p) => (isNum(p) ? -o.userBE * (p - baroMean) : NaN)) : null;
  const minus = (a, b) => a.map((x, i) => (isNum(x) && isNum(b[i]) ? x - b[i] : NaN));
  const corrected = minus(minus(prep.h, baroEff), tideEff);
  const constantCorrected = minus(prep.h, constEff);
  const userCorrected = userEff ? minus(prep.h, userEff) : null;

  // Diagnostics on the model grid, in metres.
  const gridCorrected = grid.h.map((x, i) => {
    const b = model.baroEffect[i], e = model.tideEffect[i];
    return isNum(x) && isNum(b) && isNum(e) ? x - b - e : NaN;
  });
  const gridConstant = grid.h.map((x, i) => (isNum(x) && isNum(grid.b[i]) ? x + constantBE * (grid.b[i] - baroMean) : NaN));
  const lines = {};
  for (const [name, cpd] of Object.entries(LINES)) {
    if (24 / cpd < 2.5 * stepH) continue;
    lines[name] = { before: amplitudeAt(grid.h, grid.t, cpd), after: amplitudeAt(gridCorrected, grid.t, cpd) };
  }
  const change = (a) => rms(diffs(a));
  const hourlyP = change(grid.b);

  const warnings = [];
  const { counts } = prep;
  if (be < 0 || be > 1) warnings.push(`The fitted barometric efficiency of ${be.toFixed(2)} is outside 0 to 1. Check the level direction (depth or elevation) and both units.`);
  if (tide.reason === 'no-location') warnings.push('No earth tide was removed, because the well location was not given.');
  if (tide.reason === 'step-too-long') warnings.push(`No earth tide was removed, because readings ${stepH.toFixed(1)} hours apart are too coarse.`);
  if (tide.reason === 'too-short') warnings.push(`No earth tide was removed, because the record is shorter than ${MIN_TIDE_DAYS} days.`);
  if (tide.reason === 'no-response') warnings.push(`No earth tide was removed. Neither M2 nor O1 stood ${TIDE_SNR_THRESHOLD} times above the nearby quiet frequencies.`);
  if (prep.baroResolutionM > 0.5 * hourlyP) warnings.push(`The barometer reads in steps of ${(prep.baroResolutionM / lu).toPrecision(2)} ${o.levelUnit} of water, large against its typical change between steps. Coarse barometers bias fitted efficiencies low.`);
  if (!prep.absoluteBaro) warnings.push('The barometer values are not in the normal range for air pressure. If they are relative pressure the correction is still valid. Otherwise check the unit.');
  if (o.tide !== 'off' && (isNum(o.lat) !== isNum(o.lon))) warnings.push('Latitude and longitude must both be given.');
  const blankCount = corrected.filter((x) => !isNum(x)).length;
  if (blankCount) warnings.push(`${blankCount} of ${corrected.length} rows have no corrected value: the first ${o.lagHours} hours, and the ${o.lagHours} hours after any barometer gap, have no full pressure history.`);
  if (counts.levelCodes) warnings.push(`${counts.levelCodes} water level fill codes were left blank.`);
  if (counts.levelSpikes) warnings.push(`${counts.levelSpikes} isolated water level spikes were left out of the fit and flagged. They are still in the output.`);
  if (counts.baroImpossible + counts.baroSpikes) warnings.push(`${counts.baroImpossible + counts.baroSpikes} barometer readings were rejected as impossible or spiked, flagged, and not used.`);
  if (counts.baroFilled) warnings.push(`${counts.baroFilled} rows use a barometer value interpolated across a gap of up to 3 hours, and are flagged.`);
  if (counts.untimed) warnings.push(`${counts.untimed} rows had no readable time and were left out.`);
  if (counts.duplicates) warnings.push(`${counts.duplicates} rows repeated an earlier timestamp and were merged into it.`);

  const out = (a) => a.map(toUser);
  return {
    t: prep.t, srcRow: prep.srcRow, flags: prep.flags,
    baroUsed: prep.baro.map((m) => (isNum(m) ? m / prep.baroToM : NaN)),
    level: out(prep.h),
    standard: {
      baroEffect: out(baroEff), tideEffect: out(tideEff), corrected: out(corrected),
      tideMicrogal: tide.use ? prep.t.map((ms) => gravityTide(ms - (o.utcOffsetHours || 0) * HOUR, o.lat, o.lon)) : null,
    },
    constant: { effect: out(constEff), corrected: out(constantCorrected) },
    user: userEff ? { be: o.userBE, effect: out(userEff), corrected: out(userCorrected) } : null,
    method: {
      stepH, dtH: prep.dtH, spanH: prep.spanH, rowsInFile: input.t.length, nLags, lagHours: nLags * stepH,
      fitRows: model.rows, driftPerStep: toUser(model.intercept), baroOffsetM: model.baroOffset, hasFitWindow: isNum(o.fitStart) || isNum(o.fitEnd),
      levelKind: o.levelKind, levelUnit: o.levelUnit, baroUnit: o.baroUnit,
      baroToM: prep.baroToM, levelToM: lu, baroMeanM: baroMean, baroMean: baroMean / prep.baroToM,
      lat: o.lat, lon: o.lon, utcOffsetHours: o.utcOffsetHours || 0,
      be, loadingEfficiency: 1 - be, stepResponse, beRange: segmentRange(prep, model.baroCols, mask, (c) => -c.slice(0, nLags + 1).reduce((s, x) => s + x, 0)),
      constant: { be: constantBE, loadingEfficiency: 1 - constantBE, rows: constantFit.rows, driftPerStep: toUser(constantFit.intercept),
        range: segmentRange(prep, constantCols, mask, (c) => -c[0]) },
      tide: {
        used: tide.use, reason: tide.reason, test: tide.test ? { m2Snr: tide.test.m2Snr, o1Snr: tide.test.o1Snr, threshold: TIDE_SNR_THRESHOLD } : null,
        coefficients: tide.use ? model.uT.map((c, k) => ({ lagH: k * stepH, c: c * 1e3 })) : [],
      },
      explained: 1 - model.sse / model.sst,
      constantExplained: 1 - constantFit.sse / constantFit.sst,
    },
    diagnostics: {
      lines,
      changeRaw: change(grid.h), changeCorrected: change(gridCorrected), changeConstant: change(gridConstant),
    },
    grid: { t: grid.t, level: out(grid.h), corrected: out(gridCorrected) },
    warnings,
  };
}

