// Calculations behind the model page's results that need no browser: contour lines,
// contour levels, the cumulative budget, and the comparison with MODFLOW 6's heads.
import { sig } from '../../../engine/format.js';

/**
 * A round contour interval, 1, 2, 2.5 or 5 times a power of ten, that gives about
 * `target` lines between min and max. Returns 0 when the range is empty.
 */
export function niceInterval(min, max, target = 12) {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return 0;
  const raw = span / target, e = Math.floor(Math.log10(raw)), m = raw / 10 ** e;
  const step = [1, 2, 2.5, 5, 10].find((s) => s >= m * (1 - 1e-9));
  return Number((step * 10 ** e).toPrecision(6));
}

/** The contour levels at multiples of the interval between min and max. */
export function contourLevels(min, max, interval) {
  if (!(interval > 0) || !(max > min)) return [];
  const out = [];
  const first = Math.ceil(min / interval - 1e-9), last = Math.floor(max / interval + 1e-9);
  if (last - first > 500) return [];
  for (let i = first; i <= last; i++) out.push(Number((i * interval).toPrecision(12)));
  return out;
}

/**
 * Contour lines by marching squares on cell centres: values is nrow*ncol (NaN where there
 * is no value), xs and ys the centre of each column and row. A square with a NaN corner is
 * skipped. A saddle is split by the mean of its four corners. Returns, for each level, a
 * flat list of segments [x1, y1, x2, y2, ...] in the same coordinates as xs and ys.
 */
export function contourLines(values, nrow, ncol, xs, ys, levels) {
  const out = levels.map(() => []);
  for (let i = 0; i + 1 < nrow; i++) {
    for (let j = 0; j + 1 < ncol; j++) {
      const a = values[i * ncol + j], b = values[i * ncol + j + 1];
      const c = values[(i + 1) * ncol + j + 1], d = values[(i + 1) * ncol + j];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      const x0 = xs[j], x1 = xs[j + 1], y0 = ys[i], y1 = ys[i + 1];
      levels.forEach((L, li) => {
        if (L < lo || L > hi || lo === hi) return;
        // Corners at or above the level count as above, so a level equal to a corner
        // value is drawn once, not twice.
        const code = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
        if (code === 0 || code === 15) return;
        const t = (p, q) => (p === q ? 0.5 : (L - p) / (q - p));
        const top = () => [x0 + (x1 - x0) * t(a, b), y0];
        const right = () => [x1, y0 + (y1 - y0) * t(b, c)];
        const bottom = () => [x0 + (x1 - x0) * t(d, c), y1];
        const left = () => [x0, y0 + (y1 - y0) * t(a, d)];
        const seg = (p, q) => out[li].push(p[0], p[1], q[0], q[1]);
        switch (code) {
          case 1: case 14: seg(left(), bottom()); break;
          case 2: case 13: seg(bottom(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(top(), right()); break;
          case 6: case 9: seg(top(), bottom()); break;
          case 7: case 8: seg(left(), top()); break;
          case 5: case 10: {
            // Code 5 has b and d above, 10 has a and c. The centre says which pair joins up;
            // the other two corners are cut off on their own.
            const centreAbove = (a + b + c + d) / 4 >= L;
            if ((code === 5) === centreAbove) { seg(left(), top()); seg(bottom(), right()); } else { seg(top(), right()); seg(left(), bottom()); }
            break;
          }
          default: break;
        }
      });
    }
  }
  return out;
}

/**
 * Cumulative volumes to the end of each step, as MODFLOW 6's list file adds them up: each
 * rate times its step length. budget is run()'s list, times the end of each step.
 */
export function cumulativeBudget(budget, times) {
  const out = [];
  const inn = {}, outt = {};
  let prev = 0;
  budget.forEach((b, s) => {
    const dt = times[s] - prev;
    prev = times[s];
    for (const [k, v] of Object.entries(b.in)) inn[k] = (inn[k] || 0) + v * dt;
    for (const [k, v] of Object.entries(b.out)) outt[k] = (outt[k] || 0) + v * dt;
    const totalIn = Object.values(inn).reduce((x, y) => x + y, 0), totalOut = Object.values(outt).reduce((x, y) => x + y, 0);
    const avg = (totalIn + totalOut) / 2;
    out.push({ in: { ...inn }, out: { ...outt }, totalIn, totalOut, discrepancyPercent: avg ? 100 * (totalIn - totalOut) / avg : 0 });
  });
  return out;
}

/**
 * The largest difference between two sets of heads, where null or NaN marks a cell with
 * no head (inactive or dry). Returns { max, compared, mismatched }: mismatched counts
 * cells where one has a head and the other none.
 */
export function headDifference(a, b) {
  let max = 0, compared = 0, mismatched = 0;
  for (let n = 0; n < a.length; n++) {
    const x = a[n], y = b[n];
    const hx = x !== null && Number.isFinite(x), hy = y !== null && Number.isFinite(y);
    if (hx !== hy) { mismatched++; continue; }
    if (!hx) continue;
    compared++;
    max = Math.max(max, Math.abs(x - y));
  }
  return { max, compared, mismatched };
}

/**
 * The largest difference between two budgets' terms, over every step, with the size of
 * the largest term: { max, largest }. Terms missing from one side count as zero.
 */
export function budgetDifference(a, b) {
  let max = 0, largest = 0;
  a.forEach((sa, s) => {
    const sb = b[s];
    for (const side of ['in', 'out']) {
      for (const k of new Set([...Object.keys(sa[side]), ...Object.keys(sb[side])])) {
        const x = sa[side][k] || 0, y = sb[side][k] || 0;
        max = Math.max(max, Math.abs(x - y));
        largest = Math.max(largest, Math.abs(x), Math.abs(y));
      }
    }
  });
  return { max, largest };
}

/**
 * Decimal places that write every multiple of a contour interval exactly: 0.25 gives 2,
 * 2.5 gives 1 and 50 gives 0, so a label never rounds a contour to its neighbour's value.
 * At most 6.
 */
export function intervalDecimals(interval) {
  if (!(interval > 0) || !Number.isFinite(interval)) return 0;
  for (let d = 0; d < 6; d++) {
    const x = interval * 10 ** d, r = Math.round(x);
    if (r >= 1 && Math.abs(x - r) <= 1e-6 * x) return d;
  }
  return 6;
}

// ---------------------------------------------------------------------------------------
// Drawdown: the head at a reference time minus the head now.

/**
 * The reference that drawdown is measured from, as { kind: 'strt' } for the starting
 * heads or { kind: 'step', step } for the heads at the end of a saved step, or null when
 * there is none. choice is '' for the page's rule, 'strt', or a step index as text.
 *
 * The rule: when the first period is steady, its heads at the end of the period (the heads
 * before anything changes); otherwise the starting heads, which are then the heads at time
 * zero. So in a model of steady periods, drawdown is the difference between the steady state
 * of period 1 and that of a later period, the standard steady drawdown. A run of one steady
 * period has no earlier state, so no drawdown unless the user chooses a step to compare
 * with. Starting heads are offered only when the first period is transient: in a steady
 * first period they are just where the solver starts.
 */
export function drawdownReference(model, result, choice = '') {
  if (!result || !model.periods.length) return null;
  const firstSteady = model.periods[0].steady === true;
  const allSteady = model.periods.every((p) => p.steady === true);
  if (choice === 'strt') return firstSteady ? null : { kind: 'strt' };
  if (choice !== '' && choice !== undefined && choice !== null) {
    const s = Number(choice);
    return Number.isInteger(s) && s >= 0 && s < result.times.length ? { kind: 'step', step: s } : null;
  }
  if (allSteady && !result.periods.some((p) => p > 0)) return null;
  if (!firstSteady) return { kind: 'strt' };
  let last = 0;
  result.periods.forEach((p, s) => { if (p === 0) last = s; });
  return { kind: 'step', step: last };
}

/** What a reference is, in words: "the starting heads" or "the heads at the end of period 1, step 1 (1 d)". */
export function referenceText(result, ref) {
  if (!ref) return '';
  if (ref.kind === 'strt') return 'the starting heads (time zero)';
  const s = ref.step;
  return `the heads at the end of period ${result.periods[s] + 1}, step ${result.steps[s] + 1} (${sig(result.times[s], 4)} d)`;
}

/** The reference heads of every cell (NaN where it has none), for a reference from drawdownReference. */
export function referenceHeads(model, result, ref) {
  const g = model.grid, ncpl = g.nrow * g.ncol, N = g.nlay * ncpl;
  if (ref.kind === 'step') return result.heads[ref.step];
  const out = new Float64Array(N);
  for (let k = 0; k < g.nlay; k++) {
    const v = model.ic.strt[k];
    for (let c = 0; c < ncpl; c++) out[k * ncpl + c] = typeof v === 'number' ? v : v[c];
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Colour scales for the map

/**
 * How values are spread over the map's colours. kind:
 *  - 'linear': evenly from the smallest value to the largest;
 *  - 'quantile': by rank among the cells shown, so each colour covers the same number of
 *    cells; on a telescoping grid the many small cells near a well then get most colours;
 *  - 'log': on log10 of the value, for values above zero, from the largest down DECADES
 *    powers of ten (or to the smallest, if nearer); smaller values and those at or below
 *    zero take the bottom colour.
 * values: one per cell (null or NaN for none), active: 1/0 per cell or null.
 * Returns { kind, lo, hi, mid, toT(v) → 0..1, clippedLow } or null when nothing has a value.
 */
export const LOG_DECADES = 3;
export function colourScale(values, active, kind = 'linear') {
  const vals = [];
  for (let c = 0; c < values.length; c++) {
    const v = values[c];
    if (v === null || v === undefined || !Number.isFinite(v) || (active && !active[c])) continue;
    vals.push(v);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const lo = vals[0], hi = vals[vals.length - 1];
  if (kind === 'quantile' && hi > lo) {
    // 256 breaks at equal steps of rank; a value's colour is where it falls among them.
    const breaks = Array.from({ length: 257 }, (_, i) => vals[Math.min(vals.length - 1, Math.round((i / 256) * (vals.length - 1)))]);
    const toT = (v) => {
      let a = 0, b = 256;
      while (b - a > 1) { const m = (a + b) >> 1; if (breaks[m] <= v) a = m; else b = m; }
      // Within a run of equal breaks, the middle of the run.
      let r = a; while (r > 0 && breaks[r - 1] === breaks[a]) r--;
      return Math.max(0, Math.min(1, ((r + a) / 2) / 256));
    };
    return { kind, lo, hi, mid: vals[Math.floor((vals.length - 1) / 2)], toT };
  }
  if (kind === 'log') {
    const pos = vals.filter((v) => v > 0);
    if (!pos.length) return null;
    const top = pos[pos.length - 1], bottom = Math.max(pos[0], top / 10 ** LOG_DECADES);
    const L0 = Math.log10(bottom), L1 = Math.log10(top);
    const span = L1 - L0;
    const toT = (v) => (!(v > 0) || v <= bottom ? 0 : span > 0 ? Math.min(1, (Math.log10(v) - L0) / span) : 0.5);
    return { kind, lo: bottom, hi: top, mid: 10 ** ((L0 + L1) / 2), toT, clippedLow: lo < bottom };
  }
  const span = hi - lo;
  return { kind: 'linear', lo, hi, mid: (lo + hi) / 2, toT: (v) => (span > 0 ? Math.max(0, Math.min(1, (v - lo) / span)) : 0.5) };
}

// ---------------------------------------------------------------------------------------
// The water budget as a table

/**
 * Decimal places for a column of budget numbers whose largest is maxAbs: enough for about
 * six figures in the largest, and the same for every number in the column, as MODFLOW 6's
 * list file writes each column in one format. 1848.35 m³/d gives 2; 152602.95 m³ gives 0.
 */
export function budgetDecimals(maxAbs) {
  if (!(maxAbs > 0)) return 2;
  return Math.max(0, Math.min(4, 5 - Math.floor(Math.log10(maxAbs))));
}

/**
 * The budget table's rows for one step: each package's rate in and out and the volumes in
 * and out since the start, then the totals and In − out, each column pair written with one
 * count of decimals (from its largest number), as strings. b is run()'s budget for the step,
 * cum the cumulativeBudget entry for it.
 */
export function budgetTable(b, cum) {
  const terms = [...new Set([...Object.keys(b.in), ...Object.keys(b.out)])];
  const raw = terms.map((t) => [t, b.in[t] || 0, b.out[t] || 0, cum.in[t] || 0, cum.out[t] || 0]);
  const rateMax = Math.max(b.totalIn, b.totalOut, ...raw.map((r) => Math.max(r[1], r[2])));
  const volMax = Math.max(cum.totalIn, cum.totalOut, ...raw.map((r) => Math.max(r[3], r[4])));
  const dr = budgetDecimals(rateMax), dv = budgetDecimals(volMax);
  const f = (v, d) => { const s = v.toFixed(d); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s.replace(/^-/, '−'); };
  const rows = raw.map(([t, a, c, e, g]) => [t, f(a, dr), f(c, dr), f(e, dv), f(g, dv)]);
  rows.push(['Total', f(b.totalIn, dr), f(b.totalOut, dr), f(cum.totalIn, dv), f(cum.totalOut, dv)]);
  rows.push(['In − out', f(b.totalIn - b.totalOut, dr), '—', f(cum.totalIn - cum.totalOut, dv), '—']);
  return { rows, decimals: { rate: dr, volume: dv } };
}

// ---------------------------------------------------------------------------------------
// The method text and the results workbook

/**
 * The results' sentence on dry cells at saved step s, by the options of the run: with no
 * rewetting a dry cell stays inactive to the end, with REWET it can be wetted again, and under
 * Newton-Raphson none dries, though a head can fall below its cell's bottom (MODFLOW 6's NPF).
 * cellName(lay, row, col) names a cell, from 0.
 */
export function dryText(model, result, s, cellName) {
  const g = model.grid, ncpl = g.nrow * g.ncol;
  const name = (n) => cellName(Math.floor(n / ncpl), Math.floor((n % ncpl) / g.ncol), n % g.ncol);
  const list = (ns) => `${ns.slice(0, 6).map(name).join('; ')}${ns.length > 6 ? '; and others' : ''}`;
  const at = (v, c) => (typeof v === 'number' ? v : v[c]);
  if (model.newton) {
    const h = result.heads[s], below = [];
    for (let k = 0; k < g.nlay; k++) {
      for (let c = 0; c < ncpl; c++) if (at(model.npf.icelltype[k], c) !== 0 && h[k * ncpl + c] < at(g.botm[k], c)) below.push(k * ncpl + c);
    }
    return below.length
      ? `No cell goes dry under the Newton-Raphson formulation, as in MODFLOW 6, but at this step ${below.length === 1 ? '1 cell has its head' : `${below.length} cells have their heads`} below the cell bottom: ${list(below)}. Such a cell stays active: it passes no water out, and can take water from its neighbours above it.`
      : 'No cell goes dry under the Newton-Raphson formulation, as in MODFLOW 6, and no head is below its cell\'s bottom at this step.';
  }
  const dry = result.dry[s];
  if (!dry.length) return 'No cell was dry at this step.';
  return `${dry.length === 1 ? '1 cell was' : `${dry.length} cells were`} dry at this step: ${list(dry)}. Dry cells are marked on the map${model.npf.rewet
    ? '. With rewetting (REWET), a dry cell is wetted again once a neighbour\'s head reaches its threshold (WETDRY), as in MODFLOW 6, so it may be wet at a later step.'
    : ' and stay inactive to the end of the run, as in MODFLOW 6 with rewetting off.'}`;
}

export const LANGEVIN_2017 = 'Langevin, C.D., Hughes, J.D., Banta, E.R., Niswonger, R.G., Panday, S., and Provost, A.M. (2017) Documentation for the MODFLOW 6 Groundwater Flow Model. U.S. Geological Survey Techniques and Methods, book 6, chap. A55. doi:10.3133/tm6A55';

/**
 * What the page did, for kit's method(): the grid, the flow equation, storage, the
 * boundaries present, the solver, the time steps, the budget and the drawdown reference.
 * model is the model as run, result its run, and ref the drawdown reference (or null).
 */
export function methodText(model, result, ref) {
  const g = model.grid, N = g.nlay * g.nrow * g.ncol;
  const activeCells = g.idomain ? g.idomain.filter((v) => v === 1).length : N;
  const transient = model.periods.some((p) => !p.steady);
  const convertible = model.npf.icelltype.some((v) => v !== 0);
  const has = (id) => model[id] && Object.values(model[id]).some((l) => (Array.isArray(l) ? l.length : true));
  const steps = [];
  steps.push({
    title: 'The model',
    lines: [
      `A block-centred finite-difference grid of ${g.nlay} ${g.nlay === 1 ? 'layer' : 'layers'}, ${g.nrow} rows and ${g.ncol} columns, in metres and days. Each cell has one head, at its centre. Rows run from north to south and are numbered from 1, as are layers and columns, as in MODFLOW 6.`,
      `The page solves the equations of MODFLOW 6's groundwater flow model, in its ${model.newton ? 'Newton-Raphson formulation (NEWTON)' : 'standard formulation (not Newton-Raphson)'}, for the packages DIS, NPF, IC, STO, CHD, WEL, RCH, EVT, RIV, DRN, GHB and OBS, as Langevin et al. (2017) give them. It adds no hydraulics of its own.`,
    ],
    numbers: [['Cells', String(N)], ['Active cells', String(activeCells)], ['Stress periods', String(model.periods.length)], ['Time steps', String(result.times.length)]],
  });
  steps.push({
    title: 'The flow equation',
    lines: [
      'For each cell n the control-volume finite-difference equation of Langevin et al. (2017, eq. 2-20) balances the flow from its neighbours m, the boundaries and storage over a time step. C(n,m) is the conductance between the two cells (m²/d), h the head at the end of the step (m), P(n) h(n) + Q(n) the flow from boundaries into the cell (m³/d), Ss(n) the specific storage (per m), V(n) the cell volume (m³), HOLD(n) the head at the start of the step and Δt the step length (d). In a steady period the storage term is left out.',
      ...(model.grid.idomain && model.grid.idomain.includes(-1) ? ['A cell of idomain −1 is a vertical pass-through cell, as in MODFLOW 6: it is not in the model, and the cell above it connects straight to the first cell below it, by half of each of those two cells\' thickness over its K33.'] : []),
      `Between neighbours in a layer C is the harmonic mean of the two half-cell transmissivities, T = K × saturated thickness (eq. 4-25), so a cell of zero transmissivity passes no water. Between layers it comes from half of each cell's thickness over its K33 (eq. 4-42), ${model.npf.variablecv ? 'with the saturated thicknesses VARIABLECV gives (below)' : 'with both cells taken as full, which is MODFLOW 6\'s default (no VARIABLECV)'}.`,
      ...(convertible && !model.newton && !model.npf.rewet ? ['In a convertible layer the saturated thickness is the head minus the bottom while the head is below the top of the cell. A cell whose head falls to its bottom goes dry and stays inactive for the rest of the run, as in MODFLOW 6 with rewetting off.'] : []),
      ...(convertible && model.npf.rewet ? [`In a convertible layer the saturated thickness is the head minus the bottom while the head is below the top of the cell. A cell whose head falls to its bottom goes dry; with rewetting (MODFLOW 6's REWET), ${model.npf.rewet.iwetit === 1 ? 'at every outer iteration' : `once every ${model.npf.rewet.iwetit} outer iterations`} a dry cell whose neighbour (below or above it, and beside it where WETDRY is above 0) has a head at or above its bottom plus |WETDRY| is made wet again, with the head bottom + ${model.npf.rewet.wetfct} × ${model.npf.rewet.ihdwet === 0 ? '(that head − bottom)' : '|WETDRY|'}, and starts its storage from its bottom.`] : []),
      ...(convertible && model.newton ? ['With Newton-Raphson, a convertible cell\'s saturated fraction is smoothed near its bottom and top (Langevin et al. 2017, ch. 4), and the conductance between two cells is the saturated one times the saturated fraction of the cell upstream, the one with the higher head. No cell goes dry: a cell whose head falls below its bottom passes no water out, takes water from its neighbours above it, and keeps its head, which can lie below the bottom.'] : []),
      ...(model.npf.k22 ? ['Between rows (along the columns, north to south) the conductivity is K22, as given; along the rows it is K. This is MODFLOW 6\'s K22 with no rotation angles.'] : []),
      ...(model.npf.thickstrt && model.npf.icelltype.includes(-1) ? ['A layer of cell type THICKSTRT is confined, with its saturated thickness taken from the starting head (its fraction of the cell, at most 1) in every conductance, as MODFLOW 6\'s NPF THICKSTRT gives it; between layers, a THICKSTRT cell below another that is not full adds no resistance, as MODFLOW 6 computes it.'] : []),
      ...(model.npf.variablecv ? [`With VARIABLECV, the conductance between layers is computed again in every iteration while either cell is convertible and not full, from the upper cell's saturated thickness and${model.npf.dewatered ? ', with DEWATERED, nothing from a lower cell that is not full' : ' the lower cell taken as full'} (MODFLOW 6's vcond).`] : []),
      ...(model.npf.perched ? ['With PERCHED, where a convertible cell below has its head under its top, the flow down to it is C (h − bottom of the upper cell), whatever its head, as MODFLOW 6\'s NPF PERCHED gives it.'] : []),
    ],
    formula: 'Σm C(n,m) (h(m) − h(n)) + P(n) h(n) + Q(n) − Ss(n) V(n) (h(n) − HOLD(n)) / Δt = 0\nC(n,m) = w T(n) T(m) / (T(n) L(m) + T(m) L(n))   (w the face width, L the distance from each centre to the face)',
    numbers: [],
  });
  if (transient) {
    steps.push({
      title: 'Storage',
      lines: [`Water released from storage is ${model.sto.storagecoefficient ? 'S × cell area × (HOLD − h) / Δt, S being the storage coefficient given (STORAGECOEFFICIENT), scaled by the saturated fraction in a convertible cell,' : 'Ss × saturated thickness × cell area × (HOLD − h) / Δt,'} ${model.sto.ssConfinedOnly ? 'acting in a convertible cell only while its head is at or above the cell top (SS_CONFINED_ONLY), as in MODFLOW 6\'s STO package with that option and in MODFLOW-2005' : 'with it acting whenever the head is above the cell bottom, as in MODFLOW 6\'s STO package'}${model.sto.storagecoefficient || model.sto.ssConfinedOnly ? '' : ' with its defaults'}.${convertible ? ' In a convertible cell below its top, specific yield Sy adds Sy × area × (HOLD − h) / Δt for the fall of the water table (Langevin et al. 2017, eq. 5-13).' : ''}`],
      numbers: [],
    });
  }
  const bounds = [];
  if (has('chd')) bounds.push('Constant-head cells (CHD) hold their head; their flow is what the neighbours give or take.');
  if (has('wel')) bounds.push(`Wells (WEL) add their rate q, negative for pumping. ${model.newton ? 'Under Newton-Raphson no cell goes dry, so every well is pumped at its rate, even where the head is below the cell bottom, as in MODFLOW 6 without AUTO_FLOW_REDUCE.' : 'A well in a cell that has gone dry is not pumped, as in MODFLOW 6.'}`);
  if (model.rch || model.rchList) {
    const fixedCell = model.options && ['rch', 'rchList'].some((k) => model.options[k] && model.options[k].fixedCell);
    const where = model.rchList ? 'on each cell listed'
      : !model.irch ? 'on the layer-1 cell of each column'
      : Object.keys(model.irch).length === 1 && typeof model.irch[0] === 'number' ? `on the layer-${model.irch[0] + 1} cell of each column`
      : 'on the cell of the layer given for each column (IRCH)';
    // Under Newton-Raphson no cell dries, so recharge stays on its own cell.
    const dryRule = model.newton ? ' (under Newton-Raphson no cell goes dry, so it stays there)' : fixedCell ? ', and only there: with FIXED_CELL, recharge on a dry cell is not applied' : ', or, when that cell is dry, on the highest active cell below it';
    bounds.push(`Recharge (RCH) is the rate times the cell area, ${where}${dryRule}, as MODFLOW 6's RCH package does (rch_cf). None goes to a constant-head cell${model.rchList ? '' : ' or a cell with idomain 0, which has no node in MODFLOW 6, so recharge given there is lost'}.`);
  }
  if (has('riv')) bounds.push('River cells (RIV) give C (stage − h) while the head is above the riverbed bottom, and C (stage − bottom) once it is at or below the bottom (Langevin et al. 2017, eq. 6-25a and 6-25b).');
  if (has('drn')) bounds.push('Drains (DRN) take C (elevation − h) while the head is above the drain, and nothing below it.');
  if (has('ghb')) bounds.push('General-head boundaries (GHB) give C (head − h).');
  if (has('evt') || has('evtList')) {
    const fixedCell = model.options && ['evt', 'evtList'].some((k) => model.options[k] && model.options[k].fixedCell);
    const segs = has('evtList') ? Object.values(model.evtList).flat().reduce((n, e) => Math.max(n, (e.length - 6) / 2 + 1), 1) : 1;
    bounds.push(`Evapotranspiration (EVT) takes the maximum rate times the cell area while the head is at or above the ET surface, ${segs > 1 ? `falling over ${segs} straight segments, each from a share of the maximum rate at its top to a smaller one at its bottom (pxdp and petm),` : 'falling linearly with depth below the surface'} to nothing at the extinction depth, and nothing below it, as MODFLOW 6's EVT package does (evt_cf). It is taken from ${has('evt') ? 'the cell of the layer given for each column (layer 1 unless IEVT says otherwise)' : 'the cell given'}${model.newton ? ' (under Newton-Raphson no cell goes dry, so it stays there)' : fixedCell ? ', and not from any other: with FIXED_CELL, ET on a dry cell is not applied' : ', or, when that cell is dry, from the highest active cell below it'}; none from a constant-head cell.`);
  }
  if (bounds.length) steps.push({ title: 'Boundaries', lines: [...bounds, 'C here is the conductance given for each entry, in m²/d.'], numbers: [] });
  const s = model.solver;
  steps.push({
    title: 'Solving each time step',
    lines: [...solverLines(s, model), ...(model.newton ? [`With Newton-Raphson each outer iteration solves for the heads with the derivatives of the upstream conductances and of storage in the matrix (Langevin et al. 2017, eq. 2-26), as MODFLOW 6 does. ${model.periods.some((p) => p.steady) ? (s.noPtc === 'all' ? 'Pseudo-transient continuation is off (NO_PTC ALL).' : `In steady periods${s.noPtc === 'first' ? ' after the first' : ''} a pseudo-time-step term is added to each cell's diagonal and right-hand side, which vanishes as the heads settle (MODFLOW 6's pseudo-transient continuation). `) : ''}${model.newton.underRelaxation ? 'With its under-relaxation, a head that falls below the bottom of the model is put back 0.9 of the way from the last head to that bottom.' : ''}`.trim()] : [])],
    numbers: [['Outer iterations, at most', String(s.outer)], ['Inner iterations, at most', String(s.inner)], ['Head closure (m)', sig(s.hclose, 3)], ['Residual closure (m³/d)', sig(s.rclose, 3)],
      ...(s.innerHclose !== undefined ? [['Inner head closure (m)', sig(s.innerHclose, 3)]] : []),
      ...(s.underRelaxation ? ['theta', 'kappa', 'gamma', 'momentum'].filter((k) => s.underRelaxation[k] !== undefined).map((k) => [`Under-relaxation ${k}`, sig(s.underRelaxation[k], 3)]) : []),
      ...(s.backtracking ? [['Backtracks, at most', String(s.backtracking.number)], ['Backtracking tolerance', sig(s.backtracking.tolerance, 3)], ['Backtracking reduction factor', sig(s.backtracking.reductionFactor, 3)], ['Backtracking residual limit (m³/d)', sig(s.backtracking.residualLimit, 3)]] : [])],
  });
  steps.push({
    title: 'Time steps',
    lines: ['As MODFLOW 6\'s TDIS: in a period of length L with n steps and multiplier a, the first step is L (1 − a) / (1 − aⁿ) (or L / n when a = 1), each later step a times the one before, and the last ends exactly at the end of the period.'],
    numbers: [],
  });
  steps.push({
    title: 'Water budget',
    lines: ['For each package, the sum of its flows into the aquifer (in) and out of it (out), from the final heads of the step, as in the MODFLOW 6 list file. Constant-head cells are counted face by face, so one that takes water on one face and gives it on another adds to both columns. The cumulative volumes add each rate times its step length.'],
    formula: 'discrepancy (%) = 100 (in − out) / ((in + out) / 2)',
    numbers: [],
  });
  steps.push({
    title: 'Drawdown',
    lines: [ref
      ? `Drawdown is the head at the reference minus the head, so it is positive where the head has fallen. The reference used: ${referenceText(result, ref)}. When the first period is steady, the page measures from the end of that period, the heads before anything changes; otherwise from the starting heads, the heads at time zero. Between two steady periods this is the steady drawdown, the change from one steady state to the other. Another step can be chosen under "Drawdown from".`
      : 'The run is of one steady period, so there is no earlier state to measure drawdown from. None is shown unless a step is chosen to measure from.'],
    numbers: [],
  });
  return { steps, references: [LANGEVIN_2017] };
}

// The method text of the outer and inner iterations, as the solver took them (ims.js, after
// MODFLOW 6 6.7.0 IMS).
function solverLines(s, model) {
  const relax = s.relax ?? 0.97;
  const pc = s.levels > 0
    ? `an incomplete LU factorization with up to ${s.levels} entries kept on each side of the diagonal of each row and a drop tolerance of ${sig(s.dropTolerance, 3)} (${relax > 0 ? `MILUT, relaxation factor ${relax}` : 'ILUT'})`
    : `a zero-fill incomplete LU factorization (${relax > 0 ? `MILU(0), relaxation factor ${relax}` : 'ILU(0)'})`;
  const method = s.linear === 'bicgstab' ? 'the biconjugate gradient stabilized method (BICGSTAB)' : 'the preconditioned conjugate gradient method (CG)';
  const ur = s.underRelaxation;
  const urText = !ur ? '' : {
    simple: `Before the next outer iteration every head change is scaled by gamma = ${sig(ur.gamma, 3)} (SIMPLE under-relaxation). `,
    cooley: `Before the next outer iteration the head changes are scaled by Cooley's factor, from the largest change against the last ones, with gamma = ${sig(ur.gamma, 3)} weighting the history (COOLEY under-relaxation). `,
    dbd: `Before the next outer iteration each cell's change is scaled by its own weight, which falls by theta = ${sig(ur.theta, 3)} when the change flips sign and grows by kappa = ${sig(ur.kappa, 3)} when it does not, up to 1, with a history weight gamma = ${sig(ur.gamma, 3)} and momentum ${sig(ur.momentum, 3)} (delta-bar-delta under-relaxation, DBD). `,
  }[ur.method];
  const bt = s.backtracking;
  return [
    `Each step is solved by outer ${model.newton ? 'iterations, Newton-Raphson ones (below)' : '(Picard) iterations'}, as MODFLOW 6's IMS solver takes them. Each one updates the saturated thicknesses, conductances and the river and drain terms from the latest heads, then solves the linear system by ${method} with ${pc} as the preconditioner${s.orthogonalizations ? `, recomputing the residual every ${s.orthogonalizations} iterations` : ''}.`,
    `${urText}${bt ? `When the residual of the new heads exceeds ${sig(bt.tolerance, 3)} times the last one, the heads are pulled back toward the last ones by the factor ${sig(bt.reductionFactor, 3)}, up to ${bt.number} times or until the residual is below ${sig(bt.residualLimit, 3)} m³/d (backtracking). ` : ''}${!ur && !bt ? 'The heads of each outer iteration are taken as they come, with no under-relaxation. ' : ''}These change the path of the iterations, not the heads they converge to${model.newton ? ': under Newton-Raphson no cell dries on the way.' : model.npf.rewet ? ', except where a cell dries on the way: with rewetting it can be wetted again, but which cells are dry when the step converges can still depend on the path.' : ', except where a cell dries on the way: with no rewetting it stays dry, so which cells dry can depend on the path.'}`,
    `Each linear solve takes at least one inner iteration, as MODFLOW 6's IMS does, and stops when, after an iteration, the largest head change is at most the ${s.innerHclose !== undefined ? 'inner head closure' : 'head closure'} and the largest residual at most the residual closure; the outer iterations stop when the linear solve has closed and no head changed by more than the head closure in that outer iteration. A step that does not converge within the outer iterations stops the run, as MODFLOW 6 does.`,
    ...(s.strict ? ['With STRICT, a linear solve counts as closed only when it closes in its first iteration.'] : []),
  ];
}

/**
 * The results as workbook sheets for kit's downloadWorkbook: the observation heads (and
 * drawdown) at every step, the budget at every step, and the heads of every layer at the
 * step shown, laid out as the grid (rows north to south, columns west to east). Values in
 * m, m³/d and m³; dry and inactive cells are left blank.
 */
export function workbookSheets(model, result, ref, step) {
  const g = model.grid, ncpl = g.nrow * g.ncol;
  const sheets = [];
  const r0 = ref ? referenceHeads(model, result, ref) : null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  if (model.obs && model.obs.length) {
    const header = ['Time (d)', 'Period', 'Step', ...model.obs.map((o) => `${o.name} head (m)`), ...(r0 ? model.obs.map((o) => `${o.name} drawdown (m)`) : [])];
    const rows = result.times.map((t, s) => [t, result.periods[s] + 1, result.steps[s] + 1,
      ...model.obs.map((o) => num(result.obs[o.name][s])),
      ...(r0 ? model.obs.map((o) => num(r0[o.lay * ncpl + o.row * g.ncol + o.col] - result.obs[o.name][s])) : [])]);
    sheets.push({ name: 'Observations', header, rows });
  }
  const terms = [...new Set(result.budget.flatMap((b) => [...Object.keys(b.in), ...Object.keys(b.out)]))];
  const cum = cumulativeBudget(result.budget, result.times);
  sheets.push({
    name: 'Budget',
    header: ['Time (d)', 'Period', 'Step', ...terms.flatMap((t) => [`${t} in (m³/d)`, `${t} out (m³/d)`]), 'Total in (m³/d)', 'Total out (m³/d)', 'In − out (m³/d)', 'Discrepancy (%)',
      ...terms.flatMap((t) => [`${t} cumulative in (m³)`, `${t} cumulative out (m³)`]), 'Cumulative in (m³)', 'Cumulative out (m³)', 'Cumulative discrepancy (%)'],
    rows: result.budget.map((b, s) => [result.times[s], result.periods[s] + 1, result.steps[s] + 1,
      ...terms.flatMap((t) => [b.in[t] || 0, b.out[t] || 0]), b.totalIn, b.totalOut, b.totalIn - b.totalOut, b.discrepancyPercent,
      ...terms.flatMap((t) => [cum[s].in[t] || 0, cum[s].out[t] || 0]), cum[s].totalIn, cum[s].totalOut, cum[s].discrepancyPercent]),
  });
  // A sheet holds at most 16384 columns; a wider grid is written one cell to a row.
  const h = result.heads[step];
  for (let k = 0; k < g.nlay; k++) {
    const name = `Heads layer ${k + 1}`;
    if (g.ncol < 16000) {
      sheets.push({ name, header: ['Row', ...Array.from({ length: g.ncol }, (_, j) => `Column ${j + 1}`)],
        rows: Array.from({ length: g.nrow }, (_, i) => [i + 1, ...Array.from({ length: g.ncol }, (_, j) => num(h[k * ncpl + i * g.ncol + j]))]) });
    } else {
      const rows = [];
      for (let i = 0; i < g.nrow; i++) for (let j = 0; j < g.ncol; j++) rows.push([i + 1, j + 1, num(h[k * ncpl + i * g.ncol + j])]);
      sheets.push({ name, header: ['Row', 'Column', 'Head (m)'], rows });
    }
  }
  return sheets;
}
