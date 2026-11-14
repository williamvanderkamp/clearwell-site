// Limits and warnings shared by several solutions. Each limit comes from physics or from
// the published method, never from a typical value; where each comes from is given here.
import { listed, sig } from '../format.js';
import { TIME_UNITS } from '../units.js';

// Storativity and specific yield are volumes of water released per unit area of aquifer
// per unit fall in head, and specific yield is the drainable share of the pore space
// (Kruseman and de Ridder 1994, sections 1.7.7 and 1.7.9, p. 23): fractions, so at most 1.
export const FRACTION_MAX = 1;

// The largest specific storage that compressibility allows. Ss = ρg(α + nβ) (Kruseman and
// de Ridder 1994, equation 1.10, p. 23), with the compressibility of the solid α at most
// 10⁻⁶ m²/N, the top of their range for clay, the most compressible material they list,
// and nβ at most β = 4.4 × 10⁻¹⁰ m²/N for water (p. 22): 1000 × 9.81 × 1.0004 × 10⁻⁶ is
// 9.8 × 10⁻³ per metre, just under 10⁻².
export const SS_MAX = 1e-2;

// Specific storage, Kz/Kr and α₁ get no other limit, because neither physics nor the
// methods give one:
// - Specific storage has no lower limit. Kruseman and de Ridder's smallest compressibility,
//   10⁻¹⁰ m²/N for gravel and fractured rock (p. 22), would give ρgα ≈ 10⁻⁶ per metre for
//   a whole rock mass, but the Ss of Barker (1988) and Moench (1984) is the fracture
//   system's, per unit volume of the whole aquifer, and the fractures can be a tiny share
//   of that volume.
// - Kz/Kr is above zero and nothing more: layering makes it small and vertical fractures
//   can make it above 1, and neither Neuman (1975), Hantush (1964) nor Barlow and Moench
//   (1999) bound it.
// - The drainage constant α₁ is above zero, and an infinite α₁ is instantaneous drainage
//   (Barlow and Moench 1999, p. 8, have it entered as 10⁹), so it has no upper limit either.
// A value that wanders far because the readings do not fix it is reported as not
// determined by the fit (fit.js), not stopped at an invented limit.

// Values the fit could not determine. The page passes ctx.undetermined, a Set of the ids
// of the values it shows as "not determined"; method() and check() then state no number
// built from one, since a number derived from a value that is not determined is not
// determined either. ctx may be missing, as in the tests of the formulas alone.
/** The ids among `ids` that the page shows as not determined, in order. */
export const undeterminedOf = (ctx, ids) => ids.filter((id) => Boolean(ctx?.undetermined?.has(id)));

// The readings fitted, for a check() on the range of time its source gives a form for.
// The page passes ctx.readings = { t, since, unit }: each reading's time since pumping
// began and since the start of its own period of constant rate, in days, in time order,
// and the time unit of the readings ('s', 'min', 'h' or 'd'). Missing in the tests of the
// formulas alone, and then nothing is said about the readings.
/** ctx.readings when it holds at least one reading, else null. */
export const readingsOf = (ctx) => (ctx?.readings?.t?.length ? ctx.readings : null);

/** A time in days as "0.0225 d", with the readings' own unit after it when that is another: "0.0225 d (32.4 min)". */
export function timeText(days, ctx) {
  const u = ctx?.readings?.unit, d = `${sig(days, 3)} d`;
  return u && u !== 'd' && TIME_UNITS[u] ? `${d} (${sig(days / TIME_UNITS[u], 3)} ${u})` : d;
}

/**
 * `text` (such as "β = 0.758"), or, when it rests on a value that is not determined,
 * "β is not determined, because S′ is not". params gives each id's display symbol. A
 * value that is itself named ("the skin Sw") is just "the skin Sw is not determined".
 */
export function derived(ctx, params, ids, name, text) {
  const missing = symbolsOf(params, undeterminedOf(ctx, ids));
  if (!missing.length) return text;
  const others = missing.filter((s) => s !== name && !name.endsWith(` ${s}`));
  return others.length ? `${name} is not determined, because ${listed(others)} ${others.length > 1 ? 'are' : 'is'} not` : `${name} is not determined`;
}

const symbolsOf = (params, ids) => ids.map((id) => (params.find((p) => p.id === id) || { symbol: id }).symbol);

/** "because S and Kz/Kr are not", for the values among ids not determined, or ''. */
export function becauseNot(ctx, params, ids) {
  const missing = symbolsOf(params, undeterminedOf(ctx, ids));
  return missing.length ? `because ${listed(missing)} ${missing.length > 1 ? 'are' : 'is'} not` : '';
}

// A water table test shows two stages, elastic storage first and drainage later, which
// the early and the late readings fix as S and Sy; with no delayed response the record
// follows only the late one (Kruseman and de Ridder 1994, p. 100-101).
const RESTART = 'If the record does show both stages, give starting values for S from the early readings and Sy from the late ones, or hold one of them, and fit again.';

/**
 * The warning that a delayed-drainage fit has settled on one Theis curve, given only on
 * evidence of it: S or Sy not determined (the readings show one stage, not two), Sy not
 * above S (impossible in a water table aquifer), or, where `close` is set, Sy under twice
 * S (early and late Theis curves under 0.3 of a log cycle apart, so hardly any delayed
 * stage between them). Empty when there is no such evidence.
 */
export function singleCurveWarning(p, ctx, params, close = false) {
  const missing = undeterminedOf(ctx, ['S', 'Sy']).map((id) => params.find((q) => q.id === id).symbol);
  if (missing.length) return [`${listed(missing)} ${missing.length > 1 ? 'are' : 'is'} not determined, so the readings fix only one of the two stages of a water table test, elastic storage (S) early and drainage (Sy) later: the fitted curve may be a single Theis curve through all the readings. ${RESTART}`];
  if (!(p.Sy > p.S)) return [`The fitted specific yield is not above the elastic storativity, as it must be in a water table aquifer: the fit has not found the delayed-drainage solution, and may have settled on a single Theis curve through all the readings. ${RESTART}`];
  if (close && p.Sy < 2 * p.S) return [`Sy is only ${sig(p.Sy / p.S)} times S, so the early and late Theis curves are under 0.3 of a log cycle apart in time and the curve shows hardly any delayed-drainage stage between them: the fit may have settled on a single Theis curve through all the readings. ${RESTART}`];
  return [];
}

// A skin in these solutions is a thin layer of low permeability with no storage, its
// factor Sw = K ds / (Ks rw) (Barlow and Moench 1999, p. 7, assumption 13, and p. 11;
// Barker 1988, p. 1797; Moench 1984, abstract, for the fracture skin), so it is zero or
// above. Below zero, with storage in the well, the denominator of every one of these
// transforms, p π rc² × (well face) + (flow into the aquifer), vanishes at a real p > 0,
// because the well-face term, K0(x) + Sw x K1(x) or 1 + Sw Φ, turns negative as p grows:
// a pole on the right of the Laplace plane, so the drawdown would grow without bound. tests/solutions/skin.test.js shows the
// root. A well improved by development has an effective radius rw e^(−skin) larger than
// rw (Kruseman and de Ridder 1994, equation 14.5, p. 201), which is entered as rw with
// the skin held at 0.
export const SKIN_MIN = 0;
// The fit takes finite differences a step of about 10⁻³ either side of a value, so at
// the limit it asks for a skin just below zero. Down to −SKIN_MARGIN the pole lies far
// beyond the Laplace values any inversion here uses (past 10¹⁰ per day for rw = 0.1 m and
// T/S = 10⁶ m²/d), so the drawdown there is smooth and is given; below it is refused.
export const SKIN_MARGIN = 0.05;
/** Is this skin allowed: zero or above, or within the margin the fit's differences need? */
export const skinAllowed = (v) => v >= SKIN_MIN - SKIN_MARGIN;
export const SKIN_HINT = 'No unit. Zero or above; 0 is no skin.';

/** The message for a skin below zero, naming the solution. */
export const skinRefusal = (name, symbol = 'Sw') => `The skin ${symbol} cannot be below zero in ${name}: the method's skin is a thin layer of low permeability, and with storage in the well a skin below zero makes the drawdown grow without bound. For a well improved by development, enter its effective radius, rw e^(−skin), as rw and hold ${symbol} at 0.`;

// Image wells for a well with storage each carry their own storage, which leaves out the
// drawdown an image adds to the pumped well's own water level. The tests in
// tests/solutions/images-storage.test.js compare that with the exact coupled transform
// for one boundary, in the pumped well and halfway to the boundary: the worst error over
// time stays under 1% (0.8% at most) from a²S/rc² = 10 up, and reaches 7% at
// a²S/rc² = 0.28 (a = 50 m, S = 10⁻⁵, rc = 0.3 m) and 40% at 4.4 × 10⁻⁴ (a = 2 m).
export const IMAGE_STORAGE_MIN = 10;

/** Is a²S/rc² below the limit, allowing for rounding in the product? */
export const imageStorageLow = (group) => group < IMAGE_STORAGE_MIN * (1 - 1e-9);

/** The distance from the pumped well (at the origin) to the nearest boundary line, or Infinity. */
export const nearestBoundary = (ctx) => Math.min(Infinity, ...((ctx && ctx.lines) || []).map((l) => Math.abs(l.at)));

/**
 * The warning for image wells beside a well with storage, or none. S is the storativity,
 * and id the value it comes from (S, or Ss for a storativity Ss b).
 */
export function imageStorageWarning(S, rc, ctx, id = 'S') {
  const a = nearestBoundary(ctx);
  if (!(rc > 0) || !Number.isFinite(a)) return [];
  if (undeterminedOf(ctx, [id]).length) return [`${id} is not determined, so a²S/rc², which says how well the image wells stand in for the boundary beside a well with casing storage, cannot be worked out. Each image well is given its own casing storage, which is out by under 1% from a²S/rc² = ${sig(IMAGE_STORAGE_MIN)} up and by up to 40% far below it. Treat the fitted values as approximate.`];
  const group = (a * a * S) / (rc * rc);
  if (!imageStorageLow(group)) return [];
  return [`The nearest boundary is ${sig(a)} m from the pumped well, and a²S/rc² = ${sig(group)}, below ${sig(IMAGE_STORAGE_MIN)}. Each image well is given its own casing storage, which leaves out the drawdown the boundary adds to the pumped well's own water level while its casing is still emptying; against the exact solution for one boundary this is out by up to 7% at a²S/rc² = 0.28 and 40% at ${sig(4.4e-4)}, and by under 1% from 10 up. Treat the fitted values as approximate.`];
}
