// Forward Theis (1935): the drawdown a well would cause, from known T and S. The
// inverse of the pumping test analysis, used to plan a test or check interference.
import { wellFunction } from './pumping.js';

/**
 * Drawdown in m at each distance and time. T in m2/d, S dimensionless, Q in m3/d,
 * r in m, t in days. Several wells add by superposition: wells is [{ Q, r }].
 */
export function predictDrawdown({ T, S, wells, t }) {
  if (!(T > 0) || !(S > 0)) throw new Error('Transmissivity and storativity must be above zero.');
  const at = (w, day) => (w.Q / (4 * Math.PI * T)) * wellFunction((w.r ** 2 * S) / (4 * T * day));
  // Before pumping starts there is no drawdown.
  return t.map((day) => wells.reduce((sum, w) => (day > 0 ? sum + at(w, day) : sum), 0));
}

/**
 * The distances typed in one box, split at commas, semicolons or spaces. Throws an
 * error naming every entry that is not a number above zero, so none is dropped
 * unseen. A distance listed twice is kept once and named in twice.
 */
export function parseDistances(text) {
  const parts = String(text ?? '').split(/[,;\s]+/).filter(Boolean);
  const bad = parts.filter((p) => !(Number(p) > 0 && Number.isFinite(Number(p))));
  if (bad.length) throw new Error(`Distances: each must be a number above zero, and ${bad.length === 1 ? 'this one is' : 'these are'} not: ${bad.join(', ')}.`);
  if (!parts.length) throw new Error('Distances: enter at least one distance above zero.');
  const all = parts.map(Number), distances = [...new Set(all)];
  const twice = distances.filter((r) => all.indexOf(r) !== all.lastIndexOf(r));
  return { distances, twice };
}
