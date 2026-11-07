// Theoretical earth tide and the checks that use it.
//
// The tide is the vertical lunisolar tidal acceleration at the site, computed from
// low-precision positions of the moon and sun (Astronomical Almanac formulas), for
// a rigid earth. It is only used as a regressor, so only its shape and timing
// matter: the well's own gain and delay come from the lagged regression, as they do
// in BETCO (Toll and Rasmussen 2007) and KGS BRF (Bohling et al. 2011).

import { DAY, HOUR, isNum, median } from './numeric.js';

const EPOCH = Date.UTC(2000, 0, 1, 12);
const rad = (d) => d * Math.PI / 180;

function bodyPositions(tMs) {
  const n = (tMs - EPOCH) / DAY, T = n / 36525;
  const s = (d) => Math.sin(rad(d)), co = (d) => Math.cos(rad(d));
  const lam = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T)
    + 0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T)
    - 0.11 * s(186.5 + 966404.03 * T);
  const bet = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T)
    - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * co(135.0 + 477198.87 * T) + 0.0095 * co(259.3 - 413335.36 * T)
    + 0.0078 * co(235.7 + 890534.22 * T) + 0.0028 * co(269.9 + 954397.74 * T);
  const distMoon = 6378137 / Math.sin(rad(par));
  const eps = rad(23.439 - 3.6e-7 * n);
  const toEquatorial = (l, b, r) => {
    const cl = Math.cos(l), sl = Math.sin(l), cb = Math.cos(b), sb = Math.sin(b);
    return [r * cb * cl, r * (Math.cos(eps) * cb * sl - Math.sin(eps) * sb), r * (Math.sin(eps) * cb * sl + Math.cos(eps) * sb)];
  };
  const g = 357.528 + 0.9856003 * n;
  const lamS = 280.460 + 0.9856474 * n + 1.915 * s(g) + 0.020 * s(2 * g);
  const au = 1.00014 - 0.01671 * co(g) - 0.00014 * co(2 * g);
  return {
    moon: toEquatorial(rad(lam), rad(bet), distMoon),
    sun: toEquatorial(rad(lamS), 0, au * 149597870700),
    gmst: rad(280.46061837 + 360.98564736629 * n),
  };
}

// Vertical tidal acceleration at a site, in microgal, at UTC time tMs.
export function gravityTide(tMs, lat, lon) {
  const p = bodyPositions(tMs);
  const th = p.gmst + rad(lon), phi = rad(lat), r = 6371000;
  const site = [Math.cos(phi) * Math.cos(th), Math.cos(phi) * Math.sin(th), Math.sin(phi)];
  const term = (pos, gm) => {
    const d = Math.hypot(pos[0], pos[1], pos[2]);
    const c = (pos[0] * site[0] + pos[1] * site[1] + pos[2] * site[2]) / d;
    return gm * r / (d * d * d) * (3 * c * c - 1);
  };
  return (term(p.moon, 4.9028e12) + term(p.sun, 1.32712e20)) * 1e8;
}

// Tidal lines in cycles per day. M2 and O1 are purely gravitational; K1 and S2 also
// carry atmospheric and daily-cycle energy, so they are shown but never tested.
export const LINES = { O1: 0.9295357, K1: 1.0027379, M2: 1.9322736, S2: 2.0 };

// Least-squares amplitude of one frequency in a gridded series, fitted to changes
// between steps so that trends and seasonal movement don't matter.
export function amplitudeAt(series, tMs, cpd, include) {
  const w = 2 * Math.PI * cpd / DAY;
  let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0, n = 0;
  for (let i = 1; i < series.length; i++) {
    if (!isNum(series[i]) || !isNum(series[i - 1]) || (include && !include(i))) continue;
    const c = Math.cos(w * tMs[i]) - Math.cos(w * tMs[i - 1]);
    const d = Math.sin(w * tMs[i]) - Math.sin(w * tMs[i - 1]);
    const y = series[i] - series[i - 1];
    s11 += c * c; s12 += c * d; s22 += d * d; t1 += c * y; t2 += d * y; n++;
  }
  const det = s11 * s22 - s12 * s12;
  if (n < 8 || !(det > 0)) return NaN;
  return Math.hypot((t1 * s22 - t2 * s12) / det, (t2 * s11 - t1 * s12) / det);
}

const range = (from, to, step) => {
  const out = [];
  for (let f = from; f < to + 1e-9; f += step) out.push(f);
  return out;
};
// Quiet parts of each tidal band, away from every sizeable tidal line.
const DIURNAL_FLOOR = [...range(0.78, 0.86, 0.02), ...range(1.12, 1.24, 0.02)];
const SEMIDIURNAL_FLOOR = [...range(1.70, 1.82, 0.02), ...range(2.10, 2.24, 0.02)];
export const TIDE_SNR_THRESHOLD = 3;

// Does the series show a response at M2 or O1? Each line is compared with the median
// amplitude at quiet frequencies in its own band. For white noise a line passes a
// ratio of 3 about 1 time in 500.
export function tideResponse(series, tMs, include) {
  const at = (f) => amplitudeAt(series, tMs, f, include);
  const m2 = at(LINES.M2), o1 = at(LINES.O1);
  const m2Floor = median(SEMIDIURNAL_FLOOR.map(at)), o1Floor = median(DIURNAL_FLOOR.map(at));
  const m2Snr = m2 / m2Floor, o1Snr = o1 / o1Floor;
  return {
    m2, o1, m2Floor, o1Floor, m2Snr, o1Snr,
    detected: m2Snr >= TIDE_SNR_THRESHOLD || o1Snr >= TIDE_SNR_THRESHOLD,
  };
}

// Tide in level space on the model grid, delayed by `lagSteps`. Blank nowhere.
export function tideSeries(tMs, stepMs, lagSteps, lat, lon, utcOffsetHours) {
  const shift = (utcOffsetHours || 0) * HOUR + lagSteps * stepMs;
  const out = new Float64Array(tMs.length);
  for (let i = 0; i < tMs.length; i++) out[i] = gravityTide(tMs[i] - shift, lat, lon);
  return out;
}
