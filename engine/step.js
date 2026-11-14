// Step-drawdown test: the well loss equation of Jacob (1947), s = BQ + CQ^2, or of
// Rorabaugh (1953), s = BQ + CQ^P, fitted by the Hantush (1964) and Bierschenk (1963)
// method as set out in Kruseman and de Ridder (1994), section 14.1. Units are the
// caller's, as long as they are consistent.

import { fitLine, goldenMin } from './numeric.js';
import { RATE_UNITS, UNITS } from './units.js';
import * as libm from './libm.js';

/** Least squares line y = a + b x, with its residual sum of squares. */
export function line(x, y) {
  const f = fitLine(x, y);
  if (!Number.isFinite(f.slope)) throw new Error('A line needs at least two different values.');
  return { a: f.intercept, b: f.slope, rss: f.rss };
}

// Linear interpolation inside the readings; undefined outside them.
function valueAt(t, s, at) {
  for (let i = 0; i < t.length; i++) {
    if (t[i] === at) return s[i];
    if (i > 0 && t[i - 1] < at && t[i] > at) return s[i - 1] + ((s[i] - s[i - 1]) * (at - t[i - 1])) / (t[i] - t[i - 1]);
  }
  return undefined;
}

/**
 * Procedure 14.1 of Kruseman and de Ridder (1994): the drawdown increment of each step
 * at a fixed time dt after it began, measured from the straight line (drawdown against
 * log time since the test began) through the preceding step, extended. The line
 * through each step uses its readings from fitFrom after the step began to its end.
 * t and s: readings in time order. starts and rates: one per step, in order.
 */
export function hantushBierschenk({ t, s, starts, rates, dt, fitFrom }) {
  if (starts.length !== rates.length) throw new Error(`There are ${starts.length} step start times but ${rates.length} rates. Give one of each per step.`);
  if (starts.some((x, i) => i > 0 && !(x > starts[i - 1]))) throw new Error('Step start times must increase.');
  if (!(dt > 0)) throw new Error('The time into each step must be above zero.');
  if (!(fitFrom >= 0)) throw new Error('The time the line starts in each step must be zero or more.');
  const t0 = starts[0];
  const steps = starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : Infinity;
    const idx = t.map((_, i) => i).filter((i) => t[i] >= start && t[i] <= end && Number.isFinite(s[i]));
    return { n: n + 1, start, end, Q: rates[n], t: idx.map((i) => t[i]), s: idx.map((i) => s[i]) };
  });
  let sum = 0;
  return steps.map((st, n) => {
    if (n + 1 < steps.length && !(st.start + dt < st.end)) throw new Error(`Step ${st.n} is shorter than the time into each step (${dt}).`);
    const observed = valueAt(st.t, st.s, st.start + dt);
    if (observed === undefined) throw new Error(`Step ${st.n} has no readings on both sides of ${dt} after it began.`);
    let extrapolated = 0, trend = null;
    if (n > 0) {
      const prev = steps[n - 1];
      const use = prev.t.map((_, i) => i).filter((i) => prev.t[i] - prev.start >= fitFrom && prev.t[i] > t0);
      if (use.length < 2) throw new Error(`Step ${prev.n} has fewer than two readings from ${fitFrom} after it began, so its line cannot be drawn.`);
      trend = line(use.map((i) => libm.log10(prev.t[i] - t0)), use.map((i) => prev.s[i]));
      extrapolated = trend.a + trend.b * libm.log10(st.start + dt - t0);
    }
    const increment = observed - extrapolated;
    sum += increment;
    return { n: st.n, start: st.start, Q: st.Q, observed, extrapolated, increment, sw: sum, trend };
  });
}

/** Jacob's equation by Hantush-Bierschenk: the least squares line of s/Q against Q. */
export function fitJacob(Q, sw) {
  check(Q, sw);
  const f = line(Q, sw.map((v, i) => v / Q[i]));
  return { B: f.a, C: f.b, P: 2 };
}

/**
 * Rorabaugh's equation by Procedure 14.4: the B for which log(s/Q - B) against log Q is
 * straightest, taken as the least residual sum of squares of that line, searched from
 * zero to just below the smallest s/Q. The slope is P - 1 and the value at Q = 1 is C.
 */
export function fitRorabaugh(Q, sw) {
  check(Q, sw);
  const sq = sw.map((v, i) => v / Q[i]), top = Math.min(...sq), lx = Q.map(libm.log10);
  if (!(top > 0)) throw new Error('Every step needs drawdown above zero for this equation.');
  const at = (B) => line(lx, sq.map((v) => libm.log10(v - B)));
  const N = 2000;
  let k = 0;
  for (let i = 1; i < N; i++) if (at((top * i) / N).rss < at((top * k) / N).rss) k = i;
  // The grid finds the right neighbourhood; golden-section search refines it.
  const B = goldenMin((b) => at(b).rss, (top * Math.max(0, k - 1)) / N, (top * (k + 1)) / N, 100), f = at(B);
  return { B, C: libm.pow(10, f.a), P: f.b + 1 };
}

function check(Q, sw) {
  if (Q.length !== sw.length) throw new Error('Each step needs one rate and one drawdown.');
  if (Q.length < 3) throw new Error(`The fit needs at least three steps; there are ${Q.length}.`);
  if (Q.some((q) => !(q > 0))) throw new Error('Every step rate must be above zero.');
  if (new Set(Q).size !== Q.length) throw new Error('Two steps have the same rate. Each step needs its own rate.');
}

/** Drawdown, its two parts, well efficiency (Equation 14.3) and specific capacity at rate Q. */
export function atRate({ B, C, P }, Q) {
  const aquifer = B * Q, well = C * libm.pow(Q, P), s = aquifer + well;
  return { s, aquifer, well, efficiency: (100 * aquifer) / s, capacity: Q / s };
}

// Driscoll (1986), as quoted by Johnson (2005): T = 2000 Q/s for a confined aquifer and
// 1500 Q/s for an unconfined one, T in US gallons per day per foot and Q/s in US
// gallons per minute per foot.
const GPM = RATE_UNITS['US gpm'], FT = UNITS.ft;
const DRISCOLL = { confined: 2000, unconfined: 1500 };

/** Rough transmissivity in m2/d from specific capacity in m2/d (m3/d per m). */
export function driscollT(capacity, aquifer) {
  const k = DRISCOLL[aquifer];
  if (!k) throw new Error('Choose confined or unconfined.');
  return k * (capacity / (GPM / FT)) * (GPM / 1440 / FT);
}
