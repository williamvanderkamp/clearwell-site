// Hydraulic conductivity from a sieve analysis, as HydrogeoSieveXL 2.1 computes it
// (Devlin 2015). Every formula, constant and range test follows that program's
// Visual Basic code, so results match it. Sizes are in mm, K in cm/s inside.
import { mean } from './numeric.js';
import * as libm from './libm.js';

export const G = 980; // cm/s², as in HydrogeoSieveXL
export const SIZE_UNITS = { mm: 1, um: 0.001, in: 25.4 };

/** Water density (g/cm³), viscosity (g/cm s) and Sauerbrei's tau at T in °C, from HydrogeoSieveXL. */
export function water(T) {
  if (!Number.isFinite(T)) throw new Error('Enter the water temperature.');
  if (T < 0 || T > 100) throw new Error('The water temperature must be between 0 and 100 °C.');
  const rho = 3.1e-8 * T * T * T - 7.0e-6 * T * T + 4.19e-5 * T + 0.99985;
  const mu = -7.0e-8 * T * T * T + 1.002e-5 * T * T - 5.7e-4 * T + 0.0178;
  const tau = 1.093e-4 * T * T + 2.102e-2 * T + 0.5889;
  return { rho, mu, tau, gRhoMu: (G * rho) / mu };
}

/** Percent passing from mass retained, as HydrogeoSieveXL does: the finest sieve passes 0%. Sizes in descending order. */
export function passingFromMass(masses) {
  const total = masses.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error('The retained masses add up to zero.');
  const pp = new Array(masses.length).fill(0);
  for (let i = masses.length - 2; i >= 0; i--) pp[i] = pp[i + 1] + (masses[i + 1] / total) * 100;
  return pp;
}

/**
 * Sorts sieves from coarsest to finest and checks them. sizes in mm.
 * amount is percent passing, or mass retained when mass is true.
 */
export function sieveCurve(sizes, amount, mass) {
  const rows = sizes.map((d, i) => [d, amount[i]]).filter(([d, a]) => Number.isFinite(d) && Number.isFinite(a));
  if (rows.length < 2) throw new Error('Give at least two sieves with a size and a number.');
  if (rows.some(([d]) => !(d > 0))) throw new Error('Every sieve opening must be above zero.');
  rows.sort((a, b) => b[0] - a[0]);
  for (let i = 1; i < rows.length; i++) if (rows[i][0] === rows[i - 1][0]) throw new Error(`The sieve size ${rows[i][0]} mm appears twice.`);
  const ps = rows.map((r) => r[0]);
  if (mass) {
    if (rows.some(([, m]) => m < 0)) throw new Error('A retained mass is below zero.');
    return { ps, pp: passingFromMass(rows.map((r) => r[1])) };
  }
  const pp = rows.map((r) => r[1]);
  if (pp.some((p) => p < 0 || p > 100)) throw new Error('Percent passing must be between 0 and 100.');
  for (let i = 1; i < pp.length; i++) if (pp[i] > pp[i - 1]) throw new Error(`Percent passing rises from ${pp[i - 1]} to ${pp[i]} as the sieves get finer. Check the numbers.`);
  return { ps, pp };
}

/**
 * The size at which P percent passes: linear in mm between the two sieves that
 * bracket it, as HydrogeoSieveXL does. NaN when the curve does not reach P.
 */
export function percentile(ps, pp, P) {
  const i = pp.findIndex((p) => p < P);
  if (i < 1) return NaN;
  return ((ps[i - 1] - ps[i]) * (P - pp[i])) / (pp[i - 1] - pp[i]) + ps[i];
}

// The effective diameters sum over the fraction between each pair of sieves.
// Kozeny, Zunker and Zamarin add the fines below the finest sieve only when that
// sieve is finer than 0.0025 mm, as in HydrogeoSieveXL.
function effective(ps, pp, term, fines) {
  let inv = fines && ps[ps.length - 1] < 0.0025 ? (1.5 * pp[pp.length - 1]) / 100 / 0.0025 : 0;
  for (let i = 0; i < ps.length - 1; i++) inv += ((pp[i] - pp[i + 1]) / 100) * term(ps[i], ps[i + 1]);
  return 1 / inv;
}

export function effectiveDiameters(ps, pp) {
  return {
    kruger: effective(ps, pp, (a, b) => 2 / (a + b), false),
    kozeny: effective(ps, pp, (a, b) => (0.5 * (a + b)) / (a * b), true),
    zunker: effective(ps, pp, (a, b) => (a - b) / (a * b * libm.log(a / b)), true),
    zamarin: effective(ps, pp, (a, b) => libm.log(a / b) / (a - b), true),
  };
}

const phi = (d) => 1.4427 * libm.log(d);

/** The grain sizes and parameters every method draws on. */
export function grainSizes(ps, pp) {
  const at = (P) => percentile(ps, pp, P);
  const d = { d5: at(5), d10: at(10), d16: at(16), d17: at(17), d20: at(20), d50: at(50), d60: at(60), d84: at(84), d95: at(95) };
  if (!Number.isFinite(d.d10) || !Number.isFinite(d.d60)) throw new Error('The curve has to pass through 10% and 60% passing to give d10 and d60. Add finer or coarser sieves.');
  const U = d.d60 / d.d10;
  const f = { phi5: phi(d.d5), phi16: phi(d.d16), phi50: 3.3193 * libm.log10(d.d50), phi84: phi(d.d84), phi95: phi(d.d95) };
  return {
    ...d, ...f, U,
    n: 0.255 * (1 + libm.pow(0.83, U)),
    dgm: libm.pow(2, (f.phi16 + f.phi50 + f.phi84) / 3),
    sigma: (f.phi84 - f.phi16) / 4 + (f.phi95 - f.phi5) / 6.6,
    I0: d.d10 - (d.d50 - d.d10) / 4,
    finest: ps[ps.length - 1],
    ...effectiveDiameters(ps, pp),
  };
}

const kc = (n) => (n * n * n) / ((1 - n) * (1 - n));
const ALWAYS = 'None stated, so always counted';

/**
 * The 15 methods in HydrogeoSieveXL's order. Each gives K in cm/s from the grain
 * sizes g (mm) and water w, and check(g) is HydrogeoSieveXL's range test.
 */
export const METHODS = [
  { id: 'hazen', name: 'Hazen (1892)', size: 'd10', range: '0.1 < d10 < 3 mm and U < 5',
    K: (g, w) => w.gRhoMu * 6e-4 * (1 + 10 * (g.n - 0.26)) * libm.pow(g.d10 / 10, 2),
    check: (g) => g.d10 / 10 > 0.01 && g.d10 / 10 < 0.3 && g.U < 5 },
  { id: 'hazen-simple', name: 'Hazen simplified (Freeze and Cherry 1979)', size: 'd10', range: 'Not tested by HydrogeoSieveXL 2.1, so never counted', never: true,
    K: (g) => g.d10 * g.d10, check: () => false },
  { id: 'slichter', name: 'Slichter (1898)', size: 'd10', range: '0.1 < d10 < 5 mm',
    K: (g, w) => w.gRhoMu * 0.01 * libm.pow(g.n, 3.287) * libm.pow(g.d10 / 10, 2),
    check: (g) => g.d10 / 10 > 0.01 && g.d10 / 10 < 0.5 },
  { id: 'terzaghi', name: 'Terzaghi (1925)', size: 'd10', range: 'd50 > 0.5 mm and U > 2 (coarse sand)',
    K: (g, w) => w.gRhoMu * 0.0084 * libm.pow((g.n - 0.13) / libm.pow(1 - g.n, 1 / 3), 2) * libm.pow(g.d10 / 10, 2),
    check: (g) => g.d50 > 0.5 && g.U > 2 },
  { id: 'beyer', name: 'Beyer (1964)', size: 'd10', range: '0.06 < d10 < 0.6 mm and 1 < U < 20',
    K: (g, w) => w.gRhoMu * 5.2e-4 * libm.log10(500 / g.U) * libm.pow(g.d10 / 10, 2),
    check: (g) => g.d10 / 10 > 0.006 && g.d10 / 10 < 0.06 && g.U > 1 && g.U < 20 },
  { id: 'sauerbrei', name: 'Sauerbrei (1932)', size: 'd17', range: 'd17 < 0.5 mm (sand and sandy clay)',
    K: (g, w) => w.gRhoMu * 0.00375 * w.tau * kc(g.n) * libm.pow(g.d17 / 10, 2),
    check: (g) => g.d17 / 10 < 0.05 },
  { id: 'kruger', name: 'Krüger (1919)', size: 'de (Krüger)', range: '0.25 < d50 < 0.5 mm and U > 5 (medium sand)',
    K: (g, w) => w.gRhoMu * 4.35e-4 * (g.n / libm.pow(1 - g.n, 2)) * libm.pow(g.kruger / 10, 2),
    check: (g) => g.d50 > 0.25 && g.d50 < 0.5 && g.U > 5 },
  { id: 'kozeny', name: 'Kozeny-Carman (Kozeny 1953)', size: 'de (Kozeny)', range: '0.5 < d50 < 2 mm and U > 2 (coarse sand)',
    K: (g, w) => w.gRhoMu * 0.0083 * kc(g.n) * libm.pow(g.kozeny / 10, 2),
    check: (g) => g.d50 > 0.5 && g.d50 < 2 && g.U > 2 },
  { id: 'zunker', name: 'Zunker (1930)', size: 'de (Zunker)', range: 'Finest sieve coarser than 0.0025 mm',
    K: (g, w) => w.gRhoMu * 0.00155 * libm.pow(g.n / (1 - g.n), 2) * libm.pow(g.zunker / 10, 2),
    check: (g) => g.finest > 0.0025 },
  { id: 'zamarin', name: 'Zamarin (1928)', size: 'de (Zamarin)', range: 'd50 > 0.4 mm and finest sieve coarser than 0.00025 mm',
    K: (g, w) => w.gRhoMu * 0.00865 * kc(g.n) * libm.pow(1.275 - 1.5 * g.n, 2) * libm.pow(g.zamarin / 10, 2),
    check: (g) => g.d50 > 0.4 && g.finest > 0.00025 },
  { id: 'usbr', name: 'USBR (Białas 1966)', size: 'd20', range: '0.25 < d50 < 5 mm and U < 5 (medium sand)',
    K: (g, w) => w.gRhoMu * 4.8e-4 * libm.pow(10, 0.3) * libm.pow(libm.pow(g.d20 / 10, 1.15), 2),
    check: (g) => g.d50 > 0.25 && g.d50 < 5 && g.U < 5 },
  { id: 'barr', name: 'Barr (2001)', size: 'd10', range: ALWAYS, always: true,
    K: (g, w) => w.gRhoMu * 0.00402 * kc(g.n) * libm.pow(g.d10 / 10, 2), check: () => true },
  { id: 'alyamani', name: 'Alyamani and Sen (1993)', size: 'd10, d50, I0', range: ALWAYS, always: true,
    K: (g) => (1300 * libm.pow(g.I0 + 0.025 * (g.d50 - g.d10), 2) * 100) / 86400, check: () => true },
  { id: 'chapuis', name: 'Chapuis (2004)', size: 'd10', range: '0.3 < n < 0.7, d10 > 0.1 mm, d10^(a/2) < 2 with a = 10^(0.5504 - 0.2937 e) the exponent on d10, 2 < U < 12, d10/d5 < 1.4',
    K: (g) => { const e = g.n / (1 - g.n); return libm.pow(10, 1.291 * e - 0.6435) * libm.pow(g.d10, libm.pow(10, 0.5504 - 0.2937 * e)); },
    check: (g) => {
      const e = g.n / (1 - g.n), a = libm.pow(10, 0.5504 - 0.2937 * e), d5 = libm.pow(10, g.phi5 / 3.3193);
      return g.n > 0.3 && g.n < 0.7 && g.d10 > 0.1 && libm.pow(g.d10, a / 2) < 2 && g.U > 2 && g.U < 12 && g.d10 / d5 < 1.4;
    } },
  { id: 'krumbein', name: 'Krumbein and Monk (1943)', size: 'geometric mean diameter', range: '0.063 < d50 < 2 mm (natural sand)',
    K: (g, w) => w.gRhoMu * 760 * libm.exp(-1.31 * g.sigma) * g.dgm * g.dgm * 9.869233e-9,
    check: (g) => g.d50 > 0.063 && g.d50 < 2 },
];

const geomean = (xs) => libm.exp(xs.reduce((a, x) => a + libm.log(x), 0) / xs.length);

/**
 * Everything from one sieve analysis. sizes in mm; amount is percent passing, or
 * mass retained when mass is true; T in °C. K in cm/s.
 */
export function grainSizeK({ sizes, amount, mass, T }) {
  const w = water(T);
  const { ps, pp } = sieveCurve(sizes, amount, mass);
  const g = grainSizes(ps, pp);
  const methods = METHODS.map((m) => {
    const K = m.K(g, w);
    return {
      id: m.id, name: m.name, size: m.size, range: m.range, always: Boolean(m.always), never: Boolean(m.never),
      K, counted: Number.isFinite(K) && K > 0 && m.check(g),
    };
  });
  const counted = methods.filter((m) => m.counted).map((m) => m.K);
  return {
    ps, pp, g, water: w, methods,
    geomean: counted.length ? geomean(counted) : NaN,
    mean: mean(counted),
    count: counted.length,
  };
}
