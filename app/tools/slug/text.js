// The slug test page's numbers in words, where no page is needed to make them, so that
// they can be tested in Node: number styles, the note on rows left out, and the notes on a
// van der Kamp (1976) analysis (vdkWarnings), which say where the record or the result
// falls outside what the paper and the fit can stand behind.
import { UNITS } from '../../../engine/index.js';
import { fixed, minus, sig, tenTo, unit } from '../../../engine/format.js';

// Four figures with their trailing zeros, so 1.890 sits beside 0.2994, not 1.89.
export const four = (x) => sig(x, 4, true);
// x as m × 10ⁿ with 4 figures, so both ends of an interval share one style, as on the
// pumping test page: 9.811 × 10⁻⁴ to 3.289 × 10⁻³, not 9.811 × 10⁻⁴ to 0.003289.
export const sci = (x) => {
  if (x === 0) return '0';
  const [m, e] = x.toExponential(3).split('e');
  return minus(`${m} × ${tenTo(Number(e))}`);
};
export const plainRange = (x) => x === 0 || (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e6);
export const interval = (lo, hi) => (plainRange(lo) && plainRange(hi) ? `${four(lo)} to ${four(hi)}` : `${sci(lo)} to ${sci(hi)}`);
// K of natural materials, from clay to clean gravel, spans about 1e-13 to 1 m/s.
export const K_RANGE = [1e-13, 1];
// Rows counted from the first one below the headings: 1, 4, 9 and 3 more.
export const listRows = (rows) => {
  const shown = rows.slice(0, 8).map((i) => i + 1);
  return rows.length > 8 ? `${shown.join(', ')} and ${rows.length - 8} more` : shown.join(', ');
};
export const skippedNote = (skipped) => {
  const one = skipped.length === 1;
  return `${one ? 'One row' : `${skipped.length} rows`} without a number for both time and level ${one ? 'was' : 'were'} left out: row${one ? '' : 's'} ${listRows(skipped)}, counting down from the headings and skipping blank rows.`;
};

// T in the well-size unit squared per day, and an interval of it, for the notes.
export const vdkT = (v, x) => `${four(x * 86400 / UNITS[v.lUnit] ** 2)} ${unit(`${v.lUnit}2/d`)}`;
export const vdkInterval = (v, [lo, hi]) => interval(lo * 86400 / UNITS[v.lUnit] ** 2, hi * 86400 / UNITS[v.lUnit] ** 2);
// Misfits that run in long stretches of one sign, by the runs test.
export const vdkCorrelated = (r) => Boolean(r.fit.runs && r.fit.runs.poor);

export function vdkWarnings(v, r, geo, skipped, dropped) {
  const out = [];
  if (skipped.length) out.push(skippedNote(skipped));
  if (dropped) out.push(dropped);
  const f = r.fit, correlated = vdkCorrelated(r);
  // p. 74: critical damping is put at d = 0.7, the paper's hypothesis from the analog of
  // Bredehoeft et al. (1966) (d = 0.69) and from gamma = omega (d = 1/sqrt 2).
  if (r.d >= 0.7) out.push(`d = ${sig(r.d, 3)} is at or above 0.7, where van der Kamp (1976, p. 74) puts critical damping: the method does not apply, and T is the value the paper's equations give, not an estimate. A method for an overdamped or critically damped response, such as Butler and Zhan (2004), fits this record better.`);
  else if (r.intervals.d[1] >= 0.7) out.push(`d's 95% interval reaches 0.7, where van der Kamp (1976) puts critical damping; the paper finds the method unreliable as d nears 0.7 (p. 76).`);
  // The paper's own range for the change from one kind of response to the other.
  else if (r.d >= 0.4) out.push(`d = ${sig(r.d, 3)} is between 0.4 and 0.7. Among van der Kamp's (1976) wells the change from underdamped to overdamped response came at "values of d between about 0.4 and 1.2" (p. 74), and he finds the method "may not be reliable" when d is only slightly less than 0.7, putting part of the gap between T from the response and from the pumping test at his well 2C, d = 0.38, down to the approximate nature of the theory as d approaches 0.7 (p. 76). Take T here as less sure than its interval says, and compare Butler and Zhan (2004).`);
  if (!r.settled) out.push(`The paper's iteration (40) for T had not settled after ${r.steps.length - 1} steps: T solves eq. 38 only to ${sig(r.residual, 2)} of itself. That happens near the values where eq. 38's two roots meet and beyond which it has none, where T moves strongly with S and rw (dlnT/dlnS = ${sig(r.dlnTdlnS, 3)}). Check S and rw.`);
  // (28): alpha << 0.1. On p. 73 the paper reads this as |ln alpha| > 4.6, alpha < 0.01,
  // beside the imaginary part of (26), at most pi/2, that (29) leaves out.
  if (r.alpha >= 0.1) out.push(`α = ${sig(r.alpha, 3)}, so condition (28), α ≪ 0.1, does not hold: the approximation of K0 behind eq. 38 fails. Check S and rw.`);
  else if (r.alpha > 0.01) out.push(`α = ${sig(r.alpha, 3)} is above 0.01, the paper's reading of α ≪ 0.1 (p. 73): the part of ln(0.89 q rw) its approximation (29) leaves out is then more than a third of the part kept. Compare T without that approximation, in the method text.`);
  if (r.crests.length < 3) out.push(`Only ${r.crests.length} crest${r.crests.length === 1 ? '' : 's'} of the fitted cosine stand${r.crests.length === 1 ? 's' : ''} above the scatter, fewer than the two successive peaks of one sign the paper's reading needs: γ and ω rest on less than one cycle.`);
  if (correlated) out.push(`The misfits run in long stretches of one sign (${f.runs.runs} runs, where random misfits give about ${Math.round(f.runs.mean)}), and one misfit correlates with the next by ${fixed(f.lag1, 2)}: the record departs from the damped cosine of eq. 7 by more than its scatter, so the intervals of the plain fit are too narrow, since they assume independent misfits.${r.serial ? ` Allowing for the correlation (Cochrane and Orcutt 1949), T is ${vdkT(v, r.serial.T)}, ${vdkInterval(v, r.serial.interval)}: that is the interval to go by, shown in the table beneath the plain fit's.` : ''} The misfit chart shows where the curve departs.`);
  if (r.serialFailed) out.push(`The second fit, allowing for misfits correlated from one reading to the next (Cochrane and Orcutt 1949), could not be made: ${r.serialFailed} It is left out; the plain fit stands${correlated ? ', with its intervals too narrow' : ''}.`);
  // The paper's reading of two peaks, where it falls outside the interval of the fit.
  const g = r.graphical, held = correlated && r.serial ? r.serial.interval : r.intervals.T;
  if (g && g.T && (g.T < held[0] || g.T > held[1])) out.push(`The paper's own reading of the first two peaks gives T = ${vdkT(v, g.T)}, outside the fit's 95% interval (${vdkInterval(v, held)}). Taking the highest reading at each peak carries the scatter with it, more so at the smaller, later peak, and the more readings near a peak, the higher the highest of them: on this record that reading is not to be relied on, and the fit is.`);
  if (r.split && r.split.error) out.push(`The early and late parts of the record could not be compared: ${r.split.error} That comparison is only a check, so it is left out; the fit to the whole record stands.`);
  else if (r.split) {
    for (const [id, sym] of [['gamma', 'γ'], ['omega', 'ω']]) {
      const c = r.split[id];
      if (!c.differs) continue;
      const why = id !== 'gamma' ? '' : c.early > c.late
        ? ' A damping larger while the water moves fast is what friction growing with its speed does (van der Kamp 1976, eqs. 50 to 52; McElwee and Zenner 1998).'
        : ' A damping larger late, as the oscillation dies away, is what the steps of the readings\' resolution do once the swings are a few steps high, and what the slow return that the aquifer\'s storage adds (left out of eq. 7, and in Butler and Zhan\'s exact model) does.';
      // Where the misfits correlate, the test is less sure than its level says (the
      // simulations in the documentation), so the difference is not put down to a cause.
      const caution = correlated ? ' The misfits correlate, though, and on records of one damped cosine with scatter as correlated, a difference this large came by chance in up to 1 test in 10 rather than 1 in 20, so it is not put down here to friction in the well or to anything else.' : '';
      out.push(`${sym} early in the record (${four(c.early)} per s) and late (${four(c.late)} per s) differ by more than the scatter allows (z = ${fixed(c.z, 1)} against ${fixed(r.split.zLimit, 2)}), where the paper's model has one ${sym}.${correlated ? caution : why}`);
    }
  }
  if (r.friction.laminar && !r.friction.laminar.met) out.push(`Laminar friction in the well may matter: 4ν/rc² = ${sig(r.friction.laminar.left, 3)} per s is not much less than γ = ${sig(r.friction.laminar.right, 3)} per s (van der Kamp 1976, eq. 49).`);
  if (r.friction.turbulent && !r.friction.turbulent.met) out.push(`Turbulent friction in the well may matter: 0.005 w0/rc = ${sig(r.friction.turbulent.left, 3)} is not much less than γ/ω = ${sig(r.friction.turbulent.right, 3)} (van der Kamp 1976, eq. 52). A smaller initial displacement reduces it (Butler and Garnett 2000).`);
  if (!r.friction.turbulent) out.push('The turbulent friction check (52) needs the initial displacement as a length: put the unit of the level column in its heading, such as Displacement (m), to have it made.');
  if (geo.Lf !== undefined && geo.D !== undefined && geo.Lf < geo.D * (1 - 1e-9)) out.push('The screen is shorter than the aquifer is thick. van der Kamp (1976) is for a fully penetrating well (Butler and Garnett 2000); with a partial screen T here is not the aquifer\'s, and the flow it ignores makes the response faster, so T / D understates K and T / Le overstates it. Butler and Zhan (2004) and the high-K models handle partial penetration.');
  if (r.K !== undefined && (r.K < K_RANGE[0] || r.K > K_RANGE[1])) out.push(`K = ${sig(r.K)} m/s is outside the range of natural materials, about ${tenTo(-13)} to 1 m/s. Check the well sizes and their unit, and the time unit.`);
  if (!f.converged) out.push('The fit stopped without settling.');
  return out;
}
