// The fit page's words for a fit: number styles, the notes on it (warnings), what its
// values mean (STATS_PLAIN), and the method text (valueText, methodText).
import { TIME_NAMES, UNITS } from '../../../engine/index.js';
import { logScale, PROFILE_BETTER, PROFILE_CALLS, PROFILE_RESTARTS, RUNS_SIMULATIONS, WIDE, WIDE_SKIN } from '../../../engine/fit.js';
import { verdictOf } from '../../verdicts.js';
import { corrText, listed, minus } from '../../../engine/format.js';
import { sig, tenTo, unit } from '../../kit.js';
import { fieldId, geometryLabel, kindOf, shortName, symbolOf, unitOf, withUnit } from './labels.js';
import { ABRAMOWITZ_STEGUN_1964, BATES_WATTS_1988_CHAPTER_6, BOURDET_ET_AL_1989_DOI, COOPER_JACOB_1946_DOI, FERRIS_ET_AL_1962, HILL_1998, KRUSEMAN_DE_RIDDER_1994, LEVENBERG_1944, MARQUARDT_1963 } from '../../../engine/refs.js';

export const four = (x) => sig(x, 4, true);
export const three = (x) => sig(x, 3, true);
// x as m × 10ⁿ with 4 figures, so both ends of an interval share one style.
const sci = (x) => {
  if (x === 0) return '0';
  const [m, e] = x.toExponential(3).split('e');
  return minus(`${m} × ${tenTo(Number(e))}`);
};
const plainRange = (x) => x === 0 || (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e6);
export const interval = (lo, hi) => (plainRange(lo) && plainRange(hi) ? `${four(lo)} to ${four(hi)}` : `${sci(lo)} to ${sci(hi)}`);

// The fitted values in the user's units: { id: { value, se, lower, upper, ... } }.
export function inUserUnits(sol, res, L) {
  const out = {};
  for (const p of sol.params) {
    const f = kindOf(p).si(L), r = res.params[p.id];
    out[p.id] = { ...r, value: r.value / f, se: r.se / f, lower: r.lower / f, upper: r.upper / f };
  }
  return out;
}

// Why a value is not determined, in words, by fit.js's code for it.
const WHY = {
  singular: 'the readings fix it only in a combination with other values, which change together without changing the computed drawdown',
  limit: 'the fit ended at its limit, where the linearized interval does not hold',
  wide: `its 95% interval would span more than a factor of ${WIDE}, so the readings do not pin it down`,
  wideSkin: `its 95% interval would be wider than ±${WIDE_SKIN}, so the readings do not pin it down`,
  ends: `other fits match the readings as well, with values so far apart that the range taking them in spans more than a factor of ${WIDE}`,
  flat: `the readings fit as well over more than a factor of ${WIDE}, with the other values refitted at each`,
  flatSkin: `the readings fit as well over more than ${2 * WIDE_SKIN} either side, with the other values refitted at each`,
  time: 'the fit reached its time limit before the standard error could be worked out',
};
export const whyOf = (p, r) => (['wide', 'flat'].includes(r.undetermined) && !logScale(p.kind) ? WHY[`${r.undetermined}Skin`] : WHY[r.undetermined]);
// The note after an interval: how it was found, where that is not the usual profile.
export const intervalNote = (r) => [r.clipped ? 'cut at the limit' : '', r.further ? 'may reach further' : '', r.interval === 'linearized' ? (r.budget ? 'linearized, its profile cut short by its budget of evaluations; may be too narrow' : 'linearized, may be too narrow') : '', r.widened ? 'widened to take in other fits as good' : ''].filter(Boolean);
// A range over which the readings fit as well ('flat'), in words: a closed end is a value
// the profile reached, an open end (further) only where the profile stopped, so it is not
// given as a number.
function flatRange(p, r, lu) {
  const f = kindOf(p).si(UNITS[lu]), u = unitOf(p, lu), withU = (x) => `${four(x / f)}${u ? ` ${u}` : ''}`;
  const lowOpen = r.further === 'lower' || r.further === 'both', highOpen = r.further === 'upper' || r.further === 'both';
  if (lowOpen && highOpen) return `over the whole range the profile followed, and beyond it, from below ${withU(r.lower)} to above ${withU(r.upper)}`;
  if (lowOpen) return `at ${withU(r.upper)} and below, down to the end of the range the profile followed and maybe beyond`;
  if (highOpen) return `at ${withU(r.lower)} and above, up to the end of the range the profile followed and maybe beyond`;
  return `from ${interval(r.lower / f, r.upper / f)}${u ? ` ${u}` : ''}`;
}
// The limit a value ended at, in the user's units.
const limitText = (p, r, lu) => `${four(r.value)}${unitOf(p, lu) ? ` ${unitOf(p, lu)}` : ''}`;
// Shown as "not determined", in place of a value: not one held, at a limit, or only
// lacking its standard error for want of time.
export const unknownCode = (r) => Boolean(r) && ['unsettled', 'undetermined'].includes(verdictOf(r));
// A name in the middle of a sentence: "transmissivity T", but "Kz/Kr" and "S′" as they are.
const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const inText = (p) => lower(shortName(p));
// A value with its unit, in the user's units.
const withItsUnit = (p, x, lu) => `${symbolOf(p)} = ${three(x / kindOf(p).si(UNITS[lu]))}${unitOf(p, lu) ? ` ${unitOf(p, lu)}` : ''}`;
// A power for a combination of values: a b², a/b, a √b.
const POWERS = { 1: '', 2: '²', 3: '³' };

// The combination that a null direction of J'J leaves fixed, in words, where it is simple:
// for two values fitted as logs, a b^c with c a whole number or a half.
function combination(null1, by) {
  const ids = Object.keys(null1);
  if (ids.length !== 2 || !ids.every((id) => logScale(by[id].kind))) return null;
  const [a, b] = ids, c = -null1[a] / null1[b];
  const near = Math.round(Math.abs(c) * 2) / 2;
  if (!(near > 0) || Math.abs(Math.abs(c) - near) > 0.03 * near) return null;
  const sa = symbolOf(by[a]), sb = symbolOf(by[b]);
  const part = near === 0.5 ? `√${sb}` : Number.isInteger(near) && POWERS[near] !== undefined ? `${sb}${POWERS[near]}` : null;
  if (!part) return null;
  return c > 0 ? `${sa} ${part}` : `${sa}/${part}`;
}

export function warnings(sol, res, g, ctx, v) {
  const lu = v.lUnit;
  const w = [];
  const by = Object.fromEntries(sol.params.map((p) => [p.id, p]));
  if (sol.check) w.push(...sol.check(res.values, g, ctx));
  // The time limit, by what it cut short.
  const minutes = Math.round(res.timeLimit / 60000);
  const limit = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (res.searchCut) {
    const advice = [v.every ? 'average the readings (leave "Readings fitted" blank)' : '', 'hold values you know', 'give starting values'].filter(Boolean);
    w.push(`The fit reached its time limit of ${limit} before the search was done, so the values may not be the best fit, and a faster or less busy computer may end somewhere else. ${res.perEvaluation > 0.5 ? `Each evaluation of the solution took about ${sig(res.perEvaluation, 2)} s here. ` : ''}To finish sooner, ${advice.slice(0, -1).join(', ')}${advice.length > 2 ? ',' : ''} or ${advice[advice.length - 1]}, and run it again.`);
  }
  if (res.statistics === 'forward') w.push(`To finish within the time limit of ${limit}, the standard errors were worked out from one-sided differences, which are less exact than the usual central ones.`);
  if (res.statistics === 'none') w.push(`The fit reached its time limit of ${limit} before the standard errors could be worked out, so none are given.`);
  const linear = res.free.filter((id) => res.params[id].interval === 'linearized');
  const timed = linear.filter((id) => !res.params[id].failed && !res.params[id].budget), failed = linear.filter((id) => res.params[id].failed);
  const spent = linear.filter((id) => res.params[id].budget);
  if (timed.length) w.push(`To finish within the time limit of ${limit}, the 95% interval${timed.length > 1 ? 's' : ''} of ${listed(timed.map((id) => symbolOf(by[id])))} ${timed.length > 1 ? 'are' : 'is'} linearized: worked out as if the computed drawdown changed in a straight line with each value, not by refitting along the misfit. Where values trade off, as S and skin do in a pumped well, a linearized interval may be far too narrow.`);
  // The values whose profiles were cut short, by their verdict (verdicts.js).
  const spentAs = (verdict) => spent.filter((id) => verdictOf(res.params[id]) === verdict);
  const spentKnown = spentAs('interval'), spentOpen = spentAs('unsettled'), spentLimit = spentAs('limit');
  if (spent.length) {
    const said = [];
    if (spentKnown.length) said.push(`${spentKnown.length > 1 ? 'the 95% intervals' : 'the 95% interval'} of ${listed(spentKnown.map((id) => symbolOf(by[id])))} ${spentKnown.length > 1 ? 'are' : 'is'} linearized: worked out as if the computed drawdown changed in a straight line with each value, not by refitting along the misfit, and ${spentKnown.length > 1 ? 'they' : 'it'} may be far too narrow`);
    if (spentLimit.length) said.push(`${spentLimit.length > 1 ? 'the 95% intervals' : 'the 95% interval'} of ${listed(spentLimit.map((id) => symbolOf(by[id])))} from ${spentLimit.length > 1 ? 'their limits' : 'its limit'}, which the profile${spentLimit.length > 1 ? 's were' : ' was'} there to find, ${spentLimit.length > 1 ? 'are' : 'is'} not determined`);
    if (spentOpen.length) said.push(`whether the readings fix ${listed(spentOpen.map((id) => symbolOf(by[id])))} is not settled: only the straight-line statistics say ${spentOpen.length > 1 ? 'they are' : 'it is'} not determined, and that test turns on where the search happened to stop, which is what the profile was there to check`);
    w.push(`The profile${spent.length > 1 ? 's' : ''} of ${listed(spent.map((id) => symbolOf(by[id])))} would have needed more than ${PROFILE_CALLS * res.free.length} evaluations of ${sol.name}${spent.length > 1 ? ' each' : ''}, the most a profile is given so that the same readings give the same answer on any computer, and ${spent.length > 1 ? 'were' : 'was'} cut short there. So ${said.join('; and ')}. A profile needs that many where the refits crawl along a combination of values the readings barely fix; holding one of the values not determined at a value known from elsewhere makes it cheaper.`);
  }
  if (failed.length) w.push(`${sol.name} could not be computed at some of the values tried for the 95% interval${failed.length > 1 ? 's' : ''} of ${listed(failed.map((id) => symbolOf(by[id])))}, so ${failed.length > 1 ? 'those intervals are' : 'that interval is'} linearized, and may be too narrow.`);
  if (res.restartsCut) w.push(`The profiles kept finding closer fits than the one before: the fit was carried on from a closer one ${res.restarts} times, the most it is allowed, and the intervals of the last are worked out taking any closer fit as no rise. The search may still be short of the best fit; starting values near the values shown may help.`);
  if (res.improved) w.push(`While working out the 95% intervals, holding one value and refitting the others found a closer fit than the search had (root mean square misfit ${three(res.rms / UNITS[v.sUnit])} ${v.sUnit}, against ${three(res.improved.rms / UNITS[v.sUnit])} ${v.sUnit}), so the search had stopped short of the best fit. The values shown are from the closer fit.`);
  if (res.curveTimes !== undefined && res.curveTimes < 160) w.push(`To finish within the time limit, the fitted curve is drawn ${res.curveTimes ? `at ${res.curveTimes} times` : 'only at the points fitted'}, not the usual 160.`);
  // A misfit in long runs of one sign: the curve misses the readings in a pattern.
  const m = res.misfit;
  if (m && m.poor) {
    const seg = res.segments || {};
    // A straight-line S at the pumped well, or one above 1, is not a storativity.
    const sOk = (f) => f.S > 0 && f.S <= 1 && !ctx.pumped;
    const fromLine = (f, when) => (f && f.T > 0 ? `${when} T = ${three(f.T / UNITS[lu] ** 2)} ${unit(`${lu}2/d`)}${sOk(f) ? ` and S = ${three(f.S)}` : ''}` : null);
    const lines = [fromLine(seg.early, 'the early readings give'), fromLine(seg.late, 'the late ones')].filter(Boolean);
    w.push(`The fitted curve misses the readings in long stretches of one sign: ${m.runs} runs of positive and negative misfits, where random misfits through the same fit give about ${Math.round(m.mean)}, and as few as ${m.runs} in under 1% of cases (the runs test of Hill 1998). Either the search stopped in a false minimum, or ${sol.name} does not describe this test. ${lines.length ? `As starting values to try, Theis fits to the straight parts of the record: ${lines.join('; ')}${ctx.pumped ? ' (no S: in the pumped well a straight line gives no storativity)' : ''}.` : ''}`);
  } else if (m && !m.valid) w.push(`With only ${res.n} points, the runs test cannot tell a pattern in the misfits from chance: even the fewest runs that random misfits through the same fit give would not be rare. So the misfits were not checked for a pattern; look at the charts.`);
  // Other ends of the search that fit as well as the best, but far from it.
  const rivals = res.rivals || [];
  if (rivals.length) {
    const ids = [...new Set(rivals.flatMap((r) => r.ids))];
    const lost = ids.filter((id) => res.params[id].undetermined === 'ends'), widened = ids.filter((id) => !lost.includes(id));
    // Values the readings say nothing about (no standard error, or one spanning decades)
    // are left out of the alternatives: their numbers there would mean nothing.
    const kept = res.free.filter((id) => !['singular', 'wide', 'flat'].includes(res.params[id].undetermined));
    const alt = rivals.map((r) => `${kept.map((id) => withItsUnit(by[id], r.values[id], lu)).join(', ')} (root mean square misfit ${three(r.rms / UNITS[v.sUnit])} ${v.sUnit})`);
    const straight = ids.some((id) => res.params[id].interval === 'linearized');
    w.push(`Other fits match the readings about as well as this one (root mean square misfit ${three(res.rms / UNITS[v.sUnit])} ${v.sUnit}): ${alt.join('; ')}. They lie outside the 95% interval of ${listed(ids.map((id) => symbolOf(by[id])))}${straight ? '' : ', which follows the misfit out from the best fit: they are in another valley of the misfit, as deep'}, so ${ids.length > 1 ? 'those intervals are' : 'that interval is'} too narrow.${widened.length ? ` The interval${widened.length > 1 ? 's' : ''} of ${listed(widened.map((id) => symbolOf(by[id])))} ${widened.length > 1 ? 'are' : 'is'} widened to take these fits in, and may reach further still.` : ''}${lost.length ? ` ${listed(lost.map((id) => symbolOf(by[id])))} ${lost.length > 1 ? 'are' : 'is'} not determined: the fits as good range over more than a factor of ${WIDE}.` : ''}`);
  }
  // Values not determined, each with its reason.
  for (const id of res.free) {
    const r = res.params[id], p = by[id], verdict = verdictOf(r);
    if (verdict === 'time' || verdict === 'unsettled' || r.undetermined === 'singular' || r.undetermined === 'ends') continue;
    if (verdict === 'limit') w.push(`${shortName(p)} ended at its limit, ${limitText(p, inUserUnitsOne(p, r, lu), lu)}, so its standard error and interval are not determined: the linearized interval does not hold at a limit.${p.kind === 'skin' ? ' The readings are fitted best with no skin.' : ''}`);
    else if (r.undetermined === 'flat') {
      const moves = (r.moves || []).map((m) => symbolOf(by[m]));
      w.push(`${shortName(p)} is not determined: the readings fit as well for ${symbolOf(p)} ${flatRange(p, r, lu)}, ${logScale(p.kind) ? `more than a factor of ${WIDE}` : `more than ${2 * WIDE_SKIN} apart`}, ${moves.length ? `with ${listed(moves)} changing with it` : 'with the other values refitted at each'}. Holding it at a value known from elsewhere lets the rest be fitted.`);
    } else if (verdict === 'undetermined') w.push(`${shortName(p)} is not determined: ${whyOf(p, r)}. Holding it at a value known from elsewhere lets the rest be fitted.`);
    else if (r.atLimit && r.interval === 'profile') {
      const f = kindOf(p).si(UNITS[lu]), u = unitOf(p, lu);
      w.push(`${shortName(p)} ended at its limit, ${limitText(p, inUserUnitsOne(p, r, lu), lu)}${p.kind === 'skin' ? ': the readings are fitted best with no skin' : ''}. Its 95% interval comes from the misfit on the side away from the limit alone, held at trial values there with the others refitted, and runs from ${interval(r.lower / f, r.upper / f)}${u ? ` ${u}` : ''}${p.kind === 'skin' ? ': a skin up to that fits the readings as well' : ''}.`);
    } else if (r.clipped) w.push(`The 95% interval of ${inText(p)} reaches ${r.clipped === 'lower' ? 'down' : 'up'} to the limit the method allows, so it is cut at ${r.clipped === 'lower' ? 'its lower' : 'its upper'} limit.`);
  }
  // Values the readings fix only in a combination: say which, and what would help.
  for (const nul of res.nulls || []) {
    const ids = Object.keys(nul);
    if (ids.length === 1) {
      w.push(`${shortName(by[ids[0]])} does not change the computed drawdown at all here, so the readings say nothing about it and it is not determined. More readings of the same kind would not help. Hold it at a value known from elsewhere; the other values do not depend on it.`);
      continue;
    }
    const names = listed(ids.map((id) => symbolOf(by[id])));
    const combo = combination(nul, by);
    w.push(`The readings cannot fix ${names} apart: changing them together${combo ? ` so that ${combo} stays the same` : ' in one particular way'} leaves the computed drawdown unchanged, so only ${combo || 'a combination of them'} is fixed, and ${ids.length > 1 ? 'each is' : 'it is'} not determined. More readings of the same kind would not change that. Hold one of them at a value known from elsewhere, such as another test or a core, to fit the other${ids.length > 2 ? 's' : ''}.${res.free.length > ids.length ? ' The other values do not depend on how these are set, and their standard errors are given.' : ''}`);
  }
  // Strong correlations between values that are determined, in one note.
  const pairs = [];
  res.free.forEach((a, i) => res.free.forEach((b, j) => {
    const c = res.corr[i][j];
    if (j > i && Math.abs(c) > 0.95 && !res.params[a].undetermined && !res.params[b].undetermined) pairs.push({ a, b, c });
  }));
  if (pairs.length) {
    // Three decimals, so 0.996 is not printed as a perfect 1.00.
    const said = pairs.map(({ a, b, c }) => `${pairs.length === 1 ? `${shortName(by[a])} and ${inText(by[b])}` : `${symbolOf(by[a])} with ${symbolOf(by[b])}`} (correlation ${corrText(c)})`);
    const very = pairs.some(({ a, b, c }) => Math.abs(c) > 0.99 && [a, b].some((id) => res.params[id].interval === 'linearized'));
    w.push(`${pairs.length === 1 ? `${said[0]} are` : `These pairs are`} strongly correlated${pairs.length === 1 ? '' : `: ${said.join(', ')}`}. The readings fix a combination of ${pairs.length === 1 ? 'the two' : 'each pair'} better than either value alone.${very ? ' Beyond 0.99, a linearized interval, which treats the curve as straight in its values, is not reliable.' : ''}`);
  }
  if (!res.converged && !res.stopped) w.push('The fit stopped at its limit of iterations without settling, so the values may not be the best.');
  if (res.df < 5) w.push(`Only ${res.df} degree${res.df === 1 ? '' : 's'} of freedom (${res.n} points less ${res.free.length} fitted values), so the intervals are wide and rest heavily on the model being right.`);
  return w;
}
// One value in the user's units.
const inUserUnitsOne = (p, r, lu) => { const f = kindOf(p).si(UNITS[lu]); return { ...r, value: r.value / f }; };

export const STATS_PLAIN = 'How to read these: the standard error is the typical error in a fitted value that the scatter of the readings about the fitted curve implies. The 95% interval is found from the misfit itself: each value is held at trial values and the others fitted again, to see how far it can move before the curve fits the readings clearly worse. So an interval can be lopsided, and much wider than the standard error suggests where values trade off. If the solution is right for this test and the misfits are independent, with the same spread throughout, the true value lies inside its 95% interval in about 19 tests out of 20. The interval leaves out errors in the rates, distances and well sizes, and in the choice of solution, so the real uncertainty is larger, more so when two values are strongly correlated or there are few points. A correlation near 1 or −1 means two values trade off against each other: the readings fix a combination of them better than either alone.';

// A value in the method text's list, by its verdict (verdicts.js).
function valueText(r, verdict) {
  switch (verdict) {
    case 'fixed': return `${four(r.value)}, held fixed`;
    case 'limit': return `${four(r.value)}, at its limit; standard error not determined`;
    case 'time': return `${four(r.value)}, standard error not computed in the time allowed`;
    case 'unsettled': return `not settled: its profile was cut short by its budget of evaluations (best fit ${four(r.value)})`;
    case 'undetermined': return `not determined (best fit ${four(r.value)})`;
    default: return `${four(r.value)}, standard error ${four(r.se)}, 95% interval ${interval(r.lower, r.upper)}${intervalNote(r).map((x) => `, ${x}`).join('')}`;
  }
}

export function methodText(c) {
  const { sol, res, v, g, rates, boundaries, example } = c;
  const tName = TIME_NAMES[v.tUnit];
  const solText = sol.method(res.values, g, c.ctx);
  const skins = sol.params.filter((p) => !logScale(p.kind) && !c.held[p.id]);
  const numbers = sol.params.map((p) => {
    const r = c.user[p.id];
    return [withUnit(p, v.lUnit), valueText(r, verdictOf(r))];
  });
  const windowed = v.from !== undefined || v.to !== undefined
    ? ` inside the window you set, ${v.from === undefined ? `up to ${v.to} ${tName}` : v.to === undefined ? `from ${v.from} ${tName} on` : `from ${v.from} to ${v.to} ${tName}`}` : '';
  const steps = [
    { title: 'Readings used', lines: [
      `${res.used} readings with a time above zero and a drawdown${windowed}. ${v.every ? `Every reading was fitted as it is, ${res.n} points.` : `They were averaged into bins of equal width in log time, 20 to each log cycle, as on the other tools, so a logger running for days does not outvote the first minutes. ${rates.length > 1 ? 'Each period of constant rate is averaged on its own, in log of the time since its rate began, so no bin spans a change of rate and recovery keeps 20 bins to each log cycle of time since the change. ' : ''}That left ${res.n} points, each the mean of the readings in its bin, at the geometric mean of their times.`}`,
      'Converted to metres and days for the calculation. The results are given back in the units you chose.',
    ], numbers: [] },
    { title: sol.name, lines: solText.lines, formula: solText.formula, numbers: [] },
    rates.length === 1
      ? { title: 'Pumping rate', lines: [`A constant rate of ${c.ratesIn[0][1]} ${unit(v.qUnit)} from the start.`], numbers: [] }
      : { title: 'Pumping rates', lines: [
        'The rate changed during the test, so the drawdown is the sum of one solution for each change of rate, each starting at the time of its change and pumping the change (superposition in time). A rate of zero is recovery.',
      ], formula: 's(t) = Σ over changes i of s₁(t − tᵢ; Qᵢ − Qᵢ₋₁), for t > tᵢ', numbers: c.ratesIn.map(([t, q]) => [`From ${t} ${tName}`, `${q} ${unit(v.qUnit)}`]) },
  ];
  if (boundaries) {
    const name = { head: 'constant head', noflow: 'no flow' };
    steps.push({ title: 'Boundaries', lines: [
      `${boundaries.arrangement === 'one' ? 'One straight boundary, crossing the whole aquifer. It is' : `${boundaries.arrangement === 'parallel' ? 'Two parallel straight boundaries, with the pumped well between them' : 'Two straight boundaries at right angles'}, each crossing the whole aquifer. Each is`} replaced by image wells (Ferris et al. 1962; Kruseman and de Ridder 1994, chapter 6): across a constant head boundary the image injects at the pumping rate, across a no-flow boundary it pumps. The drawdown is the solution summed over the pumped well and its images, each at its own distance from the observation point.${c.pumped ? ' The observation is the pumped well, so each image is read where the well sees it: over the pumped screen, with no lag.' : ''}`,
      boundaries.arrangement === 'parallel' ? 'Two parallel boundaries make an endless row of images. Pairs of images were added until the last pair changed the drawdown by less than 10⁻¹⁰ of it, or, for a solution computed by Laplace inversion, until a pair below 10⁻⁵ of it was no smaller than the pair before: the inversion\'s own scatter.' : '',
    ].filter(Boolean), numbers: boundaries.types.map((t, i) => [`Boundary ${i + 1}`, `${name[t]}, ${c.bIn.a[i]} ${v.lUnit} from the pumped well${c.bIn.d[i] !== undefined ? `, ${c.bIn.d[i]} ${v.lUnit} from the observation point` : ''}`]) });
  }
  steps.push(
    { title: 'Least squares fit', lines: [
      `The values were chosen to make the sum of squared differences between measured and computed drawdown as small as possible, by the Levenberg (1944) and Marquardt (1963) method. Each value is fitted as its logarithm, so it stays above zero${skins.length ? ', except skin, which is fitted as it is' : ''}. Values are kept inside the limits each solution states from physics or its published method, such as S at most 1. The slopes the method needs were taken by finite differences, on the inside only for a value at its limit.`,
      c.heldText,
      `The standard errors come from the residual variance s², the variance of one reading about the fitted curve, times the diagonal of the covariance (JᵀJ)⁻¹, where J holds the slopes of the computed drawdown against each value's logarithm${skins.length ? ' (against skin itself)' : ''}. ${v.every ? 's² is the sum of squares divided by n − k.' : 'Each point is a mean of nᵢ readings, so its variance is s²/nᵢ: the covariance is (JᵀJ)⁻¹ (Jᵀ diag(1/nᵢ) J) (JᵀJ)⁻¹ s². For s², two sums of squares are added, the weighted misfits Σ nᵢ rᵢ² and the scatter of the readings about a straight line in log time inside each bin, and divided by their degrees of freedom added.'} n is the number of points and k the number of values fitted.${res.statistics === 'forward' ? ' To finish within the time limit, the slopes for the statistics were one-sided differences.' : ''} The standard error shown is the value times SE(ln x)${skins.length ? ', and for skin SE itself' : ''}.`,
      `The 95% interval of each value comes from its profile (Bates and Watts 1988, chapter 6; Vecchia and Cooley 1987; Hill and Tiedeman 2007): the value is held at a trial value and the others are fitted again, and the interval is the range over which that least sum of squares stays within a rise Δ of the best fit's. ${v.every ? 'Δ is t² s²' : `Δ is t² SE(ln x)² / [(JᵀJ)⁻¹]ₓₓ${skins.length ? ' (with SE itself for skin)' : ''}, which is t² s² when every point holds one reading`}, with t from Student's t distribution with n − k degrees of freedom (Abramowitz and Stegun 1964, 26.7.3 and 26.7.4). Where the computed drawdown changes in a straight line with the values, this is the linearized interval exp(ln x ± t · SE(ln x))${skins.length ? ' (for skin, x ± t · SE)' : ''}. Where values trade off along a curved valley of the misfit, as storativity and skin do in a pumped well, the profile follows the valley, and the interval can be much wider than the linearized one, and lopsided. Each value is first held at the ends of its linearized interval, the others refitted from the best fit by the same Levenberg-Marquardt method, with two changes that save evaluations of the solution: a step too long for the search's limit of a factor of 10 is damped rather than cut, as in a trust region (Moré 1978), and its limit grows while steps fall as the straight-line model promises; and the slopes are not worked out afresh at every step but updated from each one by Broyden's (1965) formula, and worked out afresh before a refit is taken as settled. Each refit starts where the last on that side, short of the end, left off. Where the rise at the ends of the linearized interval falls short of Δ, the value is stepped outward, each step 1.5 to 4 times as far from the best fit as the last (on the log scale), until the rise reaches Δ; a root search (false position with the change of Dowell and Jarratt 1971) then finds the end to within about 5% of the interval's half-width. Where the rise first reaches Δ, the value is also held at the next whole power of 10 beyond${skins.length ? ' (for skin, the next multiple of 20/3)' : ''}, inside the range the search looked in: if the readings fit as well there, behind a ridge of the misfit, the profile goes on from there, and the interval takes both sides of the ridge in. A value that ended at its limit, such as a skin of 0, is held at trial values on the side away from the limit alone, and its interval runs from the limit. If the interval would span more than a factor of ${WIDE}${skins.length ? ` (for skin, be wider than ±${WIDE_SKIN})` : ''} before the rise reaches Δ, the value is not determined: the readings fit as well over that range. An interval that meets a limit, such as S at 1, is cut there. If a refit along a profile fits better than the best fit, by more than ${PROFILE_BETTER * 100}% of Δ, the search had stopped short of the minimum: the fit is carried on from there and the intervals are worked out again, until no profile finds a closer fit (at most ${PROFILE_RESTARTS} times). A profile may call the solution at most ${PROFILE_CALLS} times for each value fitted (${PROFILE_CALLS * res.free.length} here), a fixed count rather than a time, so the same readings give the same answer on any computer; one that needs more keeps its linearized interval, and the page says so. When the time limit is near, the intervals not yet done are linearized instead, and the page says so too.`,
      `Where JᵀJ has no inverse, some combination of values leaves the computed drawdown unchanged: a direction in which JᵀJ is zero. Only the values that combination touches are not determined; the others are fixed by the readings however those are set, and their standard errors come from the pseudo-inverse of JᵀJ over the directions the readings do fix. A value whose linearized interval would span more than a factor of ${WIDE}${skins.length ? ` (for skin, be wider than ±${WIDE_SKIN})` : ''} is profiled first, at whole powers of 10${skins.length ? ' (for skin, multiples of 20/3)' : ''} over the whole range the search looked in, and is not determined only where that profile says so; where its profile is cut short by its budget, the page says that this is not settled. A value that ended at its limit with no standard error has no interval.`,
      `Every end of the search is then compared with the best. An end whose sum of squares is above the best's by no more than Δ lies inside each value's profile interval, unless it is in another valley of the misfit, as deep, which the profile did not reach from the best fit. The interval is then widened to take in every such fit, and where the widened interval spans more than a factor of ${WIDE}${skins.length ? ` (for skin, ±${WIDE_SKIN})` : ''}, the value is not determined.`,
      `The root mean square misfit is √(Σ rᵢ² / n), the typical difference between a measured and a computed point. The signs of the misfits, in time order, are checked by the runs test of Hill (1998, p. 22). The misfits of a fitted curve are not independent, least of all where each point is the mean of many readings, so the count of runs is not judged by Hill's normal approximation but against the counts from ${RUNS_SIMULATIONS} sets of random readings, with the same spread in each point, passed through the same fit, seeded so the answer is the same every time. Fewer runs than in 99% of those sets means the curve misses the readings in a pattern, not at random. Where even the fewest runs those sets give are not that rare, there are too few points for the test, and the page says so.`,
    ].filter(Boolean),
    formula: `minimize  Σᵢ (s_measured,i − s_computed,i)²\ncov = s² · (JᵀJ)⁻¹${v.every ? ',  s² = SSE / (n − k)' : ' (Jᵀ diag(1/nᵢ) J) (JᵀJ)⁻¹'}\n95% interval: every x with  min over the other values of SSE(x) ≤ SSE + Δ\nΔ = ${v.every ? 't(0.975, n − k)² s²' : 't(0.975, n − k)² SE(ln x)² / [(JᵀJ)⁻¹]ₓₓ'}`,
    numbers: [
      ...numbers,
      [`Root mean square misfit (${v.sUnit})`, four(res.rms / UNITS[v.sUnit])],
      ['Points fitted, n', String(res.n)],
      ['Values fitted, k', String(res.free.length)],
      ['Student\'s t for a 95% interval, t(0.975, n − k)', Number.isFinite(res.t975) ? four(res.t975) : 'n/a'],
      ['Runs of one sign in the misfits', !res.misfit ? '' : res.misfit.valid ? `${res.misfit.runs} (about ${Math.round(res.misfit.mean)} expected at random; ${res.misfit.poor ? 'too few' : 'not unusually few'})` : `${res.misfit.runs} (test not applied: too few points)`],
      ['Iterations', String(res.iterations)],
    ] },
    { title: 'Derivative', lines: [
      'The log-log chart also shows ds/d ln t, the slope of drawdown against the logarithm of time, which makes the stages of a test easier to tell apart than drawdown alone: it is flat where the straight line of Cooper and Jacob (1946) holds, and dips or rises where leakage, delayed drainage or a boundary takes over. It is taken by the method of Bourdet et al. (1989), between the points 0.2 log cycles either side, for the measured points and for the fitted curve alike.',
    ], numbers: [] },
    { title: 'Inputs', lines: [], numbers: [
      ['Time unit', tName], ['Drawdown unit', v.sUnit], ['Length unit', v.lUnit],
      ...sol.geometry.filter((k) => g[k] !== undefined).map((k) => [geometryLabel(k, sol), `${v[fieldId('g', k)]} ${v.lUnit}${v.lUnit === 'm' ? '' : ` (${four(g[k])} m)`}`]),
      ...(sol.options || []).map((o) => [o.label, (o.choices.find(([id]) => id === g[o.id]) || [])[1]]),
    ] },
  );
  const references = [
    ...(example ? [example.source] : []),
    BATES_WATTS_1988_CHAPTER_6,
    'Broyden, C.G. (1965) A class of methods for solving nonlinear simultaneous equations. Mathematics of Computation 19(92), 577-593. doi:10.1090/S0025-5718-1965-0198670-6.',
    'Dowell, M., and Jarratt, P. (1971) A modified regula falsi method for computing the root of an equation. BIT 11(2), 168-174. doi:10.1007/BF01934364.',
    'Hill, M.C., and Tiedeman, C.R. (2007) Effective Groundwater Model Calibration: With Analysis of Data, Sensitivities, Predictions, and Uncertainty. Wiley. doi:10.1002/0470041080.',
    'Vecchia, A.V., and Cooley, R.L. (1987) Simultaneous confidence and prediction intervals for nonlinear regression models with application to a groundwater flow model. Water Resources Research 23(7), 1237-1250. doi:10.1029/WR023i007p01237.',
    ABRAMOWITZ_STEGUN_1964,
    COOPER_JACOB_1946_DOI,
    BOURDET_ET_AL_1989_DOI,
    ...(boundaries ? [FERRIS_ET_AL_1962, KRUSEMAN_DE_RIDDER_1994] : []),
    HILL_1998,
    LEVENBERG_1944,
    MARQUARDT_1963,
    'Moré, J.J. (1978) The Levenberg-Marquardt algorithm: implementation and theory. In Watson, G.A. (ed.) Numerical Analysis. Lecture Notes in Mathematics 630, Springer, 105-116. doi:10.1007/BFb0067700.',
    ...sol.references,
  ];
  // One copy of each reference, in alphabetical order, as on the other tools.
  return { steps, references: [...new Set(references)].sort((a, b) => a.localeCompare(b)) };
}
