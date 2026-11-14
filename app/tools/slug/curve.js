// The type-curve methods, fitted by least squares: Cooper, Bredehoeft and Papadopulos
// (1967), the KGS model (Hyder et al. 1994), and for an oscillating response the high-K
// Hvorslev model (Butler 1998), Springer and Gelhar (1991) and Butler and Zhan (2004):
// the engine's model and geometry, the method text, the warnings and the results.
import { UNITS } from '../../../engine/index.js';
import { bouwerRice, SPAN, TIME_S, undetermined } from '../../../engine/slug.js';
import { dampingOf, highKShape } from '../../../engine/slug-models.js';
import { fixed, listed, six } from '../../../engine/format.js';
import { chart, downloads, downloadWorkbook, el, methodPanel, notes, panel, sig, table, tenTo, unit } from '../../kit.js';
import { given, kTable, NAMES, normalizedStep, OSCILLATING, OTHER_K, outOfDate, STATS_PLAIN, withPractice } from './results.js';
import { four, interval, K_RANGE, skippedNote } from './text.js';

// The engine's model for each method, and the geometry it needs, in metres.
export function curveSetup(v) {
  const L = UNITS[v.lUnit];
  const m = (x) => (x === undefined ? undefined : x * L);
  const base = { rc: m(v.rc), rw: m(v.rw) };
  if (v.method === 'cbp') return { kind: 'cbp', geo: base };
  const screen = { ...base, b: m(v.Le), anisotropy: v.anisotropy };
  if (v.Lw !== undefined && v.Lw < v.Le) throw new Error('The distance from the water table or top of the aquifer to the bottom of the screen cannot be less than the screen length.');
  const deep = v.Lw === undefined ? undefined : { d: m(v.Lw - v.Le), B: m(v.D) };
  if (v.method === 'kgs') {
    const geo = { ...screen, ...deep, top: v.top };
    if (v.rsk !== undefined) Object.assign(geo, { rsk: m(v.rsk), SsSkin: v.SsSkin / L });
    return { kind: 'kgs', geo };
  }
  if (v.method === 'highKHvorslev') return { kind: 'highK', geo: { ...screen, shape: highKShape(screen) } };
  if (v.method === 'springerGelhar') {
    const { lnRe, capped } = bouwerRice({ rc: base.rc, rw: base.rw, Le: screen.b, Lw: m(v.Lw), D: m(v.D), anisotropy: v.anisotropy, slope: -1 });
    return { kind: 'highK', geo: { ...screen, shape: lnRe }, capped };
  }
  const friction = v.nu !== undefined && v.lAbove !== undefined ? { nu: v.nu, l: m(v.lAbove) } : {};
  return { kind: 'bz', geo: { ...screen, ...deep, ...friction } };
}

// The order fitted values are listed in.
const ORDER = ['T', 'S', 'Kr', 'K', 'Kskin', 'Ss', 'Le'];
const inOrder = (p) => ORDER.filter((k) => p[k] !== undefined);

// Units of each fitted parameter as shown: [symbol, name, from SI to shown, unit text].
// The engine's Le, the water column, is shown as Lc, since Le is the screen length here.
function paramInfo(name, v) {
  const L = UNITS[v.lUnit], u = v.lUnit;
  return {
    T: ['T', 'Transmissivity', 86400 / (L * L), unit(`${u}2/d`)],
    S: ['S', 'Storativity', 1, ''],
    Kr: ['K', 'Hydraulic conductivity', 1, 'm/s'],
    K: ['K', 'Hydraulic conductivity', 1, 'm/s'],
    Kskin: ['Kskin', 'Skin hydraulic conductivity', 1, 'm/s'],
    Ss: ['Ss', 'Specific storage', L, `1/${u}`],
    Le: ['Lc', 'Water column length', 1 / L, u],
  }[name];
}
const symbolOf = (k, v) => paramInfo(k, v)[0];

// How each method's search finds its starting point, from the readings alone.
const START_TEXT = {
  cbp: (held) => (held
    ? 'The starting point takes α from the S you held, and the time scale that best matches the readings, searched over 160 values from 10⁻³ divided by the last time to 10³ divided by the first; T follows from that time scale.'
    : 'The starting point is the best of a grid: α at 19 values from 10⁻¹⁰ to 0.1, the range Cooper et al. (1967) and Papadopulos et al. (1973) tabulated, and for each the time scale that best matches the readings, searched over 160 values from 10⁻³ divided by the last time to 10³ divided by the first. T and S follow from the best pair.'),
  kgs: (held, g) => `${held ? 'The starting point takes Ss as you held it, and the time scale that best matches the readings, searched over 160 values' : 'The starting point is the best of a grid: Ss at 11 values from 10⁻⁷ to 10⁻² per metre, and for each the time scale that best matches the readings, searched over 160 values'}. K follows from the time scale, since K only stretches the curve in time when there is no skin.${g.rsk ? ' For the start the skin is taken to be like the formation, Kskin = K.' : ''}`,
  highK: () => 'The starting point is the best of a grid of 50 values of Lc from 0.05 to 2000 m and 50 values of CD from 0.02 to 30; K follows from CD.',
  bz: (held) => `The starting point takes K and Lc from the same grid search with the high-K Hvorslev model, then ${held ? 'Ss as you held it' : 'the best of 6 values of Ss from 10⁻⁷ to 10⁻² per metre'}.`,
};

function curveMethodText(v, n, fit, setup, levelUnit, window, unknown) {
  const L = UNITS[v.lUnit], g = setup.geo;
  const len = (x) => `${sig(x / L, 4)} ${v.lUnit}`;
  const steps = [normalizedStep(v, n, levelUnit)];
  const p = fit.params, freeIds = inOrder(p).filter((id) => fit.free.includes(id));
  const free = listed(freeIds.map((id) => symbolOf(id, v)));
  const geoRows = [['rc', len(g.rc)], ['rw', len(g.rw)]];
  if (g.b !== undefined) geoRows.push(['Screen length Le', len(g.b)], ['Kz/Kr', given(g.anisotropy)]);
  if (g.d !== undefined) geoRows.push(['Top of aquifer or water table to top of screen d', len(g.d)], ['Aquifer thickness D', len(g.B)]);
  const si = 'Lengths are converted to metres and times to seconds for the calculation.';
  if (v.method === 'cbp') {
    steps.push({
      title: 'Cooper, Bredehoeft and Papadopulos (1967)',
      lines: [
        'A fully penetrating well of finite diameter in a confined aquifer, with the storage of the aquifer included. H/H0 is a function F of two numbers: α, which holds the storativity S, and β, dimensionless time, which holds the transmissivity T.',
        'rc is the casing radius, where the water level moves, and rw the radius of the screen or open hole. F is found from its Laplace transform, which follows from the flow equation and the well\'s mass balance, by the inversion of de Hoog, Knight and Stokes (1982). For α = 10⁻⁶ to 10⁻¹⁰ it matches all 55 values of the table of Papadopulos et al. (1973), as Kruseman and de Ridder (1994, Annex 16.1) reprint it, to within half a unit of the last printed digit. For α = 10⁻⁵ to 0.1, whose table was not to hand, it matches the integral of Cooper et al. (Lohman 1972, equation 75), computed separately, to within 10⁻⁷.',
        si,
      ],
      formula: 'H/H0 = F(α, β),  α = rw² S / rc²,  β = T t / rc²\nLaplace transform of F:  1 / (p + 2 q K1(q) / K0(q)),  q = √(p α)',
      numbers: geoRows,
    });
  } else if (v.method === 'kgs') {
    steps.push({
      title: 'The KGS model (Hyder et al. 1994)',
      lines: [
        `A partially penetrating well, with anisotropy and, if you gave one, a skin of finite thickness around the screen whose hydraulic conductivity differs from the formation's. The aquifer is ${v.top === 'unconfined' ? 'bounded above by the water table, taken as a constant head,' : 'confined, with no flow across its top'} and has no flow across its base. K is the radial hydraulic conductivity Kr of the formation and Ss its specific storage; Le is the screen length, d the distance from the top of the aquifer or the water table to the top of the screen, and D the aquifer thickness. Hyder et al. (1994) and McElwee and Butler (1994) write Le as b and D as B.`,
        'The head in the well is found in Laplace space as a sum over vertical modes, in the form of McElwee and Butler (1994, appendices A and B), and inverted by the Stehfest (1970) method. Their equation (10) prints γ/α where their own boundary condition, and the reduction to Cooper et al. (1967) the report states, give γ/2; γ/2 is used here. The tests check the reduction to Cooper et al., and the sum of modes against a separate finite-difference solution.',
        g.rsk ? `The skin reaches ${len(g.rsk)} from the well's centre; its specific storage is the value you entered, and its Kz/Kr is taken as the formation's.` : 'No skin was given, so the formation reaches the screen.',
        si,
      ],
      formula: 'Φ(p) = (γ/2) Ω / (1 + (γ/2) p Ω),  in τ = t Le Kr / rc²\nα = 2 rw² Le Ss / rc²,  γ = Kr / Kskin,  ψ = √(Kz/Kr) rw / Le\nΩ = sum over vertical modes of the screen\'s weights times f1, the well-face head per unit flux',
      numbers: [...geoRows, ...(g.rsk ? [['Skin outer radius rsk', len(g.rsk)], [`Skin Ss (1/${v.lUnit})`, sig(g.SsSkin * L, 3)]] : [])],
    });
  } else if (v.method === 'butlerZhan') {
    steps.push({
      title: 'Butler and Zhan (2004)',
      lines: [
        'The KGS model (Hyder et al. 1994) of a partially penetrating well in a confined aquifer, with the inertia of the water column in the well (Kipp 1985), so that the level can oscillate. Lc is the effective length of the water column, fitted as Butler (1998) advises, since the length worked out from the well\'s construction seldom fits. Le is the screen length, d the distance from the top of the aquifer to the top of the screen, and D the aquifer thickness; Zhan and Butler (2003) write Lc as Le, Le as b and D as B.',
        g.nu ? `Friction in the well is included through the term Fl, with the kinematic viscosity ν = ${sig(g.nu, 3)} m²/s and a water column l of ${len(g.l)} above the screen.` : 'Friction in the well is left out (Fl = 0), since no viscosity was given.',
        'The response is equation (49) of Zhan and Butler (2003) for a slug test, with the water level at rest at the start. It is inverted from Laplace space by the method of de Hoog, Knight and Stokes (1982), which, unlike Stehfest\'s, can follow an oscillation.',
        si,
      ],
      formula: 'Φ(p) = (α Fl + α² β p + α Ω) / (1 + α p Fl + α² β p² + α p Ω),  in τ = t Kr / (rw² Ss)\nα = rc² / (2 rw² Le Ss),  β = 4 Lc Le² Kr² / (g rc⁴),  Fl = 16 Le ν L Kr / (g rc⁴),  L = l + 2 Le (rc/rw)⁴',
      numbers: [...geoRows, ['g (m/s²)', '9.80665']],
    });
  } else {
    const confined = v.method === 'highKHvorslev';
    steps.push({
      title: confined ? 'High-K Hvorslev model (Butler 1998)' : 'Springer and Gelhar (1991)',
      lines: [
        `The water column in the well is treated as a damped spring: the quasi-steady flow of the ${confined ? 'Hvorslev (1951)' : 'Bouwer and Rice (1976)'} model, with the inertia of the column added. CD is the damping: below 2 the level oscillates. Lc is the effective length of the water column, g the acceleration of gravity, and Le the screen length. Butler and Garnett (2000) write Lc as Le and the screen length as b.`,
        confined ? 'For a confined aquifer, with the Hvorslev shape term, as in Butler and Garnett (2000, eq. 5). It does not apply to a screen against an impermeable boundary.' : 'For an unconfined aquifer, with ln(Re/rw) of Bouwer and Rice (1976), as in Butler and Garnett (2000, eq. 4), its A, B and C from the RSAT 0.2.2 fits to their curves; Lw is from the water table to the bottom of the screen, and D the saturated thickness.',
        'The equations are those of Butler and Garnett (2000, eqs. 1 to 6). Both K and Lc are fitted, as they advise. With Kz/Kr other than 1, rw is replaced by rw √(Kz/Kr) (Zlotnik 1994).',
        si,
      ],
      formula: `H/H0 = e^(−CD td/2) [cos(ωd td) + CD/(2 ωd) sin(ωd td)],  ωd = √(1 − (CD/2)²),  CD < 2\n(the forms for CD = 2 and CD > 2 are Butler and Garnett's eqs. 2 and 3)\ntd = t √(g/Lc)\nK = √(g/Lc) rc² ${confined ? 'ln[Le/(2rw) + √(1 + (Le/(2rw))²)]' : 'ln(Re/rw)'} / (2 Le CD)`,
      numbers: [...geoRows, [confined ? 'Shape term' : 'ln(Re/rw)', four(g.shape)], ['g (m/s²)', '9.80665']],
    });
  }
  const heldIds = Object.keys(fit.held), k = freeIds.length;
  const lsLines = [
    `${free} ${k > 1 ? 'were' : 'was'} found by minimizing the sum of squared differences between the measured and modelled H/H0, by the Levenberg-Marquardt method (Levenberg 1944, Marquardt 1963) on the logarithm of each value.${heldIds.length ? ` ${listed(heldIds.map((id) => symbolOf(id, v)))} ${heldIds.length > 1 ? 'were' : 'was'} held at the value you entered.` : ''}`,
    START_TEXT[setup.kind](heldIds.length > 0, g),
    `${fit.n} readings were used${window}. Each standard error comes from the residual variance, the sum of squared misfits divided by n − k (n readings, k = ${k} fitted value${k === 1 ? '' : 's'}), times the diagonal of (JᵀJ)⁻¹, J holding the slopes of the modelled H/H0 against the logarithm of each value; the standard error shown is the value times its standard error on the log scale. The 95% interval is the value times or divided by exp(t · SE), with t = ${four(fit.tCrit)} from Student's t distribution with n − k = ${fit.dof} degrees of freedom. The RMS misfit is √(Σ residual² / n).`,
    `A value whose 95% interval would span more than a factor of ${SPAN}, or that has no standard error, is reported as not determined.`,
  ];
  // Said only when both values are found: with Lc not determined there is no correlation to explain.
  if (setup.kind === 'highK' && !unknown.K && !unknown.Le) lsLines.push('For readings at equal time steps that run from the start of the test until the oscillation has died away, this model gives K and Lc uncorrelated: the change in the curve as Lc changes is a fixed multiple of the rate of change, in time, of its change as K changes, and the sum of such a product over a complete record is zero. A correlation near zero is therefore what this model gives, not a missing calculation; on a record cut short it is larger.');
  lsLines.push(fit.converged ? `The fit settled after ${fit.iterations} steps.` : `The fit stopped after ${fit.iterations} steps without settling; treat the result with care.`);
  steps.push({
    title: 'Least squares fit',
    lines: lsLines,
    numbers: [...freeIds.map((id) => { const [sym, , f, u] = paramInfo(id, v); return [`${sym}${u ? ` (${u})` : ''}`, unknown[id] ? 'not determined' : four(p[id] * f)]; }), ['RMS misfit in H/H0', four(fit.rms)]],
  });
  steps.push({
    title: 'What the method assumes',
    lines: [{
      cbp: 'A fully penetrating well in a homogeneous, isotropic confined aquifer of uniform thickness, an instantaneous change in level, and no skin. Cooper et al. (1967) found that the curves differ little in shape when α changes by a factor of ten, so S from a slug test is unreliable; T much less so. Holding S at a value known from elsewhere is often better.',
      kgs: 'A homogeneous formation, with the anisotropy you entered, of uniform thickness and wide extent; an instantaneous change in level; uniform flux along the screen; and, if given, a skin of uniform properties through the full thickness. Ss is often poorly determined by a slug test; holding it at a value known from elsewhere is often better.',
      highKHvorslev: 'Quasi-steady flow in the aquifer (its storage ignored), linear losses, and a water column that moves as one body. The pressure transducer should be close to the static level: Butler and Garnett (2000) advise within 0.5 m, since a deeper transducer in an accelerating column does not record the level faithfully. No correction for transducer depth is applied.',
      springerGelhar: 'Quasi-steady flow in the aquifer (its storage ignored), linear losses, and a water column that moves as one body. The pressure transducer should be close to the static level: Butler and Garnett (2000) advise within 0.5 m. No correction for transducer depth is applied.',
      butlerZhan: 'A homogeneous confined aquifer with the anisotropy you entered, inertia in the well but not in the aquifer, linear flow, and an instantaneous start with the level at rest. Ss is usually poorly determined from a test in a highly permeable aquifer; holding it at a value known from elsewhere is often better.',
    }[v.method]],
    numbers: [],
  });
  return steps;
}

// Values a user can hold, by method: the advice for one the readings do not determine.
const HOLDABLE = { cbp: ['S'], kgs: ['Ss'], butlerZhan: ['Ss'] };
const WHY = {
  flat: 'changing it changes the fitted curve not at all, or only as another fitted value does, so the readings hold no information on it alone',
  wide: `its 95% interval would span more than a factor of ${SPAN}, so the readings do not pin it down`,
  limit: 'the fit ended at 1, the most a storativity can be',
};

function curveWarnings(v, n, fit, setup, skipped, dropped, unknown) {
  const out = [];
  if (skipped.length) out.push(skippedNote(skipped));
  if (dropped) out.push(dropped);
  const p = fit.params, K = p.Kr ?? p.K ?? (p.T && v.bAq ? p.T / (v.bAq * UNITS[v.lUnit]) : undefined);
  const used = fit.used.map((i) => n.ratio[i]);
  if (!OSCILLATING.has(v.method) && n.ratio.some((x) => x < -0.02)) out.push('Some readings fall well below static (H/H0 below zero), as an oscillating response does. This method does not oscillate; one of the methods for an oscillating response may fit better.');
  if (setup.kind === 'highK' && !used.some((x) => x < -0.02)) out.push('None of the readings in the fit falls below static, so the response does not oscillate. The high-K models are meant for a level that oscillates; without an oscillation Lc, which sets its period, is poorly determined. Hvorslev, Bouwer and Rice or the KGS model may suit this record better.');
  if (setup.capped) out.push('ln((D − Lw)/rw) came to more than 6, so 6 was used, as Bouwer and Rice (1976) direct.');
  // On an overdamped record the high-K fit can run Lc toward zero: the level then
  // returns as exp(-2 Le K t / (rc² shape)), the quasi-steady model, whatever Lc is.
  const quasiSteady = setup.kind === 'highK' && unknown.Le && !unknown.K && dampingOf(p.K, p.Le, setup.geo) > 2;
  for (const id of inOrder(p).filter((x) => unknown[x])) {
    const sym = symbolOf(id, v), hold = (HOLDABLE[v.method] || []).includes(id);
    if (id === 'Le' && quasiSteady) {
      out.push(`Lc is not determined: the level does not oscillate, and the fit ran Lc toward zero, where the inertia of the water column has no effect and the model becomes the quasi-steady ${v.method === 'highKHvorslev' ? 'Hvorslev (1951)' : 'Bouwer and Rice (1976)'} model. K is then fixed by the rate at which the level returns, as in that model, and is reported.`);
    } else out.push(`${sym} is not determined: ${WHY[unknown[id]]}.${hold ? ` Holding ${sym} at a value known from elsewhere lets the rest be fitted.` : ''}`);
  }
  // A value fit.js names weak has no standard error of its own; those of the rest come
  // from the part of the fit the readings do fix (the pseudo-inverse in fit.js).
  const weak = fit.weak.filter((id) => unknown[id]), rest = fit.free.filter((id) => !unknown[id]);
  if (weak.length && rest.length) {
    const many = rest.length > 1, found = listed(rest.map((id) => symbolOf(id, v))), loose = listed(weak.map((id) => symbolOf(id, v)));
    out.push(`The standard error${many ? 's' : ''} and interval${many ? 's' : ''} of ${found} do not depend on ${loose}: the readings fix ${found} whatever ${loose} ${weak.length > 1 ? 'are' : 'is'}, and ${many ? 'these give their' : 'these give its'} uncertainty in full.`);
  }
  if (v.method === 'cbp' && !unknown.S) {
    const alpha = (setup.geo.rw ** 2 * p.S) / setup.geo.rc ** 2;
    if (alpha < 1e-10 || alpha > 0.1) out.push(`α = rw² S / rc² came to ${sig(alpha, 2)}, outside the range Cooper et al. (1967) and Papadopulos et al. (1973) tabulated (${tenTo(-10)} to 0.1).`);
  }
  if (K !== undefined && !unknown.K && !unknown.Kr && !unknown.T && (K < K_RANGE[0] || K > K_RANGE[1])) out.push(`K = ${sig(K)} m/s is outside the range of natural materials, about ${tenTo(-13)} to 1 m/s. Check the well sizes and their unit, and the time unit.`);
  for (const name of fit.free) {
    if (!unknown[name] && fit.se[name] > p[name]) out.push(`The standard error of ${symbolOf(name, v)} is larger than its value, so the readings do not pin it down well. Holding it at a value known from elsewhere may help.`);
  }
  if (!fit.converged) out.push('The fit stopped without settling.');
  return out;
}

// The times the fitted curve is drawn at: finely, over the span of the readings.
export function curveTimes(v, n) {
  const t0 = n.t.filter((x) => x > 0);
  const first = Math.min(...t0), last = Math.max(...t0);
  return OSCILLATING.has(v.method)
    ? Array.from({ length: 400 }, (_, i) => (last * (i + 1)) / 400)
    : Array.from({ length: 160 }, (_, i) => first * (last / first) ** (i / 159));
}

// fit carries the fitted curve at grid, from curveTimes, and at every reading, as fitted.
export function curveResults(v, n, fit, setup, window, ctx) {
  const ts = TIME_S[v.tUnit], L = UNITS[v.lUnit], p = fit.params;
  const unknown = undetermined(fit);
  const K = p.Kr ?? p.K ?? (v.bAq !== undefined && !unknown.T ? p.T / (v.bAq * L) : undefined);
  const kKnown = K !== undefined && !unknown.Kr && !unknown.K;
  const { warn, text, block, sheets: checkSheets, series } = withPractice(v, n, ctx, { K: kKnown ? K : undefined, warnings: curveWarnings(v, n, fit, setup, ctx.skipped, ctx.dropped, unknown), steps: curveMethodText(v, n, fit, setup, ctx.levelUnit, window, unknown) });
  const [otherUnit, otherFactor] = OTHER_K[v.lUnit];
  const name = NAMES[v.method];
  const head = v.method === 'cbp'
    ? `${unknown.T ? 'T not determined' : `T = ${sig(p.T * 86400 / (L * L), 3, true)} ${unit(`${v.lUnit}2/d`)}`}, ${unknown.S ? 'S not determined' : `S = ${sig(p.S, 3, true)}`}`
    : kKnown ? `K = ${sig(K, 3, true)} m/s (${sig(K * otherFactor, 3, true)} ${otherUnit})` : 'K not determined';
  // Fitted values with their standard errors and 95% intervals, in the units shown.
  const rows = inOrder(p).map((k) => {
    const [sym, label, f, u] = paramInfo(k, v);
    const nm = `${label} ${sym}${u ? ` (${u})` : ''}`;
    if (fit.free.indexOf(k) < 0) return [nm, four(p[k] * f), 'held', 'held'];
    if (unknown[k]) return [nm, 'not determined', '', ''];
    return [nm, four(p[k] * f), four(fit.se[k] * f), interval(fit.ci[k][0] * f, fit.ci[k][1] * f)];
  });
  const known = inOrder(p).filter((k) => fit.free.includes(k) && !unknown[k]);
  const corr = known.flatMap((a, i) => known.slice(i + 1).filter((b) => Number.isFinite(fit.corr[a]?.[b])).map((b) => [`${symbolOf(a, v)} with ${symbolOf(b, v)}`, fixed(fit.corr[a][b], 3)]));
  const stats = [
    ['Root mean square misfit, H/H0', four(fit.rms)],
    ['Readings fitted, n', fit.n],
    ['Values fitted, k', fit.free.length],
    ['Degrees of freedom, n − k', fit.dof],
    ['t(0.975, n − k)', four(fit.tCrit)],
  ];
  const { grid, curve, fitted } = fit;
  const used = new Set(fit.used);
  const inFit = n.t.map((_, i) => i).filter((i) => used.has(i)), outFit = n.t.map((_, i) => i).filter((i) => !used.has(i) && n.t[i] > 0);
  const cell = (k, x) => (unknown[k] ? 'not determined' : six(x));
  const sheets = [{
    name: 'Readings',
    header: [`Time (${v.tUnit})`, 'H/H0', 'Used in fit', 'Fitted H/H0', 'Residual'],
    rows: n.t.map((s, i) => [Number((s / ts).toPrecision(12)), six(n.ratio[i]), used.has(i) ? 'yes' : 'no', six(fitted[i]), six(n.ratio[i] - fitted[i])]),
  }, {
    name: 'Result',
    header: ['Quantity', 'Value', 'Standard error', '95% interval low', '95% interval high'],
    rows: [['Method', name, '', '', ''], ...inOrder(p).map((k) => {
      const [sym, , f, u] = paramInfo(k, v), held = fit.free.indexOf(k) < 0, nm = `${sym}${u ? ` (${u})` : ''}`;
      if (held) return [nm, six(p[k] * f), 'held', '', ''];
      return [nm, cell(k, p[k] * f), cell(k, fit.se[k] * f), cell(k, fit.ci[k][0] * f), cell(k, fit.ci[k][1] * f)];
    }), ['RMS misfit, H/H0', six(fit.rms), '', '', ''], ['Readings fitted, n', fit.n, '', '', ''], ['Values fitted, k', fit.free.length, '', '', ''], ['Degrees of freedom, n − k', fit.dof, '', '', ''], ['t(0.975, n − k)', six(fit.tCrit), '', '', ''], ...(ctx.tests ? [['Test', ctx.tests[ctx.chosen].label, '', '', '']] : [])],
  }, ...checkSheets];
  const sub = `${name[0].toUpperCase()}${name.slice(1)}, least-squares fit to ${fit.n} readings${window}. RMS misfit ${sig(fit.rms, 3)} in H/H0.`;
  // Dense readings as small dots, so the fitted curve shows between them.
  const dot = (count) => (count > 200 ? { size: 2 } : count > 60 ? { size: 3 } : {});
  return [
    panel(el('h2', {}, head), el('p', { class: 'chart-sub' }, sub), outOfDate(ctx),
      table(['Fitted', 'Value', 'Standard error', '95% interval'], rows),
      el('p', { class: 'hint' }, STATS_PLAIN),
      corr.length ? table(['Correlation', 'Value'], corr) : null,
      setup.kind === 'highK' && corr.length && Math.abs(fit.corr.K.Le) < 0.05 ? el('p', { class: 'hint' }, 'K and Lc come out nearly uncorrelated whenever the readings run until the oscillation has died away; the method text says why.') : null,
      table(['Fit', 'Value'], stats),
      kKnown ? kTable(K, v.method === 'cbp' ? 'K = T / D' : 'Hydraulic conductivity K') : null,
      ...block,
      notes(warn),
      downloads(() => downloadWorkbook('slug-test.xlsx', sheets, text))),
    // Readings first and the fit second, so they take the same colours as on the
    // pumping test page.
    panel(chart({
      title: 'Normalized head against time', xLabel: `Time (${v.tUnit})`, yLabel: 'H/H0 (ratio)', logX: !OSCILLATING.has(v.method),
      series: [
        { label: 'Readings used', x: inFit.map((i) => n.t[i] / ts), y: inFit.map((i) => n.ratio[i]), line: false, ...dot(inFit.length) },
        { label: 'Fitted curve', x: grid.map((s) => s / ts), y: curve },
        ...(outFit.length ? [{ label: 'Readings not used', x: outFit.map((i) => n.t[i] / ts), y: outFit.map((i) => n.ratio[i]), line: false, ...dot(outFit.length) }] : []),
      ],
    }), el('p', { class: 'chart-sub' }, OSCILLATING.has(v.method) ? 'Linear scales, so the oscillation shows as it was recorded.' : 'Time on a log scale, as the type curves are drawn.')),
    series,
    methodPanel(text, outOfDate(ctx)),
  ];
}
