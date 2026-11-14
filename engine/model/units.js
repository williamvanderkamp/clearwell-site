// Units of a flow model read from MODFLOW 6 files. The model itself is in metres and days
// (docs/design/model.md). MODFLOW 6 does no conversion of its own: LENGTH_UNITS (DIS) and
// TIME_UNITS (TDIS) only label the numbers, and either may be left out, which mf6io 6.7.0
// calls UNKNOWN (gwf-dis.dfn, sim-tdis.dfn). So a model in feet or seconds is converted
// here, every value by its own dimension, and a model whose unit is not given is kept as
// it is and marked, so that someone says what it is before it is run.
//
// Exact factors (NIST Special Publication 811, 2008 edition): 1 ft = 0.3048 m exactly, the
// international foot of 1959 (appendix B.6); 1 d = 24 h = 1440 min = 86 400 s (table 6).
// MODFLOW 6 does not say which foot FEET means; the U.S. survey foot is longer by 2 parts in
// a million (B.6), which is 2 mm in 1000 ft.

/** Metres in one of each MODFLOW 6 length unit. */
export const METRES_PER = { METERS: 1, FEET: 0.3048, CENTIMETERS: 0.01 };
/** Each MODFLOW 6 time unit in one day. */
export const PER_DAY = { DAYS: 1, HOURS: 24, MINUTES: 1440, SECONDS: 86400 };

const LENGTH_WORD = { METERS: 'metres', FEET: 'feet', CENTIMETERS: 'centimetres', UNKNOWN: 'an unknown length unit' };
const TIME_WORD = { DAYS: 'days', HOURS: 'hours', MINUTES: 'minutes', SECONDS: 'seconds', UNKNOWN: 'an unknown time unit' };
const LENGTH_FACTOR = { FEET: '1 ft = 0.3048 m exactly', CENTIMETERS: '1 cm = 0.01 m' };
const TIME_FACTOR = { HOURS: '1 d = 24 h', MINUTES: '1 d = 1440 min', SECONDS: '1 d = 86 400 s' };
export const lengthWord = (u) => LENGTH_WORD[u] || u;
export const timeWord = (u) => TIME_WORD[u] || u;

// Each value's dimension as [length power, time power].
const L = [1, 0], V = [1, -1], Q = [3, -1], C = [2, -1], T = [0, 1], PER_L = [-1, 0];
// evtList: surface, rate and depth; its pxdp and petm values have no dimension.
const LIST_DIMS = { chd: [L], wel: [Q], riv: [L, C, L], drn: [L, C], ghb: [L, C], evtList: [L, V, L], rchList: [V] };
const EVT_DIMS = { surface: L, rate: V, depth: L };

// Scales every value of dimension length^a time^b by toMetres^a perDay^-b, in place: toMetres
// is the metres in the model's length unit, perDay its time units in a day. Per-layer
// inputs may be numbers or nrow*ncol values.
function scaleModel(m, toMetres, perDay) {
  const f = ([a, b]) => toMetres ** a * perDay ** -b;
  const one = (v, k) => (typeof v === 'number' ? v * k : Array.isArray(v) ? v.map((x) => x * k) : v);
  const layers = (arr, dim) => (Array.isArray(arr) ? arr.map((v) => one(v, f(dim))) : arr);
  const g = m.grid;
  if (g) {
    g.delr = one(g.delr, f(L));
    g.delc = one(g.delc, f(L));
    g.top = one(g.top, f(L));
    g.botm = layers(g.botm, L);
  }
  if (m.npf) {
    m.npf.k = layers(m.npf.k, V);
    if (m.npf.k33 != null) m.npf.k33 = layers(m.npf.k33, V);
    // WETDRY's size is a height above the cell bottom (gwf-npf.dfn); its sign is kept.
    if (m.npf.wetdry != null) m.npf.wetdry = layers(m.npf.wetdry, L);
    if (m.npf.k22 != null) m.npf.k22 = layers(m.npf.k22, V);
  }
  // Ss is per length; a storage coefficient (STORAGECOEFFICIENT) and Sy have no dimension.
  if (m.sto && !m.sto.storagecoefficient) m.sto.ss = layers(m.sto.ss, PER_L);
  if (m.ic) m.ic.strt = layers(m.ic.strt, L);
  // The grid's origin on the map is a length; its rotation (degrees) has no unit.
  if (m.georef) for (const k of ['xorigin', 'yorigin']) if (typeof m.georef[k] === 'number') m.georef[k] *= f(L);
  if (Array.isArray(m.periods)) for (const p of m.periods) if (typeof p.length === 'number') p.length *= f(T);
  for (const [key, dims] of Object.entries(LIST_DIMS)) {
    if (!m[key]) continue;
    for (const list of Object.values(m[key])) {
      for (const e of list) dims.forEach((d, j) => { e[3 + j] *= f(d); });
    }
  }
  if (m.rch) for (const p of Object.keys(m.rch)) m.rch[p] = one(m.rch[p], f(V));
  if (m.evt) for (const v of Object.values(m.evt)) for (const [k, d] of Object.entries(EVT_DIMS)) if (v[k] !== undefined) v[k] = one(v[k], f(d));
  if (m.solver) {
    // hclose is a head change; rclose a flow residual at one cell (mf6io, IMS INNER_RCLOSE).
    if (typeof m.solver.hclose === 'number') m.solver.hclose *= f(L);
    if (typeof m.solver.rclose === 'number') m.solver.rclose *= f(Q);
    // The inner head closure is a head change; the backtracking residual limit a 2-norm of
    // flow residuals (sln_backtracking). The under-relaxation factors, the drop tolerance
    // and the backtracking tolerance and reduction factor are ratios.
    if (typeof m.solver.innerHclose === 'number') m.solver.innerHclose *= f(L);
    if (m.solver.backtracking && typeof m.solver.backtracking.residualLimit === 'number') m.solver.backtracking.residualLimit *= f(Q);
  }
  return m;
}

function check(units) {
  if (units.length !== undefined && !(units.length in METRES_PER)) throw new Error(`Length unit ${units.length}: give METERS, FEET or CENTIMETERS.`);
  if (units.time !== undefined && !(units.time in PER_DAY)) throw new Error(`Time unit ${units.time}: give DAYS, HOURS, MINUTES or SECONDS.`);
}

/**
 * The model with its values converted to metres and days, from the units they are in now:
 * { length, time }, each a MODFLOW 6 unit name, either left out when it is already metres
 * or days. Returns a new model. model.units (the units still unknown) loses the units that
 * were given, and model.fileUnits records the units the files were in, so that toMf6 can
 * write them back. A note saying what was converted is added to model.notes.
 */
export function convertUnits(model, units) {
  check(units);
  const m = structuredClone(model);
  const length = units.length ?? 'METERS', time = units.time ?? 'DAYS';
  scaleModel(m, METRES_PER[length], PER_DAY[time]);
  if (m.units) {
    if (units.length !== undefined) delete m.units.length;
    if (units.time !== undefined) delete m.units.time;
    if (!Object.keys(m.units).length) delete m.units;
  }
  const changed = {};
  if (length !== 'METERS') changed.length = length;
  if (time !== 'DAYS') changed.time = time;
  if (Object.keys(changed).length) {
    m.fileUnits = { ...(m.fileUnits || {}), ...changed };
    const what = [length !== 'METERS' && `${lengthWord(length)} to metres (${LENGTH_FACTOR[length]})`,
      time !== 'DAYS' && `${timeWord(time)} to days (${TIME_FACTOR[time]})`].filter(Boolean);
    m.notes = [...(m.notes || []), `The model was converted from ${what.join(' and from ')}: every length, rate, conductance, storage and time, ${m.georef && ('xorigin' in m.georef || 'yorigin' in m.georef) && length !== 'METERS' ? 'the solver closures and the grid\'s origin on the map (XORIGIN, YORIGIN)' : 'and the solver closures'}. It is shown and run in metres and days.`];
  }
  return m;
}

/**
 * The model's values in the given units, from metres and days: the inverse of
 * convertUnits, for writing MODFLOW 6 files in the units they came in. Returns a new model.
 */
export function toUnits(model, units) {
  check(units);
  const m = structuredClone(model);
  return scaleModel(m, 1 / METRES_PER[units.length ?? 'METERS'], 1 / PER_DAY[units.time ?? 'DAYS']);
}

/** A message when the model's length or time unit is still unknown, or null. */
export function unknownUnits(model) {
  const u = model && model.units;
  if (!u) return null;
  const missing = [u.length === 'UNKNOWN' && 'length (metres, feet or centimetres)', u.time === 'UNKNOWN' && 'time (days, hours, minutes or seconds)'].filter(Boolean);
  if (!missing.length) return null;
  return `The model's unit of ${missing.join(' and of ')} is not known: its MODFLOW 6 files do not give ${[u.length === 'UNKNOWN' && 'LENGTH_UNITS', u.time === 'UNKNOWN' && 'TIME_UNITS'].filter(Boolean).join(' or ')}. Say which ${missing.length > 1 ? 'they are' : 'it is'} before the model is run.`;
}
