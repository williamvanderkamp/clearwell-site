// Everything converts to metres of water at 10 C.
const M_PER_KPA = 1 / (0.9997 * 9.80665);

export const UNITS = {
  m: 1, ft: 0.3048, cm: 0.01, mm: 0.001, in: 0.0254,
  kPa: M_PER_KPA, hPa: M_PER_KPA / 10, mbar: M_PER_KPA / 10, Pa: M_PER_KPA / 1000,
  psi: 6.894757 * M_PER_KPA, mmHg: 0.1333224 * M_PER_KPA, inHg: 3.386389 * M_PER_KPA,
  atm: 101.325 * M_PER_KPA, bar: 100 * M_PER_KPA, mH2O: 1, ftH2O: 0.3048, cmH2O: 0.01,
};

// Times, in days, and their names.
export const TIME_UNITS = { s: 1 / 86400, min: 1 / 1440, h: 1 / 24, d: 1 };
export const TIME_NAMES = { s: 'seconds', min: 'minutes', h: 'hours', d: 'days' };

// Pumping rates, in cubic metres per day.
export const RATE_UNITS = {
  'm3/d': 1, 'm3/h': 24, 'L/s': 86.4, 'L/min': 1.44, 'US gpm': 5.450993, 'ft3/d': 0.02831685,
};
