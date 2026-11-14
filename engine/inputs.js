// Further measured inputs to the well record: rainfall, river, lake or pond stage,
// pumping of a nearby well, or any other series logged on the same rows. Each is fitted
// jointly with the barometric response by multi-factor regression deconvolution
// (Haehnel et al. 2024, eq. 9, as Dörr et al. 2026, sect. 2.4, apply it to river levels
// and pond loading), the same deconvolution as the barometric response (Rasmussen and
// Crawford 1997) extended to more drivers as Toll and Rasmussen (2007) did for the
// earth tide. Like the barometric fit here, and unlike Haehnel et al.'s eq. 9, it also
// has an intercept for steady drift:
//
//   h(t) - h(t-1) = a + sum over k of u(k) [p(t-k) - p(t-k-1)]
//                     + sum over inputs j, k=0..m_j of w_j(k) [x_j(t-k) - x_j(t-k-1)] + e(t)
//
// x_j is the input in level space. A level, such as a river stage, is used as it is.
// An amount per row, such as rainfall, is the running total of the amounts, so its
// change over a step is the amount itself: the accumulated precipitation P of Dörr et
// al.'s surface water balance (eq. 1), whose pond loading is accumulated P less
// evaporation. The running sum of w_j (Haehnel et al. eq. 10) is then the response to
// a unit step in a level, or to one unit of rain at lag 0. Its standard error is from
// the coefficients' covariance (Haehnel et al. eq. B1).

import { isNum } from './numeric.js';
import { gridMean, isMissingCode } from './prepare.js';
import { lagColumns, lagList, stepsIn } from './regression.js';
import { UNITS } from './units.js';

export const INPUT_KINDS = { level: 'A level or running total', amount: 'An amount per row' };
export const INPUT_ACTIONS = { remove: 'Remove its fitted effect', immediate: 'Remove the immediate part only', report: 'Report only' };
// The part of its fitted effect each action subtracts.
const REMOVED_PART = { remove: 'whole', immediate: 'immediate', report: null };
// Units in which a fitted response is a plain ratio of lengths.
export const INPUT_LENGTH_UNITS = ['m', 'ft', 'cm', 'mm', 'in'];

/**
 * spec: { name, values, kind: 'level'|'amount', unit, lagHours, action }
 * unit is a length unit from INPUT_LENGTH_UNITS, or '' for a series that is not a
 * length, whose response is then per unit of the column. Nothing has a default.
 */
export function checkInput(spec, j) {
  const what = spec.name ? `"${spec.name}"` : `Input ${j + 1}`;
  if (!INPUT_KINDS[spec.kind]) throw new Error(`Say whether ${what} is a level or an amount per row.`);
  if (spec.unit !== '' && !INPUT_LENGTH_UNITS.includes(spec.unit)) throw new Error(`Choose the unit of ${what}.`);
  if (!isNum(spec.lagHours) || spec.lagHours < 0) throw new Error(`Give the lag length of ${what} in hours, 0 or more.`);
  if (!INPUT_ACTIONS[spec.action]) throw new Error(`Say whether to remove ${what} or only report it.`);
  return what;
}

// The input in level space at each row, in metres for a length. Fill codes are blank.
// An amount's running total is blank on a blank row: that amount is unknown, so no
// difference that spans it is used. Rows after it carry on from the known total,
// short by the unknown amount, which changes only differences across the blank.
function rowSeries(values, kind, toUnit) {
  const v = values.map((x) => (isNum(x) && !isMissingCode(x) ? x * toUnit : NaN));
  const blanks = v.filter((x) => !isNum(x)).length;
  if (kind === 'level') return { series: v, blanks };
  let total = 0;
  const series = v.map((x) => (isNum(x) ? (total += x) : NaN));
  return { series, blanks, total };
}

/**
 * Puts one input on the grid, averaged at each node as the level is, and gives its lag
 * columns. An amount's node is blank when any row in it is, since its running total
 * there is not known. removedPart is the part of its effect that is subtracted: 'whole',
 * 'immediate' (lag 0 alone) or null.
 */
export function inputColumns(prep, spec, j) {
  const what = checkInput(spec, j);
  const toUnit = spec.unit ? UNITS[spec.unit] : 1;
  const { series, blanks, total } = rowSeries(prep.inputsRaw[j], spec.kind, toUnit);
  const { grid } = prep;
  const x = gridMean(prep.t, series, grid.t[0], grid.stepMs, grid.n, spec.kind === 'amount');
  const nLags = stepsIn(spec.lagHours, prep.stepH);
  const columns = lagColumns(x, lagList(nLags)).map((c, k) => ({ name: `input${j}-lag${k}`, series: c.series }));
  // The sum of an amount over the record, in metres for a length.
  return {
    spec, what, x, nLags, columns, blanks, removedPart: REMOVED_PART[spec.action],
    lengthRatio: spec.unit !== '', amountTotal: spec.kind === 'amount' ? total : null,
  };
}

// Sum of the entries of a covariance matrix over the indexes in `set`: the variance of
// the sum of those coefficients.
const varianceOfSum = (cov, set) => set.reduce((s, a) => s + set.reduce((r, b) => r + cov[a][b], 0), 0);

/**
 * The fitted response of one input, with standard errors. coef and cov are the
 * input's own coefficients and their covariance, in metres of level (up positive) per
 * metre of input for a length, or per unit of the column otherwise. `scale` turns them
 * into what is reported: 1 for a ratio of lengths, 1 / (level unit in m) otherwise.
 */
export function responseOf(coef, cov, stepH, scale) {
  const se = (set) => Math.sqrt(Math.max(0, varianceOfSum(cov, set))) * scale;
  const upTo = (k) => Array.from({ length: k + 1 }, (_, i) => i);
  let step = 0;
  const coefficients = coef.map((u, k) => {
    step += u;
    return { lagH: k * stepH, u: u * scale, se: Math.sqrt(Math.max(0, cov[k][k])) * scale, step: step * scale, stepSe: se(upTo(k)) };
  });
  const m = coef.length - 1;
  const first = coefficients[0], last = coefficients[m];
  return {
    coefficients,
    immediate: { value: first.u, se: first.stepSe },
    lagged: m ? { value: (step - coef[0]) * scale, se: se(upTo(m).slice(1)) } : null,
    total: { value: last.step, se: last.stepSe },
  };
}
