// The keys the model JSON may hold (docs/design/model.md), and the check that refuses any
// other: a key the solver does not know would otherwise be passed over in silence, and the
// run be of another model than the one asked for (a misspelt npf.variableCV leaves VARIABLECV
// off, a top-level evtlist leaves out the ET). run() and fromMf6 both check with it.
//
// Pure JavaScript with no DOM.

const PERIOD_MAP = 'periods';   // { "0": ..., "3": ... }: keys are period numbers, checked where read
const KEYS = {
  model: {
    name: 1, grid: 1, npf: 1, sto: 1, ic: 1, periods: 1, obs: 1, solver: 1, newton: 1,
    chd: PERIOD_MAP, wel: PERIOD_MAP, riv: PERIOD_MAP, drn: PERIOD_MAP, ghb: PERIOD_MAP, rch: PERIOD_MAP, irch: PERIOD_MAP,
    rchList: PERIOD_MAP, evt: PERIOD_MAP, evtList: PERIOD_MAP, options: 1,
    units: 1, fileUnits: 1, notes: 1, georef: 1, startDateTime: 1,
  },
  grid: { nlay: 1, nrow: 1, ncol: 1, delr: 1, delc: 1, top: 1, botm: 1, idomain: 1 },
  npf: { icelltype: 1, k: 1, k22: 1, k33: 1, thickstrt: 1, variablecv: 1, dewatered: 1, perched: 1, rewet: 1, wetdry: 1 },
  'npf.rewet': { wetfct: 1, iwetit: 1, ihdwet: 1 },
  sto: { ss: 1, sy: 1, storagecoefficient: 1, ssConfinedOnly: 1 },
  ic: { strt: 1 },
  period: { length: 1, nstp: 1, tsmult: 1, steady: 1 },
  obs: { name: 1, lay: 1, row: 1, col: 1 },
  solver: {
    outer: 1, inner: 1, hclose: 1, rclose: 1, innerHclose: 1, strict: 1, relax: 1, linear: 1, levels: 1, dropTolerance: 1,
    orthogonalizations: 1, underRelaxation: 1, backtracking: 1, noPtc: 1,
  },
  'solver.backtracking': { number: 1, tolerance: 1, reductionFactor: 1, residualLimit: 1 },
  units: { length: 1, time: 1 },
  fileUnits: { length: 1, time: 1 },
  georef: { xorigin: 1, yorigin: 1, angrot: 1, crs: 1 },
};
// The values each UNDER_RELAXATION method reads (sln_underrelax): any other is refused.
const UNDER_RELAXATION = { simple: ['gamma'], cooley: ['gamma'], dbd: ['theta', 'kappa', 'gamma', 'momentum'] };

// The edit distance of two keys, case counting as no difference, for "did you mean".
function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** The known keys nearest to an unknown one (within 2 edits, or the same but for case), for the message. */
export function nearMiss(key, known) {
  let best = Infinity, out = [];
  for (const k of known) {
    const dd = distance(key, k);
    if (dd < best) { best = dd; out = [k]; } else if (dd === best) out.push(k);
  }
  return best <= (key.length <= 3 ? 1 : 2) ? out : [];
}

function refuse(where, key, known, whatFor) {
  const near = nearMiss(key, known);
  const hint = near.length ? ` Did you mean ${near.map((k) => `${where ? `${where}.` : ''}${k}`).join(' or ')}?` : '';
  const list = whatFor || `${where || 'The model'} takes ${known.join(', ')}`;
  throw new Error(`${where ? `${where}.` : ''}${key} is not a key the model knows, so it is refused rather than passed over.${hint} (${list}.)`);
}

function checkObject(obj, kind, where) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  const known = Object.keys(KEYS[kind]);
  for (const key of Object.keys(obj)) if (!(key in KEYS[kind])) refuse(where, key, known);
}

/**
 * Refuse any key of the model JSON the solver does not know, naming it and, when it is a
 * near miss, the key meant; and in solver.underRelaxation any value its method does not read.
 * Values are checked where they are read (run.js, grid.js and the package files).
 */
export function checkKeys(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return;
  checkObject(model, 'model', '');
  for (const kind of ['grid', 'npf', 'sto', 'ic', 'solver', 'units', 'fileUnits', 'georef']) checkObject(model[kind], kind, kind);
  if (model.npf) checkObject(model.npf.rewet, 'npf.rewet', 'npf.rewet');
  if (Array.isArray(model.periods)) model.periods.forEach((p, i) => checkObject(p, 'period', `periods[${i}]`));
  if (Array.isArray(model.obs)) model.obs.forEach((o, i) => checkObject(o, 'obs', `obs[${i}]`));
  const s = model.solver;
  if (s && typeof s === 'object') {
    checkObject(s.backtracking, 'solver.backtracking', 'solver.backtracking');
    const ur = s.underRelaxation;
    if (ur && typeof ur === 'object' && !Array.isArray(ur) && UNDER_RELAXATION[ur.method]) {
      const known = ['method', ...UNDER_RELAXATION[ur.method]];
      for (const key of Object.keys(ur)) {
        if (!known.includes(key)) {
          refuse('solver.underRelaxation', key, known, `${ur.method.toUpperCase()} under-relaxation reads ${UNDER_RELAXATION[ur.method].join(', ')}, and no other value`);
        }
      }
    }
  }
}
