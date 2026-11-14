// Turns a non-vented logger record into water levels, as logger software does:
// subtract the barometer, convert pressure to a length of water, then tie the result
// to manual depth-to-water readings. No page code here, so the tests can run it.
import { isMissingCode } from './prepare.js';
import { UNITS } from './units.js';

export const G = 9.80665; // standard acceleration of gravity, m/s² (3rd CGPM, 1901)
export const PRESSURE_UNITS = ['kPa', 'Pa', 'hPa', 'mbar', 'bar', 'psi', 'mmHg', 'inHg', 'atm'];
export const WATER_UNITS = ['mH2O', 'cmH2O', 'ftH2O'];

export const isPressure = (u) => PRESSURE_UNITS.includes(u);
const isWater = (u) => WATER_UNITS.includes(u);
const finite = Number.isFinite;

// Pure water at one atmosphere, 0 to 150 °C. Kell (1975), kg/m³, on the 1968 temperature scale.
export function kellDensity(t) {
  if (!(t >= 0 && t <= 150)) throw new Error('The water temperature must be from 0 to 150 °C, the range of the density formula (Kell 1975).');
  return (999.83952 + 16.945176 * t - 7.9870401e-3 * t * t - 46.170461e-6 * t * t * t + 105.56302e-9 * t * t * t * t - 280.54253e-12 * t * t * t * t * t)
    / (1 + 16.879850e-3 * t);
}

// UNITS gives every pressure unit as metres of water at one density, so the ratio
// of two of them is exact whatever that density is.
export const toPa = (x, unit) => (x * UNITS[unit] / UNITS.kPa) * 1000;
export const metresOfWater = (pa, density) => pa / (density * G);

// A reading, or NaN for a blank, text or a fill code such as -9999.
const reading = (x) => (typeof x === 'number' && finite(x) && !isMissingCode(x) ? x : NaN);

// The usable (time, value) pairs, in time order.
export function known(t, v) {
  const idx = [];
  for (let i = 0; i < t.length; i++) if (finite(t[i]) && finite(v[i])) idx.push(i);
  idx.sort((a, b) => t[a] - t[b]);
  return { t: idx.map((i) => t[i]), v: idx.map((i) => v[i]) };
}

// Index of the last known time at or before x.
function below(kt, x) {
  let lo = 0, hi = kt.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kt[mid] <= x) lo = mid;
    else hi = mid;
  }
  return kt[hi] <= x ? hi : lo;
}

// Straight lines between known points. Blank before the first and after the last:
// never extrapolated.
export function interpolate(k, at) {
  const n = k.t.length;
  return at.map((x) => {
    if (!finite(x) || !n || x < k.t[0] || x > k.t[n - 1]) return NaN;
    const a = below(k.t, x);
    if (k.t[a] === x || a === n - 1) return k.v[a];
    return k.v[a] + (k.v[a + 1] - k.v[a]) * (x - k.t[a]) / (k.t[a + 1] - k.t[a]);
  });
}

// The longest step between barometer readings that falls inside the logger record.
function longestStep(kt, from, to) {
  let most = 0;
  for (let i = 1; i < kt.length; i++) if (kt[i] > from && kt[i - 1] < to) most = Math.max(most, kt[i] - kt[i - 1]);
  return most;
}

/**
 * logger, baro: { t: ms[], p: number[], unit }. density in kg/m3, needed when the
 * units are pressures. Returns the barometer at each logger time (in its own unit)
 * and the water column above the sensor in metres.
 */
export function compensate({ logger, baro, density }) {
  for (const u of [logger.unit, baro.unit]) if (!isPressure(u) && !isWater(u)) throw new Error(`Unknown unit: ${u}`);
  if (isPressure(logger.unit) !== isPressure(baro.unit)) {
    throw new Error('One record is in a pressure unit and the other in a length of water. Export both in pressure units, or both as water, so the same density applies to both.');
  }
  const pressure = isPressure(logger.unit);
  if (pressure && !Number.isFinite(density)) throw new Error('Choose the water density.');
  if (pressure && !(density > 0)) throw new Error('The water density must be above zero.');
  if (pressure && density < 500) throw new Error('The water density is in kg/m³. Fresh water is about 1000.');
  const lv = logger.p.map(reading), bv = baro.p.map(reading);
  const kb = known(baro.t, bv);
  if (kb.t.length < 2) throw new Error('The barologger record has fewer than two readings with a time and a pressure.');
  const baroAt = interpolate(kb, logger.t);
  const column = lv.map((x, i) => (pressure
    ? metresOfWater(toPa(x, logger.unit) - toPa(baroAt[i], baro.unit), density)
    : x * UNITS[logger.unit] - baroAt[i] * UNITS[baro.unit]));
  const lt = logger.t.filter(finite);
  const first = lt.reduce((x, y) => Math.min(x, y), Infinity), last = lt.reduce((x, y) => Math.max(x, y), -Infinity);
  return {
    baroAt, column, pressure,
    baroSpan: [kb.t[0], kb.t[kb.t.length - 1]],
    longestBaroStepMs: longestStep(kb.t, first, last),
    counts: {
      loggerCodes: logger.p.filter((x) => typeof x === 'number' && isMissingCode(x)).length,
      baroCodes: baro.p.filter((x) => typeof x === 'number' && isMissingCode(x)).length,
      noBaro: lv.filter((x, i) => finite(x) && finite(logger.t[i]) && !finite(baroAt[i])).length,
      negative: column.filter((x) => x < 0).length,
    },
  };
}

/**
 * Ties the water column to manual depth-to-water readings, all in metres.
 * readings: [{ t, depth }]. drift: 'constant' or 'linear', needed for two or more.
 * offset = manual depth + water column at the reading; depth to water = offset - column.
 */
export function reference({ t, column, readings, drift }) {
  if (!readings.length) throw new Error('Enter at least one manual depth to water.');
  if (readings.length > 1 && !['constant', 'linear'].includes(drift)) throw new Error('Choose how to use more than one manual reading.');
  const r = readings.slice().sort((a, b) => a.t - b.t);
  for (let i = 1; i < r.length; i++) if (r[i].t === r[i - 1].t) throw new Error('Two manual readings have the same date and time.');
  const k = known(t, column);
  if (!k.t.length) throw new Error('No logger reading has a water column. Check the barologger covers the same dates.');
  const at = interpolate(k, r.map((x) => x.t));
  const rows = r.map((x, i) => {
    if (!finite(at[i])) {
      const when = new Date(x.t).toISOString().slice(0, 16).replace('T', ' ');
      throw new Error(`The manual reading at ${when} is outside the logger readings that have a water column.`);
    }
    // How far the nearest logger reading with a water column is from the manual reading.
    const a = below(k.t, x.t), near = Math.min(...[k.t[a], k.t[a + 1]].filter(finite).map((s) => Math.abs(s - x.t)));
    return { t: x.t, depth: x.depth, column: at[i], offset: x.depth + at[i], nearestMs: near };
  });
  rows.forEach((x) => { x.loggerMinusManual = rows[0].offset - x.offset; });
  const linear = drift === 'linear' && rows.length > 1;
  const ko = { t: rows.map((x) => x.t), v: rows.map((x) => x.offset) };
  const last = rows[rows.length - 1];
  const offsetAt = (x) => {
    if (!finite(x)) return NaN;
    if (!linear || x <= rows[0].t) return rows[0].offset;
    if (x >= last.t) return last.offset;
    return interpolate(ko, [x])[0];
  };
  const offset = t.map(offsetAt);
  return { readings: rows, offset, depth: column.map((c, i) => offset[i] - c), linear };
}

/** Everything in metres. mpElevation is optional. */
export function convertLogger({ logger, baro, density, readings, drift, mpElevation }) {
  const comp = compensate({ logger, baro, density });
  const ref = reference({ t: logger.t, column: comp.column, readings, drift });
  const elevation = finite(mpElevation) ? ref.depth.map((d) => mpElevation - d) : null;
  return { ...comp, ...ref, elevation };
}
