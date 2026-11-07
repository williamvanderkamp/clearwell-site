// Turns a raw record into clean series on a regular grid. Basic data safety only:
// nothing here changes a reading the user can't see changed. Rejected readings are
// flagged row by row and the original values stay in the output.

import { HOUR, isNum, mad, median, diffs } from './numeric.js';
import { UNITS } from './units.js';

// Fill values that logger software and databases write in place of a reading.
export const isMissingCode = (x) => x === -9999 || x === -999 || x === 9999 || x === 99999 || x === -99999;

// Air pressure anywhere a well can be drilled is 5 to 12 m of water.
const AIR_MIN_M = 5, AIR_MAX_M = 12;
const BARO_FILL_LIMIT_MS = 3 * HOUR;

// Sensor resolution, read from the smallest change the record contains.
function smallestStep(a) {
  let q = Infinity;
  for (let i = 1; i < a.length; i++) {
    const d = Math.abs(a[i] - a[i - 1]);
    if (d > 1e-9 && d < q) q = d;
  }
  return Number.isFinite(q) ? q : 0;
}

// Flags isolated departures from a rolling median. A sustained change, like a
// pumping period, moves the median with it and is left alone.
function flagSpikes(h, dtMs) {
  const n = h.length, half = Math.max(6, Math.round(6 * HOUR / dtMs));
  const dev = new Array(n).fill(NaN);
  const win = [];
  for (let i = 0; i < n; i++) {
    if (!isNum(h[i])) continue;
    win.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (j !== i && isNum(h[j])) win.push(h[j]);
    if (win.length >= 4) dev[i] = h[i] - median(win);
  }
  const typicalStep = median(diffs(h).map(Math.abs));
  const threshold = Math.max(10 * Math.max(mad(dev), 1e-9), 6 * typicalStep, 4 * smallestStep(h));
  return dev.map((d) => isNum(d) && Math.abs(d) > threshold);
}

// Sort by time, drop rows with no usable timestamp, merge duplicate timestamps.
export function orderRows(input) {
  const order = [];
  for (let i = 0; i < input.t.length; i++) if (isNum(input.t[i])) order.push(i);
  order.sort((a, b) => input.t[a] - input.t[b]);
  const t = [], level = [], baro = [], srcRow = [];
  const num = (x) => (isNum(x) ? x : NaN);
  for (const i of order) {
    const k = t.length - 1;
    if (k >= 0 && t[k] === input.t[i]) {
      if (!isNum(level[k])) level[k] = num(input.level[i]);
      if (!isNum(baro[k])) baro[k] = num(input.baro[i]);
      continue;
    }
    t.push(input.t[i]); level.push(num(input.level[i])); baro.push(num(input.baro[i])); srcRow.push(i);
  }
  return { t, level, baro, srcRow, untimed: input.t.length - order.length, duplicates: order.length - t.length };
}

// Carries the barometer onto every row. It is often logged less often than the
// water level, which leaves blanks in a merged sheet. Gaps over 3 hours stay blank.
function fillBaro(t, b) {
  const known = [];
  for (let i = 0; i < t.length; i++) if (isNum(b[i])) known.push(i);
  const spacing = median(known.slice(1).map((x, i) => t[x] - t[known[i]]));
  const limit = Math.max(BARO_FILL_LIMIT_MS, 3 * spacing);
  const out = b.slice();
  const filledGap = new Array(t.length).fill(false);
  let p = 0;
  for (let i = 0; i < t.length; i++) {
    if (isNum(b[i])) continue;
    while (p + 1 < known.length && t[known[p + 1]] <= t[i]) p++;
    const a = known[p], c = known[p + 1];
    if (c === undefined || t[a] > t[i] || t[c] - t[a] > limit) continue;
    out[i] = b[a] + (b[c] - b[a]) * (t[i] - t[a]) / (t[c] - t[a]);
    // Routine interpolation of a sparser barometer is not worth a flag on every row.
    filledGap[i] = t[c] - t[a] > 1.5 * spacing;
  }
  return { series: out, filledGap, spacing };
}

// Averages rows onto a regular grid of nodes `stepMs` apart.
function buildGrid(t, h, b, stepMs) {
  const t0 = Math.round(t[0] / stepMs) * stepMs;
  const n = Math.round((t[t.length - 1] - t0) / stepMs) + 1;
  const sh = new Float64Array(n), ch = new Int32Array(n), sb = new Float64Array(n), cb = new Int32Array(n);
  for (let i = 0; i < t.length; i++) {
    const k = Math.round((t[i] - t0) / stepMs);
    if (isNum(h[i])) { sh[k] += h[i]; ch[k]++; }
    if (isNum(b[i])) { sb[k] += b[i]; cb[k]++; }
  }
  const gt = new Array(n), gh = new Array(n), gb = new Array(n);
  for (let k = 0; k < n; k++) {
    gt[k] = t0 + k * stepMs;
    gh[k] = ch[k] ? sh[k] / ch[k] : NaN;
    gb[k] = cb[k] ? sb[k] / cb[k] : NaN;
  }
  return { t: gt, h: gh, b: gb, n, stepMs };
}

/**
 * input: { t: ms[], level: number[], baro: number[] }
 * opts:  { levelKind: 'depth'|'head'|'absolute', levelUnit, baroUnit }
 * Internally everything is metres of water, with up positive.
 */
export function prepare(input, opts) {
  const lu = UNITS[opts.levelUnit], bu = UNITS[opts.baroUnit];
  if (!lu || !bu) throw new Error(`Unknown unit: ${lu ? opts.baroUnit : opts.levelUnit}`);
  if (!['head', 'depth', 'absolute'].includes(opts.levelKind)) throw new Error('Say whether the water level is a height, a depth or an absolute pressure.');
  if (isNum(opts.lat) && isNum(opts.lon) && !isNum(opts.utcOffsetHours)) throw new Error('The earth tide needs the file clock, in hours from UTC.');
  const rows = orderRows(input);
  const { t, level: levelRaw, baro: baroRaw } = rows;
  if (t.length < 24) throw new Error('This file has fewer than 24 timed rows. A useful correction needs at least a few days of data.');

  const dtMs = median(t.slice(1).map((x, i) => x - t[i]));

  // A record mostly outside the air pressure range is relative pressure or a wrong
  // unit, not bad data, so the range check only applies to absolute records.
  const baroM = baroRaw.map((x) => x * bu);
  const inRange = (x) => x > AIR_MIN_M && x < AIR_MAX_M;
  const present = baroM.filter(isNum);
  const absoluteBaro = present.filter(inRange).length > present.length / 2;
  const baroImpossible = baroM.map((x, i) => isNum(x) && (isMissingCode(baroRaw[i]) || (absoluteBaro && !inRange(x))));
  const baroPassed = baroM.map((x, i) => (baroImpossible[i] ? NaN : x));
  const baroSpike = flagSpikes(baroPassed, dtMs);
  const baroClean = baroPassed.map((x, i) => (baroSpike[i] ? NaN : x));
  if (baroClean.filter(isNum).length < 12) {
    throw new Error('No usable barometric pressure was found. Choose the right column, or add a barometer record for this period.');
  }
  const filled = fillBaro(t, baroClean);
  const baro = filled.series;

  const levelCode = levelRaw.map(isMissingCode);
  const sign = opts.levelKind === 'depth' ? -1 : 1;
  const hAll = levelRaw.map((x, i) => (levelCode[i] ? NaN : sign * x * lu));
  const h = opts.levelKind === 'absolute' ? hAll.map((x, i) => x - baro[i]) : hAll;
  const levelSpike = flagSpikes(h, dtMs);
  const hClean = h.map((x, i) => (levelSpike[i] ? NaN : x));

  // Hourly, or the record's own step when that is longer.
  const stepMs = dtMs <= HOUR ? HOUR : dtMs;
  const grid = buildGrid(t, hClean, baro, stepMs);

  const flags = t.map((_, i) => {
    const f = [];
    if (levelCode[i]) f.push('level fill code');
    if (levelSpike[i]) f.push('level spike');
    if (baroImpossible[i]) f.push('barometer impossible');
    if (baroSpike[i]) f.push('barometer spike');
    if (filled.filledGap[i]) f.push('barometer interpolated');
    if (!isNum(baro[i])) f.push('no barometer');
    return f.join('; ');
  });

  return {
    t, srcRow: rows.srcRow, levelRaw, baroRaw, h, baro, flags, grid,
    stepH: stepMs / HOUR, dtH: dtMs / HOUR, spanH: (t[t.length - 1] - t[0]) / HOUR,
    levelToM: lu, baroToM: bu, sign,
    counts: {
      untimed: rows.untimed, duplicates: rows.duplicates,
      levelCodes: levelCode.filter(Boolean).length, levelSpikes: levelSpike.filter(Boolean).length,
      baroImpossible: baroImpossible.filter(Boolean).length, baroSpikes: baroSpike.filter(Boolean).length,
      baroFilled: filled.filledGap.filter(Boolean).length,
    },
    baroResolutionM: smallestStep(baroClean.filter(isNum)),
    absoluteBaro,
  };
}
