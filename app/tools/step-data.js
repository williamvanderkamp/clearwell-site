// Published step-drawdown data for the examples and tests, copied from Kruseman and de
// Ridder (1994), section 14.1. No page code here, so the tests can read it too.
import { toCsv } from '../format.js';

// Table 14.1: Clark (1977), 'Well 1', a confined sandstone aquifer. Six steps; the
// readings run to minute 180 of each step. A null is a dash in the book.
export const CLARK_MINUTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 150, 180];
export const CLARK_RATES = [1306, 1693, 2423, 3261, 4094, 5019];
export const CLARK_DRAWDOWN = [
  [null, null, null, null, 1.303, 2.289, 3.117, 3.345, 3.486, 3.521, 3.592, 3.627, 3.733, 3.768, 3.836, 3.873, 4.014, 3.803, 4.043, 4.261, 4.261, 4.190, 4.120, 4.120, 4.226, 4.226, 4.226, 4.402, 4.402, 4.683],
  [5.458, 5.529, 5.564, 5.599, 5.634, 5.669, 5.669, 5.705, 5.740, 5.740, 5.810, 5.810, 5.824, 5.845, 5.810, 5.824, 5.824, 5.881, 5.591, 5.591, 6.092, 6.092, 6.176, 6.162, 6.176, 6.169, 6.169, 6.176, 6.374, 6.514],
  [8.170, 8.240, 8.346, 8.451, 8.486, 8.557, 8.557, 8.592, 8.672, 8.672, 8.663, 8.698, 8.733, 8.839, 8.874, 8.874, 8.979, 8.979, 8.994, 9.050, 9.050, 9.120, 9.120, 9.155, 9.191, 9.191, 9.226, 9.261, 9.367, 9.578],
  [10.881, 11.797, 11.902, 12.008, 12.078, 12.149, 12.149, 12.184, 12.219, 12.325, 12.360, 12.395, 12.430, 12.430, 12.501, 12.508, 12.606, 12.712, 12.747, 12.783, 12.818, 12.853, 12.853, 12.888, 12.923, 12.994, 12.994, 13.099, 13.205, 13.240],
  [15.318, 15.494, 15.598, 15.740, 15.846, 15.881, 15.952, 16.022, 16.022, 16.093, 16.198, 16.268, 16.304, 16.374, 16.409, 16.586, 16.621, 16.691, 16.726, 16.776, 16.797, 16.902, 16.938, 16.973, 17.079, 17.079, 17.114, 17.219, 17.325, 17.395],
  [20.036, 20.248, 20.389, 20.529, 20.600, 20.660, 20.741, 20.811, 20.882, 20.917, 20.952, 21.022, 21.128, 21.163, 21.198, 21.304, 21.375, 21.480, 21.551, 21.619, 21.656, null, 21.663, 21.691, 21.762, 21.832, 21.903, 22.008, 22.184, 22.325],
];
export const CLARK_STEP_MINUTES = 180;

/** Table 14.1 as one record: time since pumping began, minutes, and drawdown, m. */
export function clarkSeries() {
  const t = [], s = [];
  CLARK_DRAWDOWN.forEach((col, n) => col.forEach((v, i) => {
    if (v === null) return;
    t.push(n * CLARK_STEP_MINUTES + CLARK_MINUTES[i]);
    s.push(v);
  }));
  return { t, s };
}

// Table 14.2: the book's s_w(n) for dt = 100 min, read from its hand-drawn lines, and
// its answer: B = 3.26e-3 d/m2, C = 1.45e-7 d2/m5.
export const CLARK_BOOK = { sw: [4.25, 5.95, 8.75, 12.15, 15.80, 20.00], B: 3.26e-3, C: 1.45e-7 };

// Table 14.3: Sheahan (1971), total drawdown s_w(n) in m against rate in m3/d. The
// book's answer by Rorabaugh's method: B = 1.0e-3 d/m2, P = 2.85, C = 1.4e-10.
export const SHEAHAN = { Q: [2180, 3815, 6540, 9811], sw: [2.62, 6.10, 17.22, 42.98], B: 1.0e-3, P: 2.85, C: 1.4e-10 };

// The headings of a file with one row per step.
export const STEP_HEADER = ['Step', 'Rate (m3/d)', 'Drawdown (m)'];
/** Table 14.2 as one row per step: step, rate and the book's s_w(n). */
export const clarkSteps = () => CLARK_RATES.map((q, i) => [i + 1, q, CLARK_BOOK.sw[i]]);

export function clarkCsv() {
  const { t, s } = clarkSeries();
  return toCsv(['Time since pumping began (min)', 'Drawdown (m)'], t.map((x, i) => [x, s[i].toFixed(3)]));
}

export const sheahanCsv = () => toCsv(STEP_HEADER, SHEAHAN.Q.map((q, i) => [i + 1, q, SHEAHAN.sw[i]]));
export const clarkTableCsv = () => toCsv(STEP_HEADER, clarkSteps());
