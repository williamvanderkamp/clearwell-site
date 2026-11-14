// The standard correction, in order:
//   1. An absolute sensor has air pressure subtracted to give water column.
//   2. Constant barometric efficiency: first-difference regression (Clark 1967 style).
//   3. Regression deconvolution for the barometric response function, with a fixed
//      lag length (Rasmussen and Crawford 1997; Toll and Rasmussen 2007; Butler et
//      al. 2011).
//   4. Lagged regression on a computed earth tide, jointly with step 3, where the
//      location is known and the well shows a response at M2 or O1.
// Further measured inputs, such as rainfall or a river stage, are fitted jointly in
// steps 3 and 4 when they are given (inputs.js). Fitted effects are subtracted in
// level space, so drift is never removed.

import { DAY, HOUR, diffs, isNum, mean, rms } from './numeric.js';
import { prepare } from './prepare.js';
import { effectOf, fitDifferences, lagColumns, lagList, stepsIn } from './regression.js';
import { inputColumns, responseOf } from './inputs.js';
import { UNITS } from './units.js';
import { LINES, TIDE_SNR_THRESHOLD, amplitudeAt, gravityTide, tideLagSeries, tideResponse } from './tide.js';

export const LAG_HOURS = 48;
export const TIDE_LAG_HOURS = 12;
export const MAX_TIDE_STEP_H = 3;
export const MIN_TIDE_DAYS = 15;
const SEGMENTS = 6;

// A fitted effect less its mean, so it moves the record without shifting it.
const center = (a) => { const m = mean(a); return a.map((x) => (isNum(x) ? x - m : NaN)); };

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
 *   baroCols: the barometer's lag columns, each with its own coefficient
 *   tideLags: lag steps for the computed tide, or [] for none
 *   extra:    the further inputs' lag columns, [{ name, series }]
 * extraCovariance() gives the covariance of the extra columns' coefficients, as
 * fitDifferences' covariance() does.
 */
function fitModel(prep, spec, opts) {
  const { grid } = prep;
  const { baroCols, extra } = spec;
  const tideLags = spec.tideLags || [];
  const tideCols = tideLagSeries(grid.t, grid.stepMs, tideLags, opts.lat, opts.lon, opts.utcOffsetHours)
    .map((series, k) => ({ name: `tide${tideLags[k]}`, series }));
  const fit = fitDifferences(grid.h, [...baroCols, ...tideCols, ...extra], fitMask(prep, opts));
  if (!fit.enough) return { ...fit, baroCols, tideCols };
  const nB = baroCols.length, nT = tideCols.length;
  const uB = fit.coef.slice(0, nB), uT = fit.coef.slice(nB, nB + nT), uX = fit.coef.slice(nB + nT);
  const baroRaw = effectOf(baroCols, uB);
  const baroEffect = center(baroRaw);
  const tideEffect = nT ? center(effectOf(tideCols, uT)) : new Array(grid.n).fill(0);
  const extraCovariance = () => fit.covariance(extra.map((_, k) => nB + nT + k));
  return { ...fit, baroCols, tideCols, uB, uT, uX, baroEffect, baroOffset: mean(baroRaw), tideEffect, extraCovariance };
}

// Each further input's share of a fitted model: its coefficients, its whole fitted
// effect and the part of it that is subtracted, both on the grid, and where its
// coefficients are among the model's extra columns.
function inputShares(inputs, model) {
  let at = 0;
  return inputs.map((x) => {
    const idx = x.columns.map((_, k) => at + k);
    at += idx.length;
    const coef = idx.map((a) => model.uX[a]);
    const full = center(effectOf(x.columns, coef));
    const removed = x.removedPart === 'whole' ? full
      : x.removedPart === 'immediate' ? center(effectOf(x.columns.slice(0, 1), coef.slice(0, 1))) : new Array(full.length).fill(0);
    return { idx, coef, full, removed };
  });
}

// Fitted steps over which an input changes. With none it has nothing to fit.
const changesIn = (x, used) => used.filter((i) => x[i] !== x[i - 1]).length;

// Whether to fit the earth tide, tested on what `effect` leaves of the level.
function tideChoice(prep, opts, effect, mask) {
  const { t } = prep;
  const first = isNum(opts.fitStart) ? Math.max(opts.fitStart, t[0]) : t[0];
  const last = isNum(opts.fitEnd) ? Math.min(opts.fitEnd, t[t.length - 1]) : t[t.length - 1];
  const days = (last - first) / DAY;
  const hasSite = isNum(opts.lat) && isNum(opts.lon);
  if (!hasSite) return { use: false, reason: 'no-location' };
  if (prep.stepH > MAX_TIDE_STEP_H) return { use: false, reason: 'step-too-long' };
  if (days < MIN_TIDE_DAYS) return { use: false, reason: 'too-short' };
  const { grid } = prep;
  const left = grid.h.map((x, i) => (isNum(x) && isNum(effect[i]) ? x - effect[i] : NaN));
  const test = tideResponse(left, grid.t, mask);
  return { use: test.detected, reason: test.detected ? 'response' : 'no-response', test };
}

/**
 * input: { t: ms[], level: number[], baro: number[] }
 * opts:  { levelKind, levelUnit, baroUnit, lat?, lon?, utcOffsetHours?, fitStart?, fitEnd?,
 *          userBE?, lagHours?, tide?: 'auto'|'off', inputs? }
 * Times are the file's own clock. utcOffsetHours says how far that clock is ahead
 * of UTC, and only matters to the computed tide. inputs are further measured series,
 * [{ name, values, kind, unit, lagHours, action }], described in inputs.js.
 */
export function correct(input, opts) {
  const o = { lagHours: LAG_HOURS, tide: 'auto', ...opts };
  const specs = o.inputs || [];
  const prep = prepare({ ...input, inputs: specs.map((x) => x.values) }, o);
  const { grid, stepH, levelToM: lu, sign } = prep;
  const mask = fitMask(prep, o);
  const inputs = specs.map((spec, j) => inputColumns(prep, spec, j));
  inputs.forEach((x) => {
    if (!x.x.some((v, i) => i > 0 && isNum(v) && isNum(x.x[i - 1]))) {
      throw new Error(`${x.what} has no two steps in a row with a value.${x.spec.kind === 'amount' ? ' An amount is blank at a step when any row in it is, and a blank is not read as 0, so give every row a value, 0 for none.' : ''}`);
    }
  });
  const extra = inputs.flatMap((x) => x.columns);

  // Step 2: constant barometric efficiency.
  const constantCols = lagColumns(grid.b, [0]);
  const constantFit = fitDifferences(grid.h, constantCols, mask);
  if (!constantFit.enough) {
    throw new Error('There are not enough overlapping water level and barometer readings to fit a response.');
  }
  const constantBE = -constantFit.coef[0];

  // Step 3: deconvolution with the fixed lag length, and any further inputs.
  const nLags = stepsIn(o.lagHours, stepH);
  const baroCols = lagColumns(grid.b, lagList(nLags));
  const noTide = fitModel(prep, { baroCols, extra }, o);
  if (!noTide.enough) {
    if (inputs.length) {
      const p = nLags + 2 + extra.length;
      throw new Error(`This record has ${noTide.rows} steps with a level, pressure and every further input. A ${o.lagHours}-hour response with the further inputs' lags needs at least ${3 * p}.`);
    }
    throw new Error(`This record has ${noTide.rows} usable steps. A ${o.lagHours}-hour response needs at least ${3 * (nLags + 2)}.`);
  }

  // Step 4: earth tide, fitted jointly when there is a response to fit. The test for a
  // tidal response is made on what the pressure and any further inputs leave.
  const noTideShares = inputShares(inputs, noTide);
  const left = noTideShares.reduce((sum, x) => sum.map((v, i) => v + x.full[i]), noTide.baroEffect);
  const tide = o.tide === 'off' ? { use: false, reason: 'turned-off' } : tideChoice(prep, o, left, mask);
  let model = noTide, shares = noTideShares;
  if (tide.use) {
    const joint = fitModel(prep, { baroCols, tideLags: lagList(stepsIn(TIDE_LAG_HOURS, stepH)), extra }, o);
    if (joint.enough) { model = joint; shares = inputShares(inputs, joint); }
    else { tide.use = false; tide.reason = inputs.length ? 'inputs-too-long' : 'too-short'; }
  }
  // Only the model kept needs the covariance of the inputs' coefficients.
  const stats = inputs.length ? model.extraCovariance() : null;
  inputs.forEach((x) => {
    x.changes = changesIn(x.x, model.used);
    if (x.changes) return;
    const elsewhere = x.x.filter((v, i) => i > 0 && mask(i) && isNum(v) && isNum(x.x[i - 1]) && v !== x.x[i - 1]).length;
    throw new Error(`${x.what} does not change over the fitted steps, so it has no response to fit.${elsewhere ? ` It changes on ${elsewhere} steps, but none of them could be fitted. Check the Flags column for level spikes flagged where it changes.` : ' Check the column, or leave it out.'}`);
  });

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
  const inputRemoved = shares.map((x) => prep.t.map((ms) => atRow(grid, x.removed, ms)));
  const corrected = inputRemoved.reduce(minus, minus(minus(prep.h, baroEff), tideEff));
  const constantCorrected = minus(prep.h, constEff);
  const userCorrected = userEff ? minus(prep.h, userEff) : null;

  // Diagnostics on the model grid, in metres.
  const gridCorrected = shares.map((x) => x.removed).reduce(minus, grid.h.map((x, i) => {
    const b = model.baroEffect[i], e = model.tideEffect[i];
    return isNum(x) && isNum(b) && isNum(e) ? x - b - e : NaN;
  }));
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
  if (tide.reason === 'inputs-too-long') warnings.push('No earth tide was removed: with the further inputs\' lags, there are too few steps to fit it as well.');
  if (tide.reason === 'no-response') warnings.push(`No earth tide was removed. Neither M2 nor O1 stood ${TIDE_SNR_THRESHOLD} times above the nearby quiet frequencies.`);
  if (prep.baroResolutionM > 0.5 * hourlyP) warnings.push(`The barometer reads in steps of ${(prep.baroResolutionM / lu).toPrecision(2)} ${o.levelUnit} of water, large against its typical change between steps. Coarse barometers bias fitted efficiencies low.`);
  if (!prep.absoluteBaro) warnings.push('The barometer values are not in the normal range for air pressure. If they are relative pressure the correction is still valid. Otherwise check the unit.');
  if (o.tide !== 'off' && (isNum(o.lat) !== isNum(o.lon))) warnings.push('Latitude and longitude must both be given.');
  const blankCount = corrected.filter((x) => !isNum(x)).length;
  const inputHistory = inputs.some((x) => x.removedPart) ? ' Rows also need each further input that is removed, over its own lag, or at lag 0 alone for the immediate part.' : '';
  if (blankCount) warnings.push(`${blankCount} of ${corrected.length} rows have no corrected value: the first ${o.lagHours} hours, and the ${o.lagHours} hours after any barometer gap, have no full pressure history.${inputHistory}`);
  if (counts.levelCodes) warnings.push(`${counts.levelCodes} water level fill codes were left blank.`);
  if (counts.levelSpikes) warnings.push(`${counts.levelSpikes} isolated water level spikes were left out of the fit and flagged. They are still in the output.`);
  if (counts.baroImpossible + counts.baroSpikes) warnings.push(`${counts.baroImpossible + counts.baroSpikes} barometer readings were rejected as impossible or spiked, flagged, and not used.`);
  if (counts.baroFilled) warnings.push(`${counts.baroFilled} rows use a barometer value interpolated across a gap of up to 3 hours, and are flagged.`);
  if (counts.untimed) warnings.push(`${counts.untimed} rows had no readable time and were left out.`);
  if (counts.duplicates) warnings.push(`${counts.duplicates} rows repeated an earlier timestamp and were merged into it.`);
  inputs.forEach((x, j) => {
    if (x.blanks) {
      warnings.push(x.spec.kind === 'amount'
        ? `${x.blanks} rows of ${x.what} are blank or fill codes. A blank amount is not taken as zero: the steps it falls in are left out of the fit, and the effect of whatever fell then stays in the record.`
        : `${x.blanks} rows of ${x.what} are blank or fill codes, and the steps they fall in are left out of the fit.`);
    }
    // Rain is what arrives in a burst, so only an amount is checked: a level such as a
    // stage changes on nearly every row.
    const fell = (i) => i >= 0 && isNum(prep.inputsRaw[j][i]) && prep.inputsRaw[j][i] !== 0;
    const onSpikes = x.spec.kind === 'amount' ? prep.levelSpike.filter((spike, i) => spike && (fell(i) || fell(i - 1))).length : 0;
    if (onSpikes) warnings.push(`${onSpikes} of the level readings flagged as spikes, and left out of the fit, are on or just after a row where ${x.what} changed. They may be its response, not faults in the record. Check them in the Flags column.`);
    if (x.changes < x.columns.length) warnings.push(`${x.what} changes on only ${x.changes} of the fitted steps, fewer than its ${x.columns.length} lag coefficients, so its response is poorly determined. Its standard errors show by how much.`);
  });

  const out = (a) => a.map(toUser);
  const inputResults = inputs.map((x, j) => ({
    name: x.spec.name, kind: x.spec.kind, unit: x.spec.unit, action: x.spec.action, removedPart: x.removedPart, lengthRatio: x.lengthRatio,
    lagHoursAsked: x.spec.lagHours, nLags: x.nLags, lagHours: x.nLags * stepH, blanks: x.blanks, changes: x.changes,
    ...responseOf(shares[j].coef, shares[j].idx.map((a) => shares[j].idx.map((b) => stats.cov[a][b])), stepH, x.lengthRatio ? 1 : 1 / lu),
    amountTotal: x.amountTotal === null ? null : x.amountTotal / (x.lengthRatio ? UNITS[x.spec.unit] : 1),
    effect: out(prep.t.map((ms) => atRow(grid, shares[j].full, ms))), removed: out(inputRemoved[j]),
  }));
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
      be, loadingEfficiency: 1 - be, stepResponse, beRange: segmentRange(prep, [...baroCols, ...extra], mask, (c) => -c.slice(0, nLags + 1).reduce((s, x) => s + x, 0)),
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
    // Further inputs, or null when none were given. Nothing above depends on this
    // when there are none.
    inputs: inputs.length ? { list: inputResults, residualLag1: stats.residualLag1, dof: stats.dof } : null,
  };
}

