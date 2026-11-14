// Writes the flow model (docs/design/model.md) as MODFLOW 6 input files and reads such
// files back. The formats follow the MODFLOW 6 input and output guide (mf6io) for 6.7.0
// and its input definition (dfn) files. JSON indices count from 0, the files from 1.
// Pure JavaScript with no DOM, so it runs in Node and in a Web Worker.
import { checkKeys } from './keys.js';
import { cellName } from './grid.js';
import { METRES_PER, PER_DAY, convertUnits, toUnits } from './units.js';
import { COMPLEXITY, OUTER_DEFAULTS, RELAX } from './ims.js';
import { evtSegments } from './evt.js';
import { checkNewton } from './newton.js';
import { listed } from '../format.js';

// The solver values MODFLOW 6 assigns for each COMPLEXITY, and for SIMPLE when COMPLEXITY is
// left out, are ims.js COMPLEXITY (the linear and nonlinear blocks) and OUTER_DEFAULTS (the
// under-relaxation and backtracking values a file leaves out), from the MODFLOW 6 6.7.0
// source (sln_setouter, ImsLinearSettings preset_config) and the input guide's table "IMS
// variable values for the available complexity options" (doc/mf6io/ims_table.tex).

// What a refused option or array is, so the message names the feature, not just the word.
// The names follow the mf6io 6.7.0 dfn descriptions.
const FEATURES = {
  TS6: 'time series (TS6) are not supported: give the values in each PERIOD block',
  TAS6: 'time-array series (TAS6) are not supported: give the arrays in each PERIOD block',
  OBS6: 'observations of a stress package (OBS6 in its OPTIONS) are not supported: only head observations in the model\'s own OBS6 file are read',
  AUXILIARY: 'auxiliary variables (AUXILIARY) are not supported',
  AUXMULTNAME: 'auxiliary multipliers (AUXMULTNAME) are not supported',
  AUXDEPTHNAME: 'drain depths from an auxiliary variable (AUXDEPTHNAME) are not supported',
  AUX: 'auxiliary arrays (AUX) are not supported',
  MOVER: 'the water mover (MOVER) is not supported',
  AUTO_FLOW_REDUCE: 'reducing a well\'s rate as its cell dries (AUTO_FLOW_REDUCE) is not supported',
  AUTO_FLOW_REDUCE_CSV: 'reducing a well\'s rate as its cell dries (AUTO_FLOW_REDUCE) is not supported',
  FLOW_REDUCTION_LENGTH: 'reducing a well\'s rate as its cell dries (AUTO_FLOW_REDUCE) is not supported',
  HIGHEST_CELL_SATURATION: 'the saturation of the higher cell for both cells of a connection (HIGHEST_CELL_SATURATION) is not supported',
  XT3D: 'the XT3D formulation is not supported',
  ALTERNATIVE_CELL_AVERAGING: 'conductance averaging other than the harmonic mean (ALTERNATIVE_CELL_AVERAGING) is not supported',
  K22OVERK: 'K22 given as a ratio to K (K22OVERK) is not supported',
  K33OVERK: 'K33 given as a ratio to K (K33OVERK) is not supported: give K33 itself',
  TVK6: 'time-varying conductivity (TVK6) is not supported',
  ANGLE1: 'rotated anisotropy (ANGLE1, ANGLE2, ANGLE3) is not supported',
  ANGLE2: 'rotated anisotropy (ANGLE1, ANGLE2, ANGLE3) is not supported',
  ANGLE3: 'rotated anisotropy (ANGLE1, ANGLE2, ANGLE3) is not supported',
  TVS6: 'time-varying storage (TVS6) is not supported',
  SURF_RATE_SPECIFIED: 'a proportion of the ET rate at the ET surface (SURF_RATE_SPECIFIED, PETM0) is not supported: the rate at and above the surface is the maximum rate',
  ATS6: 'adaptive time stepping (ATS6) is not supported',
};
const MODEL_TYPES = { GWT6: 'groundwater transport', GWE6: 'groundwater energy transport', PRT6: 'particle tracking' };
const PACKAGE_TYPES = {
  DISV6: 'a grid of vertices: only the structured grid, DIS6, is read', DISU6: 'an unstructured grid: only the structured grid, DIS6, is read',
  UZF6: 'unsaturated-zone flow', MAW6: 'multi-aquifer wells', SFR6: 'streamflow routing', LAK6: 'lakes',
  HFB6: 'horizontal flow barriers', CSUB6: 'compaction and subsidence', BUY6: 'buoyancy', VSC6: 'viscosity', MVR6: 'the water mover',
  GNC6: 'ghost nodes', API6: 'a package run from outside the program', UZE6: 'unsaturated-zone energy',
};

const LISTS = {
  // package key: [file type, extension, values after the cell, their names]
  chd: ['CHD6', 'chd', ['head']],
  wel: ['WEL6', 'wel', ['q']],
  riv: ['RIV6', 'riv', ['stage', 'cond', 'rbot']],
  drn: ['DRN6', 'drn', ['elev', 'cond']],
  ghb: ['GHB6', 'ghb', ['bhead', 'cond']],
};
const PER_LINE = 10;

// --- writing ------------------------------------------------------------------------

function num(x, what) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${what}: ${x} is not a finite number.`);
  // The shortest text that reads back as the same double, which Fortran reads as is.
  return String(x);
}

// The grid's place on a map (DIS XORIGIN, YORIGIN, ANGROT and CRS), written back as read.
function georefLines(geo) {
  if (!geo) return [];
  const out = [];
  for (const k of ['xorigin', 'yorigin', 'angrot']) if (geo[k] !== undefined) out.push(`  ${k.toUpperCase()} ${num(geo[k], `georef.${k}`)}`);
  if (geo.crs !== undefined) out.push(`  CRS ${geo.crs}`);
  return out;
}

function int(x, what) {
  if (!Number.isInteger(x)) throw new Error(`${what}: ${x} is not a whole number.`);
  return String(x);
}

// Values PER_LINE to a line. With rowLen, each row of the grid starts on a new line,
// as MODFLOW 6 reads a layer one row at a time.
function wrap(values, fmt, rowLen = values.length) {
  const out = [];
  for (let r = 0; r < values.length; r += rowLen) {
    for (let i = r; i < r + rowLen; i += PER_LINE) out.push('      ' + values.slice(i, Math.min(i + PER_LINE, r + rowLen)).map(fmt).join(' '));
  }
  return out;
}

// One READARRAY control line and its values: CONSTANT for a number, INTERNAL for a list.
function array(v, n, what, isInt = false, rowLen = n) {
  const fmt = (x) => (isInt ? int(x, what) : num(x, what));
  if (typeof v === 'number') return [`    CONSTANT ${fmt(v)}`];
  if (!Array.isArray(v) || v.length !== n) throw new Error(`${what}: needs a number or ${n} values, not ${Array.isArray(v) ? v.length : typeof v}.`);
  return [`    INTERNAL FACTOR ${isInt ? 1 : '1.0'}`, ...wrap(v, fmt, rowLen)];
}

function layered(name, vals, nlay, n2, ncol, what, isInt = false) {
  if (!Array.isArray(vals) || vals.length !== nlay) throw new Error(`${what}: needs one entry per layer (${nlay}).`);
  return [`  ${name} LAYERED`, ...vals.flatMap((v, l) => array(v, n2, `${what}, layer ${l + 1}`, isInt, ncol))];
}

function block(name, lines, arg = '') {
  const head = arg === '' ? name : `${name} ${arg}`;
  return [`BEGIN ${head}`, ...lines, `END ${name}`, ''];
}

function file(title, blocks) {
  return [`# ${title}, written by Clearwell`, ...blocks.flat()].join('\n');
}

function checkModel(m) {
  if (!m || typeof m !== 'object') throw new Error('The model must be an object.');
  if (typeof m.name !== 'string' || !/^[A-Za-z0-9_.-]{1,16}$/.test(m.name)) {
    throw new Error(`Model name "${m.name}": MODFLOW 6 takes 1 to 16 letters, digits, _, . or -.`);
  }
  const g = m.grid;
  if (!g) throw new Error('The model has no grid.');
  for (const k of ['nlay', 'nrow', 'ncol']) if (!(Number.isInteger(g[k]) && g[k] > 0)) throw new Error(`grid.${k} must be a whole number above zero.`);
  if (!Array.isArray(m.periods) || !m.periods.length) throw new Error('The model needs at least one period.');
  if (!m.npf || !m.ic) throw new Error('The model needs npf and ic.');
  if (!m.solver) throw new Error('The model needs solver settings.');
  checkNewton(m.newton);
  if (!m.sto && m.periods.some((p) => !p.steady)) throw new Error('A transient period needs sto (ss and sy).');
  if (m.georef !== undefined) {
    if (!m.georef || typeof m.georef !== 'object') throw new Error('georef must hold xorigin, yorigin, angrot or crs.');
    for (const k of Object.keys(m.georef)) {
      if (!['xorigin', 'yorigin', 'angrot', 'crs'].includes(k)) throw new Error(`georef.${k} is not one of xorigin, yorigin, angrot and crs.`);
    }
    if (m.georef.crs !== undefined && (typeof m.georef.crs !== 'string' || !/^\S[^\n]*$/.test(m.georef.crs))) throw new Error('georef.crs must be text on one line.');
  }
  if (m.startDateTime !== undefined && (typeof m.startDateTime !== 'string' || !/^\S+$/.test(m.startDateTime))) throw new Error('startDateTime must be one word of text, such as 2024-01-01T00:00:00.');
}

function cellText(e, g, what) {
  const [l, r, c] = e;
  if (!(Number.isInteger(l) && l >= 0 && l < g.nlay && Number.isInteger(r) && r >= 0 && r < g.nrow && Number.isInteger(c) && c >= 0 && c < g.ncol)) {
    throw new Error(`${what}: ${[l, r, c].every(Number.isInteger) ? cellName(l, r, c) : `the cell [${l}, ${r}, ${c}]`} is outside the grid of ${g.nlay} layers, ${g.nrow} rows and ${g.ncol} columns.`);
  }
  return `${l + 1} ${r + 1} ${c + 1}`;
}

function periodKeys(obj, nper, what) {
  return Object.keys(obj).map((k) => {
    const p = Number(k);
    if (!Number.isInteger(p) || p < 0 || p >= nper) throw new Error(`${what}: the list keyed "${k}" is for ${Number.isInteger(p) && p >= 0 ? `period ${p + 1}` : 'no period'}, and the model has periods 1 to ${nper} (keyed 0 to ${nper - 1}).`);
    return p;
  }).sort((a, b) => a - b);
}

/**
 * The MODFLOW 6 input files for a model, as { filename: text }. The files are in metres and
 * days, unless units ({ length, time }, MODFLOW 6 unit names such as model.fileUnits) asks
 * for others: then every value is converted back. A unit still unknown (model.units) is
 * written as MODFLOW 6's UNKNOWN, by leaving LENGTH_UNITS or TIME_UNITS out.
 */
export function toMf6(model, { units } = {}) {
  checkModel(model);
  let m = model, lengthUnit = 'METERS', timeUnit = 'DAYS';
  if (model.units) {
    if (units) throw new Error('The model\'s units are not known yet, so it cannot be converted to other units.');
    lengthUnit = model.units.length ?? lengthUnit;
    timeUnit = model.units.time ?? timeUnit;
  } else if (units) {
    m = toUnits(model, units);
    lengthUnit = units.length ?? lengthUnit;
    timeUnit = units.time ?? timeUnit;
  }
  const g = m.grid, name = m.name, { nlay, nrow, ncol } = g, n2 = nrow * ncol, nper = m.periods.length;
  const files = {};
  const pkgs = [['DIS6', `${name}.dis`], ['NPF6', `${name}.npf`], ['IC6', `${name}.ic`]];

  files['mfsim.nam'] = file('Simulation name file', [
    block('OPTIONS', []),
    block('TIMING', ['  TDIS6 mfsim.tdis']),
    block('MODELS', [`  GWF6 ${name}.nam ${name}`]),
    block('EXCHANGES', []),
    block('SOLUTIONGROUP', ['  IMS6 mfsim.ims ' + name], '1'),
  ]);
  files['mfsim.tdis'] = file('Time discretization', [
    block('OPTIONS', [...(timeUnit === 'UNKNOWN' ? [] : [`  TIME_UNITS ${timeUnit}`]), ...(m.startDateTime ? [`  START_DATE_TIME ${m.startDateTime}`] : [])]),
    block('DIMENSIONS', [`  NPER ${nper}`]),
    block('PERIODDATA', m.periods.map((p, i) => `  ${num(p.length, `period ${i + 1} length`)} ${int(p.nstp, `period ${i + 1} nstp`)} ${num(p.tsmult, `period ${i + 1} tsmult`)}`)),
  ]);
  files['mfsim.ims'] = imsFile(m.solver);

  if (!Array.isArray(g.delr) || g.delr.length !== ncol) throw new Error(`grid.delr needs ${ncol} widths.`);
  if (!Array.isArray(g.delc) || g.delc.length !== nrow) throw new Error(`grid.delc needs ${nrow} widths.`);
  const grid = [
    '  DELR', ...array(g.delr, ncol, 'grid.delr'),
    '  DELC', ...array(g.delc, nrow, 'grid.delc'),
    '  TOP', ...array(g.top, n2, 'grid.top', false, ncol),
    ...layered('BOTM', g.botm, nlay, n2, ncol, 'grid.botm'),
  ];
  if (g.idomain != null) {
    if (!Array.isArray(g.idomain) || g.idomain.length !== nlay * n2) throw new Error(`grid.idomain needs ${nlay * n2} values, or null.`);
    if (g.idomain.some((v) => v !== 0 && v !== 1 && v !== -1)) throw new Error('grid.idomain holds only 1 (active), 0 (inactive) and -1 (vertical pass-through).');
    const layers = [];
    for (let l = 0; l < nlay; l++) layers.push(g.idomain.slice(l * n2, (l + 1) * n2));
    grid.push(...layered('IDOMAIN', layers, nlay, n2, ncol, 'grid.idomain', true));
  }
  files[`${name}.dis`] = file('Structured grid', [
    block('OPTIONS', [...(lengthUnit === 'UNKNOWN' ? [] : [`  LENGTH_UNITS ${lengthUnit}`]), ...georefLines(m.georef)]),
    block('DIMENSIONS', [`  NLAY ${nlay}`, `  NROW ${nrow}`, `  NCOL ${ncol}`]),
    block('GRIDDATA', grid),
  ]);

  const npf = m.npf;
  if (!Array.isArray(npf.icelltype) || npf.icelltype.length !== nlay || npf.icelltype.some((v) => v !== 0 && v !== 1 && v !== -1)) {
    throw new Error(`npf.icelltype needs ${nlay} values, each 0 (confined), 1 (convertible) or, with npf.thickstrt, -1 (confined, with the thickness of the starting head).`);
  }
  // NPF options (gwf-npf.dfn): THICKSTRT, VARIABLECV with DEWATERED, PERCHED.
  const npfOpts = [];
  if (npf.thickstrt) npfOpts.push('  THICKSTRT');
  if (npf.variablecv) npfOpts.push(`  VARIABLECV${npf.dewatered ? ' DEWATERED' : ''}`);
  else if (npf.dewatered) throw new Error('npf.dewatered is an option of VARIABLECV, so it needs npf.variablecv.');
  if (npf.perched) npfOpts.push('  PERCHED');
  // REWET WETFCT IWETIT IHDWET, with its WETDRY array (gwf-npf.dfn).
  if (npf.rewet) npfOpts.push(`  REWET WETFCT ${num(npf.rewet.wetfct, 'npf.rewet.wetfct')} IWETIT ${int(npf.rewet.iwetit, 'npf.rewet.iwetit')} IHDWET ${int(npf.rewet.ihdwet, 'npf.rewet.ihdwet')}`);
  files[`${name}.npf`] = file('Node property flow', [
    block('OPTIONS', npfOpts),
    block('GRIDDATA', [
      ...layered('ICELLTYPE', npf.icelltype, nlay, n2, ncol, 'npf.icelltype', true),
      ...layered('K', npf.k, nlay, n2, ncol, 'npf.k'),
      ...(npf.k22 != null ? layered('K22', npf.k22, nlay, n2, ncol, 'npf.k22') : []),
      ...layered('K33', npf.k33, nlay, n2, ncol, 'npf.k33'),
      ...(npf.rewet && npf.wetdry != null ? layered('WETDRY', npf.wetdry, nlay, n2, ncol, 'npf.wetdry') : []),
    ]),
  ]);
  files[`${name}.ic`] = file('Initial conditions', [block('OPTIONS', []), block('GRIDDATA', layered('STRT', m.ic.strt, nlay, n2, ncol, 'ic.strt'))]);

  if (m.sto) {
    pkgs.push(['STO6', `${name}.sto`]);
    const periods = [];
    m.periods.forEach((p, i) => {
      if (i === 0 || p.steady !== m.periods[i - 1].steady) periods.push(block('PERIOD', [p.steady ? '  STEADY-STATE' : '  TRANSIENT'], String(i + 1)));
    });
    files[`${name}.sto`] = file('Storage', [
      block('OPTIONS', [...(m.sto.storagecoefficient ? ['  STORAGECOEFFICIENT'] : []), ...(m.sto.ssConfinedOnly ? ['  SS_CONFINED_ONLY'] : [])]),
      // Convertible storage exactly where the flow is convertible, as the design says.
      // A THICKSTRT layer (ICELLTYPE -1) is confined in storage too; without THICKSTRT, -1 is
      // convertible, as NPF reads it.
      block('GRIDDATA', [
        ...layered('ICONVERT', npf.icelltype.map((v) => (v < 0 ? (npf.thickstrt ? 0 : 1) : v)), nlay, n2, ncol, 'npf.icelltype', true),
        ...layered('SS', m.sto.ss, nlay, n2, ncol, 'sto.ss'),
        ...layered('SY', m.sto.sy, nlay, n2, ncol, 'sto.sy'),
      ]),
      ...periods,
    ]);
  }

  for (const [key, [ftype, ext, cols]] of Object.entries(LISTS)) {
    if (!m[key]) continue;
    const pers = periodKeys(m[key], nper, key);
    const maxbound = Math.max(1, ...pers.map((p) => m[key][p].length));
    const blocks = pers.map((p) => block('PERIOD', m[key][p].map((e, i) => {
      const what = `${key}, period ${p + 1}, entry ${i + 1}`;
      if (!Array.isArray(e) || e.length !== 3 + cols.length) throw new Error(`${what}: needs [lay, row, col, ${cols.join(', ')}].`);
      return `  ${cellText(e, g, what)} ${e.slice(3).map((x, j) => num(x, `${what} ${cols[j]}`)).join(' ')}`;
    }), String(p + 1)));
    files[`${name}.${ext}`] = file(ftype.slice(0, -1), [block('OPTIONS', []), block('DIMENSIONS', [`  MAXBOUND ${maxbound}`]), ...blocks]);
    pkgs.push([ftype, `${name}.${ext}`]);
  }
  if (m.rch || m.rchList) {
    files[`${name}.rch`] = rchFile(m, nper, n2, ncol, g);
    pkgs.push(['RCH6', `${name}.rch`]);
  }
  if (m.evt || m.evtList) {
    files[`${name}.evt`] = evtFile(m, nper, n2, ncol, g);
    pkgs.push(['EVT6', `${name}.evt`]);
  }
  if (m.obs && m.obs.length) {
    files[`${name}.obs`] = file('Observations', [block('OPTIONS', []), block('CONTINUOUS', m.obs.map((o, i) => {
      if (typeof o.name !== 'string' || !/^[^\s'"#!,]{1,40}$/.test(o.name)) throw new Error(`Observation ${i + 1}: the name must be 1 to 40 characters with no spaces.`);
      return `  ${o.name} HEAD ${cellText([o.lay, o.row, o.col], g, `obs ${o.name}`)}`;
    }), `FILEOUT ${name}.obs.csv`)]);
    pkgs.push(['OBS6', `${name}.obs`]);
  }
  files[`${name}.oc`] = file('Output control', [
    block('OPTIONS', [`  BUDGET FILEOUT ${name}.cbc`, `  HEAD FILEOUT ${name}.hds`]),
    block('PERIOD', ['  SAVE HEAD ALL', '  SAVE BUDGET ALL', '  PRINT BUDGET ALL'], '1'),
  ]);
  pkgs.push(['OC6', `${name}.oc`]);
  // SAVE_FLOWS here saves every package's flows to the budget file.
  // NEWTON, and its UNDER_RELAXATION, for the Newton-Raphson formulation (gwf-nam.dfn).
  const nwt = m.newton ? [`  NEWTON${m.newton.underRelaxation ? ' UNDER_RELAXATION' : ''}`] : [];
  files[`${name}.nam`] = file('Groundwater flow model', [block('OPTIONS', ['  SAVE_FLOWS', ...nwt]), block('PACKAGES', pkgs.map(([t, f]) => `  ${t} ${f}`))]);
  return files;
}

// RCH (mf6io 6.7.0, gwf-rcha.dfn and gwf-rch.dfn): arrays (READASARRAYS), each PERIOD block
// holding IRCH (first, counted from 1, as mf6io asks) and RECHARGE as the period gives them,
// IRCH left out meaning layer 1; or a list of cells and rates.
function rchFile(m, nper, n2, ncol, g) {
  if (m.rch && m.rchList) throw new Error('Recharge is given both as arrays (rch) and as a list (rchList): give one of them.');
  const key = m.rch ? 'rch' : 'rchList';
  const fixed = m.options && m.options[key] && m.options[key].fixedCell ? ['  FIXED_CELL'] : [];
  if (key === 'rchList') {
    if (m.irch) throw new Error('irch is for recharge arrays (rch), not a recharge list.');
    const pers = periodKeys(m.rchList, nper, 'rchList');
    return file('Recharge', [
      block('OPTIONS', fixed),
      block('DIMENSIONS', [`  MAXBOUND ${Math.max(1, ...pers.map((p) => m.rchList[p].length))}`]),
      ...pers.map((p) => block('PERIOD', m.rchList[p].map((e, i) => {
        const what = `rchList, period ${p + 1}, entry ${i + 1}`;
        if (!Array.isArray(e) || e.length !== 4) throw new Error(`${what}: needs [lay, row, col, rate].`);
        return `  ${cellText(e, g, what)} ${num(e[3], what)}`;
      }), String(p + 1))),
    ]);
  }
  const pers = [...new Set([...periodKeys(m.rch, nper, 'rch'), ...periodKeys(m.irch || {}, nper, 'irch')])].sort((a, b) => a - b);
  return file('Recharge as arrays', [
    block('OPTIONS', ['  READASARRAYS', ...fixed]),
    ...pers.map((p) => {
      const lines = [];
      const k = m.irch ? m.irch[p] : undefined;
      if (k !== undefined) lines.push('  IRCH', ...array(typeof k === 'number' ? k + 1 : Array.isArray(k) ? k.map((x) => x + 1) : k, n2, `irch, period ${p + 1}`, true, ncol));
      if (m.rch[p] !== undefined) lines.push('  RECHARGE', ...array(m.rch[p], n2, `rch, period ${p + 1}`, false, ncol));
      return block('PERIOD', lines, String(p + 1));
    }),
  ]);
}

// EVT (mf6io 6.7.0, gwf-evt.dfn and gwf-evta.dfn): arrays (READASARRAYS) with IEVT, SURFACE,
// RATE and DEPTH, each written only in the periods that give it, IEVT first as mf6io asks;
// or a list with NSEG and, per entry, surface, rate, depth, then the pxdp and petm values.
function evtFile(m, nper, n2, ncol, g) {
  if (m.evt && m.evtList) throw new Error('Evapotranspiration is given both as arrays (evt) and as a list (evtList): give one of them.');
  const key = m.evt ? 'evt' : 'evtList';
  const fixed = m.options && m.options[key] && m.options[key].fixedCell ? ['  FIXED_CELL'] : [];
  const pers = periodKeys(m[key], nper, key);
  if (key === 'evt') {
    return file('Evapotranspiration as arrays', [
      block('OPTIONS', ['  READASARRAYS', ...fixed]),
      ...pers.map((p) => {
        const v = m.evt[p], what = `evt, period ${p + 1}`;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: needs surface, rate, depth or ievt.`);
        const lines = [];
        if (v.ievt !== undefined) {
          const lay = typeof v.ievt === 'number' ? v.ievt + 1 : Array.isArray(v.ievt) ? v.ievt.map((k) => k + 1) : v.ievt;
          lines.push('  IEVT', ...array(lay, n2, `${what}, ievt`, true, ncol));
        }
        for (const k of ['surface', 'rate', 'depth']) if (v[k] !== undefined) lines.push(`  ${k.toUpperCase()}`, ...array(v[k], n2, `${what}, ${k}`, false, ncol));
        return block('PERIOD', lines, String(p + 1));
      }),
    ]);
  }
  const nseg = evtSegments(m.evtList), cols = 3 + 2 * (nseg - 1);
  const maxbound = Math.max(1, ...pers.map((p) => m.evtList[p].length));
  return file('Evapotranspiration', [
    block('OPTIONS', fixed),
    block('DIMENSIONS', [`  MAXBOUND ${maxbound}`, `  NSEG ${nseg}`]),
    ...pers.map((p) => block('PERIOD', m.evtList[p].map((e, i) => {
      const what = `evtList, period ${p + 1}, entry ${i + 1}`;
      if (!Array.isArray(e) || e.length !== 3 + cols) throw new Error(`${what}: needs [lay, row, col, surface, rate, depth${nseg > 1 ? ', pxdp…, petm…' : ''}].`);
      return `  ${cellText(e, g, what)} ${e.slice(3).map((x) => num(x, what)).join(' ')}`;
    }), String(p + 1))),
  ]);
}

// --- reading ------------------------------------------------------------------------

function fail(where, msg) {
  throw new Error(`${where.file}, line ${where.line}: ${msg}`);
}

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/;

function toNumber(tok, where, what) {
  if (!NUM.test(tok)) fail(where, `${what}: "${tok}" is not a number${/^[A-Za-z]/.test(tok) ? ' (time series are not supported)' : ''}.`);
  return Number(tok.replace(/[dD]/, 'e'));
}

function toInt(tok, where, what) {
  if (!/^[+-]?\d+$/.test(tok)) fail(where, `${what}: "${tok}" is not a whole number.`);
  return Number(tok);
}

// Lines with comments and blanks removed; tokens split at spaces or commas, with quoted
// file names kept whole (mf6io, "Block and Keyword Input" and "File Name Input").
function readLines(files, name, from) {
  const text = lookup(files, name, from);
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const toks = [];
    for (const t of raw.match(/'[^']*'|"[^"]*"|[^\s,]+/g) || []) {
      if (/^(#|!|\/\/)/.test(t)) break;
      toks.push(t.replace(/^['"]|['"]$/g, ''));
    }
    if (toks.length) out.push({ toks, file: name, line: i + 1 });
  });
  return out;
}

function lookup(files, name, from) {
  const clean = (s) => s.replace(/\\/g, '/').replace(/^\.\//, '');
  const want = clean(name);
  if (Object.hasOwn(files, want)) return files[want];
  const key = Object.keys(files).find((k) => clean(k) === want || clean(k).toLowerCase() === want.toLowerCase());
  if (key !== undefined) return files[key];
  if (from) fail(from, `the file "${name}" is named here but was not supplied.`);
  throw new Error(`${name}: the file was not supplied.`);
}

// Blocks of a file, in order: { name, args, lines, where }. A block whose only entry is
// OPEN/CLOSE takes its lines from that file (mf6io, "OPEN/CLOSE File").
function readBlocks(files, name, from) {
  const lines = readLines(files, name, from);
  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    const w0 = ln.toks[0].toUpperCase();
    if (w0 === 'BEGIN') {
      if (cur) fail(ln, `BEGIN ${ln.toks[1] || ''} inside block ${cur.name}, which has no END.`);
      if (ln.toks.length < 2) fail(ln, 'BEGIN without a block name.');
      cur = { name: ln.toks[1].toUpperCase(), args: ln.toks.slice(2), lines: [], where: ln };
    } else if (w0 === 'END') {
      if (!cur) fail(ln, 'END outside any block.');
      if ((ln.toks[1] || '').toUpperCase() !== cur.name) fail(ln, `END ${ln.toks[1] || ''} does not close block ${cur.name}.`);
      if (cur.lines.length === 1 && cur.lines[0].toks[0].toUpperCase() === 'OPEN/CLOSE') {
        const oc = cur.lines[0];
        if (oc.toks.some((t) => t.toUpperCase() === '(BINARY)')) fail(oc, 'binary input is not supported.');
        if (!oc.toks[1]) fail(oc, 'OPEN/CLOSE without a file name.');
        cur.lines = readLines(files, oc.toks[1], oc);
      }
      blocks.push(cur);
      cur = null;
    } else {
      if (!cur) fail(ln, `"${ln.toks[0]}" is outside any block.`);
      cur.lines.push(ln);
    }
  }
  if (cur) fail(cur.where, `block ${cur.name} has no END.`);
  return blocks;
}

function only(blocks, name, where, required = false) {
  const found = blocks.filter((b) => b.name === name);
  if (found.length > 1) fail(found[1].where, `a second ${name} block.`);
  if (!found.length && required) fail(where, `there is no ${name} block.`);
  return found[0] || null;
}

function checkBlocks(blocks, allowed) {
  for (const b of blocks) if (!allowed.includes(b.name)) fail(b.where, `block ${b.name} is not supported in this file, which is read for its ${listed(allowed)} blocks.`);
}

// Options: each line's first word must be known; known ones return their tokens.
function options(b, accept, ignore = []) {
  const out = {};
  for (const ln of b ? b.lines : []) {
    const k = ln.toks[0].toUpperCase();
    if (accept.includes(k)) out[k] = { toks: ln.toks.slice(1), where: ln };
    else if (!ignore.includes(k)) fail(ln, FEATURES[k] ? `${FEATURES[k]}.` : `option ${k} is not supported.`);
  }
  return out;
}

// READARRAY (mf6io, "Array Input"): reads one control line and its values from the
// lines at state.i, returning a number for CONSTANT and an array otherwise. With rowLen,
// it reads as MODFLOW 6 6.7.0 reads a layer of a structured grid: one Fortran read per
// row, so each row starts on a new line (Double2dReader.f90, read_ascii). Values left
// on a row's last line would be skipped by MODFLOW 6, so they are refused here.
function readArray(files, state, n, what, isInt, rowLen = 0) {
  const ln = state.lines[state.i++];
  if (!ln) fail(state.end, `${what}: the array is missing.`);
  const t = ln.toks.map((x) => x.toUpperCase());
  const parse = (tok, where) => (isInt ? toInt(tok, where, what) : toNumber(tok, where, what));
  let factor = 1;
  const fi = t.indexOf('FACTOR');
  if (fi > 0) {
    factor = parse(ln.toks[fi + 1] ?? '', ln);
    if (factor === 0) factor = 1; // "If factor is specified as 0, then it is changed to 1."
  }
  if (t.includes('(BINARY)')) fail(ln, `${what}: binary arrays are not supported.`);
  const values = [];
  // One list-directed read of count values starting at line k; returns the next line.
  const read = (lines, k, count) => {
    const stop = values.length + count;
    while (values.length < stop && k < lines.length) {
      const l = lines[k++];
      for (const tok of l.toks) {
        if (values.length >= stop) {
          fail(l, rowLen ? `${what}: row ${Math.ceil(values.length / rowLen)} has more than ${rowLen} values on this line (MODFLOW 6 reads each row from a new line and would skip the rest).`
            : `${what}: more values than the ${n} expected.`);
        }
        // Fortran's repeat count, r*value, as list-directed input allows.
        const rep = /^(\d+)\*(.+)$/.exec(tok);
        if (rep) for (let j = 0; j < Number(rep[1]); j++) values.push(parse(rep[2], l));
        else values.push(parse(tok, l));
      }
      if (values.length > stop) fail(l, `${what}: a repeat count runs past the end of ${rowLen ? 'the row' : 'the array'}.`);
    }
    return k;
  };
  const take = (lines, from) => {
    if (!rowLen) return read(lines, from, n);
    let k = from;
    while (values.length < n && k < lines.length) k = read(lines, k, rowLen);
    return k;
  };
  if (t[0] === 'CONSTANT') {
    if (ln.toks.length < 2) fail(ln, `${what}: CONSTANT without a value.`);
    return parse(ln.toks[1], ln);
  }
  if (t[0] === 'INTERNAL') {
    state.i = take(state.lines, state.i);
    if (values.length < n) fail(state.lines[state.i - 1] || ln, `${what}: ${values.length} values where ${n} are needed.`);
  } else if (t[0] === 'OPEN/CLOSE') {
    if (!ln.toks[1]) fail(ln, `${what}: OPEN/CLOSE without a file name.`);
    const lines = readLines(files, ln.toks[1], ln);
    const k = take(lines, 0);
    if (values.length < n) fail({ file: ln.toks[1], line: lines.length ? lines[lines.length - 1].line : 1 }, `${what}: ${values.length} values where ${n} are needed.`);
    if (k < lines.length) fail(lines[k], `${what}: more values than the ${n} expected.`);
  } else {
    fail(ln, `${what}: expected CONSTANT, INTERNAL or OPEN/CLOSE, not "${ln.toks[0]}".`);
  }
  return factor === 1 ? values : values.map((v) => v * factor);
}

// A GRIDDATA-style block: { NAME: value } for the names in spec, and at.NAME, the line
// that named it. kind 'grid' arrays come back per layer, LAYERED or not.
function readGridBlock(files, b, spec, dims) {
  const out = { at: {} };
  const state = { lines: b.lines, i: 0, end: b.where };
  while (state.i < b.lines.length) {
    const ln = b.lines[state.i++];
    const key = ln.toks[0].toUpperCase();
    const s = spec[key];
    if (!s) fail(ln, FEATURES[key] ? `${FEATURES[key]}.` : `${key} is not supported here.`);
    if (out.at[key]) fail(ln, `${key} is given twice.`);
    out.at[key] = ln;
    const what = `${key}`;
    const isLayered = (ln.toks[1] || '').toUpperCase() === 'LAYERED';
    if (s.kind === 'grid') {
      const n2 = dims.nrow * dims.ncol;
      if (isLayered) {
        out[key] = Array.from({ length: dims.nlay }, (_, l) => readArray(files, state, n2, `${what}, layer ${l + 1}`, s.int, dims.ncol));
      } else {
        const v = readArray(files, state, dims.nlay * n2, what, s.int);
        out[key] = Array.from({ length: dims.nlay }, (_, l) => (typeof v === 'number' ? v : v.slice(l * n2, (l + 1) * n2)));
      }
    } else {
      if (isLayered) fail(ln, `${key} cannot be LAYERED.`);
      out[key] = readArray(files, state, s.n, what, s.int, s.rows ? dims.ncol : 0);
    }
  }
  return out;
}

const expand = (v, n) => (typeof v === 'number' ? new Array(n).fill(v) : v);

// One value per layer, as icelltype and iconvert are in the JSON model.
// read maps each value as MODFLOW 6 reads it, before the check.
function perLayerInt(layers, n2, what, allowed, where, read = (x) => x) {
  return layers.map((v, l) => {
    const a = expand(v, n2).map(read);
    if (a.some((x) => x !== a[0])) fail(where, `${what}, layer ${l + 1}: the value must be the same over the layer (a layer partly confined and partly convertible is not supported).`);
    if (!allowed.includes(a[0])) fail(where, `${what}, layer ${l + 1}: ${a[0]} is not supported (only ${allowed.join(' or ')}).`);
    return a[0];
  });
}

const PRINT = ['PRINT_INPUT', 'PRINT_FLOWS', 'SAVE_FLOWS'];

// A stress list file. spec, for packages not in LISTS (EVT, RCH): { ftype, options, dims,
// cols(d) }, the options and DIMENSIONS entries it also takes and the names of the values
// after the cell, from the DIMENSIONS read; spec.found then holds those options and dimensions.
function readList(files, fname, from, key, dims, nper, notes, spec = null) {
  const ftype = spec ? spec.ftype : LISTS[key][0];
  const blocks = readBlocks(files, fname, from);
  checkBlocks(blocks, ['OPTIONS', 'DIMENSIONS', 'PERIOD']);
  const opts = options(only(blocks, 'OPTIONS'), ['BOUNDNAMES', ...(spec ? spec.options : [])], PRINT);
  const dim = only(blocks, 'DIMENSIONS', { file: fname, line: 1 }, true);
  const d = options(dim, ['MAXBOUND', ...(spec ? spec.dims : [])]);
  if (!d.MAXBOUND) fail(dim.where, 'DIMENSIONS has no MAXBOUND.');
  const maxbound = toInt(d.MAXBOUND.toks[0] ?? '', d.MAXBOUND.where, 'MAXBOUND');
  const cols = spec ? spec.cols(d, dim) : LISTS[key][2];
  if (spec) spec.found = { opts, d };
  const out = {};
  let last = 0, named = null;
  for (const b of blocks.filter((x) => x.name === 'PERIOD')) {
    const p = toInt(b.args[0] ?? '', b.where, 'PERIOD number');
    if (p < 1 || p > nper) fail(b.where, `PERIOD ${p} is not one of 1 to ${nper}.`);
    if (p <= last) fail(b.where, `PERIOD ${p} comes after period ${last}.`);
    last = p;
    if (b.lines.length > maxbound) fail(b.lines[maxbound], `${ftype}: more than MAXBOUND (${maxbound}) entries.`);
    out[String(p - 1)] = b.lines.map((ln) => {
      const want = 3 + cols.length + (opts.BOUNDNAMES ? 1 : 0);
      if (ln.toks.length < 3 + cols.length) fail(ln, `${ftype}: expected layer, row, column, ${cols.join(', ')}.`);
      if (ln.toks.length > want) fail(ln, `${ftype}: more values than layer, row, column, ${cols.join(', ')}${opts.BOUNDNAMES ? ' and a boundary name' : ''} (auxiliary variables are not supported).`);
      if (opts.BOUNDNAMES && ln.toks.length === want && named === null) named = ln.toks[want - 1];
      return [...cellFrom(ln, ln.toks, dims, ftype), ...cols.map((c, j) => toNumber(ln.toks[3 + j], ln, `${ftype} ${c}`))];
    });
  }
  if (opts.BOUNDNAMES) {
    notes.push(`${fname} gives its entries boundary names (BOUNDNAMES)${named !== null ? `, such as ${named}` : ''}. The names are not kept: the entries are read by their cells, and the files this page exports have no names. Heads and budgets do not depend on them.`);
  }
  return out;
}

function cellFrom(ln, toks, dims, what) {
  const cell = toks.slice(0, 3).map((t, j) => toInt(t, ln, `${what} ${['layer', 'row', 'column'][j]}`) - 1);
  const lim = [dims.nlay, dims.nrow, dims.ncol];
  cell.forEach((v, j) => {
    if (v < 0 || v >= lim[j]) fail(ln, `${what}: ${['layer', 'row', 'column'][j]} ${v + 1} is outside 1 to ${lim[j]}.`);
  });
  return cell;
}

/**
 * Reads a set of MODFLOW 6 input files, { filename: text } with mfsim.nam among them,
 * back into the JSON model. Throws an error naming the file and line of anything it
 * cannot represent or read.
 */
export function fromMf6(files) {
  if (!files || typeof files !== 'object') throw new Error('fromMf6 needs the files as { filename: text }.');
  const start = { file: 'mfsim.nam', line: 1 };
  const notes = [];
  const sim = readBlocks(files, 'mfsim.nam');
  checkBlocks(sim, ['OPTIONS', 'TIMING', 'MODELS', 'EXCHANGES', 'SOLUTIONGROUP']);
  options(only(sim, 'OPTIONS'), [], ['CONTINUE', 'NOCHECK', 'MEMORY_PRINT_OPTION', 'PROFILE_OPTION', 'MAXERRORS', 'PRINT_INPUT']);
  const timing = options(only(sim, 'TIMING', start, true), ['TDIS6']);
  if (!timing.TDIS6) fail(only(sim, 'TIMING').where, 'TIMING names no TDIS6 file.');
  const models = only(sim, 'MODELS', start, true);
  for (const ln of models.lines) {
    const t = ln.toks[0].toUpperCase();
    if (t !== 'GWF6') fail(ln, `model type ${ln.toks[0]}${MODEL_TYPES[t] ? ` (${MODEL_TYPES[t]})` : ''} is not supported: only one groundwater flow model (GWF6) is read.`);
  }
  if (models.lines.length !== 1) fail(models.lines[1] ?? models.where, `${models.lines.length ? models.lines.length : 'no'} groundwater flow models: exactly one GWF6 model is read, not several joined by exchanges.`);
  const [, mfile, mname] = models.lines[0].toks;
  if (!mfile || !mname) fail(models.lines[0], 'expected GWF6, the name file and the model name.');
  const ex = only(sim, 'EXCHANGES');
  if (ex && ex.lines.length) fail(ex.lines[0], 'exchanges between models are not supported.');
  const groups = sim.filter((b) => b.name === 'SOLUTIONGROUP');
  if (groups.length !== 1) fail(groups[1]?.where ?? start, 'exactly one SOLUTIONGROUP is needed.');
  const slns = groups[0].lines.filter((l) => l.toks[0].toUpperCase() !== 'MXITER');
  if (slns.length !== 1 || slns[0].toks[0].toUpperCase() !== 'IMS6') fail(slns[0] ?? groups[0].where, `the solution group must hold one iterative model solution (IMS6)${slns[0] && slns[0].toks[0].toUpperCase() === 'EMS6' ? ', not an explicit one (EMS6)' : ''}.`);

  // TDIS
  const tdisName = timing.TDIS6.toks[0];
  const tdis = readBlocks(files, tdisName, timing.TDIS6.where);
  checkBlocks(tdis, ['OPTIONS', 'DIMENSIONS', 'PERIODDATA']);
  const topt = options(only(tdis, 'OPTIONS'), ['TIME_UNITS', 'START_DATE_TIME']);
  const tw = { file: tdisName, line: 1 };
  // TIME_UNITS: UNKNOWN when left out (sim-tdis.dfn).
  const timeUnit = topt.TIME_UNITS ? (topt.TIME_UNITS.toks[0] || '').toUpperCase() : 'UNKNOWN';
  if (timeUnit === 'YEARS') fail(topt.TIME_UNITS.where, 'TIME_UNITS YEARS cannot be converted to days exactly, since a year has no one length in days (365, or 365.25 on average); convert the model to days first.');
  if (timeUnit !== 'UNKNOWN' && !(timeUnit in PER_DAY)) fail(topt.TIME_UNITS.where, `TIME_UNITS ${topt.TIME_UNITS.toks[0] || ''} is not one of SECONDS, MINUTES, HOURS, DAYS or YEARS.`);
  const tdim = options(only(tdis, 'DIMENSIONS', tw, true), ['NPER']);
  const nper = toInt(tdim.NPER?.toks[0] ?? '', tdim.NPER?.where ?? tw, 'NPER');
  const pd = only(tdis, 'PERIODDATA', tw, true);
  if (pd.lines.length !== nper) fail(pd.where, `PERIODDATA has ${pd.lines.length} periods where NPER is ${nper}.`);
  const periods = pd.lines.map((ln) => ({
    length: toNumber(ln.toks[0] ?? '', ln, 'PERLEN'), nstp: toInt(ln.toks[1] ?? '', ln, 'NSTP'), tsmult: toNumber(ln.toks[2] ?? '', ln, 'TSMULT'), steady: true,
  }));

  // IMS. A value the file leaves out takes the one MODFLOW 6 gives it for the file's
  // COMPLEXITY, or for SIMPLE when there is none (readIms), and MODFLOW 6 runs such a file.
  const solver = readIms(files, slns[0], notes);

  // GWF name file
  const nam = readBlocks(files, mfile, models.lines[0]);
  checkBlocks(nam, ['OPTIONS', 'PACKAGES']);
  const nopt = options(only(nam, 'OPTIONS'), ['NEWTON'], ['LIST', ...PRINT]);
  // NEWTON [UNDER_RELAXATION] (gwf-nam.dfn): the Newton-Raphson formulation.
  let newton = null;
  if (nopt.NEWTON) {
    const extra = nopt.NEWTON.toks.map((t) => t.toUpperCase());
    if (extra.some((t) => t !== 'UNDER_RELAXATION')) fail(nopt.NEWTON.where, `NEWTON ${nopt.NEWTON.toks.join(' ')}: only UNDER_RELAXATION may follow NEWTON.`);
    newton = extra.length ? { underRelaxation: true } : true;
  }
  const pk = {};
  for (const ln of only(nam, 'PACKAGES', { file: mfile, line: 1 }, true).lines) {
    const t = ln.toks[0].toUpperCase();
    const known = ['DIS6', 'NPF6', 'IC6', 'STO6', 'CHD6', 'WEL6', 'RCH6', 'EVT6', 'RIV6', 'DRN6', 'GHB6', 'OBS6', 'OC6'];
    if (!known.includes(t)) fail(ln, `package ${t}${PACKAGE_TYPES[t] ? ` (${PACKAGE_TYPES[t]})` : ''} is not supported: this page reads ${known.join(', ')}.`);
    if (pk[t]) fail(ln, `a second ${t} package is not supported.`);
    if (!ln.toks[1]) fail(ln, `${t} without a file name.`);
    pk[t] = ln;
  }
  for (const t of ['DIS6', 'NPF6', 'IC6']) if (!pk[t]) fail({ file: mfile, line: 1 }, `there is no ${t} package.`);
  const at = (t) => ({ file: pk[t].toks[1], line: 1 });

  // DIS
  const dis = readBlocks(files, pk.DIS6.toks[1], pk.DIS6);
  checkBlocks(dis, ['OPTIONS', 'DIMENSIONS', 'GRIDDATA']);
  const dopt = options(only(dis, 'OPTIONS'), ['LENGTH_UNITS', 'XORIGIN', 'YORIGIN', 'ANGROT', 'CRS'], ['NOGRB', 'EXPORT_ARRAY_ASCII']);
  // The grid's place on a map: kept and written back, though nothing here uses it.
  const georef = {};
  for (const k of ['XORIGIN', 'YORIGIN', 'ANGROT']) if (dopt[k]) georef[k.toLowerCase()] = toNumber(dopt[k].toks[0] ?? '', dopt[k].where, k);
  if (dopt.CRS) {
    if (!dopt.CRS.toks.length) fail(dopt.CRS.where, 'CRS without a value.');
    georef.crs = dopt.CRS.toks.join(' ');
  }
  // LENGTH_UNITS: UNKNOWN when left out (gwf-dis.dfn), which is what FloPy writes unless
  // told otherwise.
  const lengthUnit = dopt.LENGTH_UNITS ? (dopt.LENGTH_UNITS.toks[0] || '').toUpperCase() : 'UNKNOWN';
  if (lengthUnit !== 'UNKNOWN' && !(lengthUnit in METRES_PER)) fail(dopt.LENGTH_UNITS.where, `LENGTH_UNITS ${dopt.LENGTH_UNITS.toks[0] || ''} is not one of FEET, METERS or CENTIMETERS.`);
  const dd = options(only(dis, 'DIMENSIONS', at('DIS6'), true), ['NLAY', 'NROW', 'NCOL']);
  const dims = {};
  for (const k of ['NLAY', 'NROW', 'NCOL']) {
    if (!dd[k]) fail(only(dis, 'DIMENSIONS').where, `DIMENSIONS has no ${k}.`);
    dims[k.toLowerCase()] = toInt(dd[k].toks[0] ?? '', dd[k].where, k);
    if (dims[k.toLowerCase()] < 1) fail(dd[k].where, `${k} must be at least 1.`);
  }
  const { nlay, nrow, ncol } = dims, n2 = nrow * ncol;
  const gd = readGridBlock(files, only(dis, 'GRIDDATA', at('DIS6'), true), {
    DELR: { n: ncol }, DELC: { n: nrow }, TOP: { n: n2, rows: true }, BOTM: { kind: 'grid' }, IDOMAIN: { kind: 'grid', int: true },
  }, dims);
  for (const k of ['DELR', 'DELC', 'TOP', 'BOTM']) if (gd[k] === undefined) fail(only(dis, 'GRIDDATA').where, `GRIDDATA has no ${k}.`);
  let idomain = null;
  if (gd.IDOMAIN !== undefined) {
    idomain = gd.IDOMAIN.flatMap((v) => expand(v, n2));
    // "If the IDOMAIN value for a cell is 1 or greater, the cell exists" (gwf-dis.dfn), and one
    // below 0 is a vertical pass-through cell: MODFLOW 6 gives every such cell the reduced
    // node -1 (Dis.f90 grid_finalize), so -2 is read as -1.
    if (idomain.some((v) => v > 1 || v < -1)) {
      notes.push(`${pk.DIS6.toks[1]}: IDOMAIN values ${idomain.some((v) => v > 1) ? 'above 1 were read as 1, an active cell' : ''}${idomain.some((v) => v > 1) && idomain.some((v) => v < -1) ? ', and ' : ''}${idomain.some((v) => v < -1) ? 'below −1 as −1, a vertical pass-through cell' : ''}, as MODFLOW 6 reads them.`);
      idomain = idomain.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    }
  }
  const grid = {
    nlay, nrow, ncol, delr: expand(gd.DELR, ncol), delc: expand(gd.DELC, nrow), top: gd.TOP, botm: [...gd.BOTM], idomain,
  };

  // NPF
  const npfB = readBlocks(files, pk.NPF6.toks[1], pk.NPF6);
  checkBlocks(npfB, ['OPTIONS', 'GRIDDATA']);
  const no = options(only(npfB, 'OPTIONS'), ['THICKSTRT', 'VARIABLECV', 'PERCHED', 'REWET'], ['SAVE_FLOWS', 'PRINT_FLOWS', 'SAVE_SPECIFIC_DISCHARGE', 'SAVE_SATURATION', 'EXPORT_ARRAY_ASCII']);
  if (no.VARIABLECV && no.VARIABLECV.toks.length && (no.VARIABLECV.toks.length > 1 || no.VARIABLECV.toks[0].toUpperCase() !== 'DEWATERED')) fail(no.VARIABLECV.where, `VARIABLECV takes only DEWATERED after it, not "${no.VARIABLECV.toks.join(' ')}".`);
  const np = readGridBlock(files, only(npfB, 'GRIDDATA', at('NPF6'), true), {
    ICELLTYPE: { kind: 'grid', int: true }, K: { kind: 'grid' }, K22: { kind: 'grid' }, K33: { kind: 'grid' }, WETDRY: { kind: 'grid' },
  }, dims);
  for (const k of ['ICELLTYPE', 'K', 'K33']) if (np[k] === undefined) fail(only(npfB, 'GRIDDATA').where, `GRIDDATA has no ${k}${k === 'K33' ? ' (vertical K is needed, and none is assumed)' : ''}.`);
  // ICELLTYPE above 0 is convertible, and so is one below 0 without THICKSTRT (gwf-npf.dfn),
  // so then every value other than 0 is read as 1; with THICKSTRT, one below 0 is -1.
  const cellType = (x) => (x > 0 ? 1 : x < 0 ? (no.THICKSTRT ? -1 : 1) : 0);
  const npf = { icelltype: perLayerInt(np.ICELLTYPE, n2, 'ICELLTYPE', [0, 1, -1], np.at.ICELLTYPE, cellType), k: [...np.K] };
  // K22, the conductivity along the columns (y) with no rotation, is kept when given.
  if (np.K22 !== undefined) npf.k22 = [...np.K22];
  npf.k33 = [...np.K33];
  if (no.THICKSTRT) npf.thickstrt = true;
  if (no.VARIABLECV) npf.variablecv = true;
  if (no.VARIABLECV && no.VARIABLECV.toks.length) npf.dewatered = true;
  if (no.PERCHED) npf.perched = true;
  // REWET WETFCT x IWETIT n IHDWET n: each keyword with its value (gwf-npf.dfn rewet_record).
  if (no.REWET) {
    const t = no.REWET.toks, rw = {};
    for (let i = 0; i < t.length; i += 2) {
      const key = (t[i] || '').toUpperCase();
      if (!['WETFCT', 'IWETIT', 'IHDWET'].includes(key) || t[i + 1] === undefined) fail(no.REWET.where, `REWET takes WETFCT, IWETIT and IHDWET, each with its value, not "${t.join(' ')}".`);
      rw[key.toLowerCase()] = key === 'WETFCT' ? toNumber(t[i + 1], no.REWET.where, key) : toInt(t[i + 1], no.REWET.where, key);
    }
    for (const k of ['wetfct', 'iwetit', 'ihdwet']) if (rw[k] === undefined) fail(no.REWET.where, `REWET needs ${k.toUpperCase()} with its value.`);
    if (np.WETDRY === undefined) fail(only(npfB, 'GRIDDATA').where, 'REWET needs the WETDRY array, as MODFLOW 6 requires.');
    npf.rewet = rw;
    npf.wetdry = [...np.WETDRY];
  } else if (np.WETDRY !== undefined) {
    notes.push(`${pk.NPF6.toks[1]} gives WETDRY but not REWET; MODFLOW 6 reads WETDRY then and does not use it, so it was left out.`);
  }

  // IC
  const icB = readBlocks(files, pk.IC6.toks[1], pk.IC6);
  checkBlocks(icB, ['OPTIONS', 'GRIDDATA']);
  options(only(icB, 'OPTIONS'), [], ['EXPORT_ARRAY_ASCII']);
  const ic = readGridBlock(files, only(icB, 'GRIDDATA', at('IC6'), true), { STRT: { kind: 'grid' } }, dims);
  if (ic.STRT === undefined) fail(only(icB, 'GRIDDATA').where, 'GRIDDATA has no STRT.');

  const model = { name: mname, grid, npf };

  // STO
  if (pk.STO6) {
    const stoB = readBlocks(files, pk.STO6.toks[1], pk.STO6);
    checkBlocks(stoB, ['OPTIONS', 'GRIDDATA', 'PERIOD']);
    const so = options(only(stoB, 'OPTIONS'), ['STORAGECOEFFICIENT', 'SS_CONFINED_ONLY'], ['SAVE_FLOWS', 'EXPORT_ARRAY_ASCII']);
    const st = readGridBlock(files, only(stoB, 'GRIDDATA', at('STO6'), true), {
      ICONVERT: { kind: 'grid', int: true }, SS: { kind: 'grid' }, SY: { kind: 'grid' },
    }, dims);
    for (const k of ['ICONVERT', 'SS', 'SY']) if (st[k] === undefined) fail(only(stoB, 'GRIDDATA').where, `GRIDDATA has no ${k}, and none is assumed.`);
    // ICONVERT above 0 is convertible (gwf-sto.dfn).
    const iconvert = perLayerInt(st.ICONVERT, n2, 'ICONVERT', [0, 1], st.at.ICONVERT, (x) => (x > 0 ? 1 : x));
    iconvert.forEach((v, l) => {
      // A THICKSTRT layer (ICELLTYPE -1) is confined, in storage as in flow.
      const want = npf.icelltype[l] < 0 ? 0 : npf.icelltype[l];
      if (v !== want) fail(st.at.ICONVERT, `ICONVERT, layer ${l + 1}: ${v} differs from NPF ICELLTYPE ${npf.icelltype[l]}${npf.icelltype[l] < 0 ? ' (THICKSTRT, a confined layer)' : ''}; the model has one cell type per layer, for flow and storage alike.`);
    });
    model.sto = { ss: [...st.SS], sy: [...st.SY] };
    if (so.STORAGECOEFFICIENT) model.sto.storagecoefficient = true;
    if (so.SS_CONFINED_ONLY) model.sto.ssConfinedOnly = true;
    const pblocks = stoB.filter((b) => b.name === 'PERIOD');
    let state = null, last = 0;
    if (!pblocks.length) {
      // MODFLOW 6 6.7.0 then runs every period as transient: STO sets ISS to 0 when it
      // allocates its arrays, and only a PERIOD block changes it (gwf-sto.f90,
      // sto_allocate_arrays and sto_rp). mf6io does not say so; MODFLOW 6 runs confirm it
      // (tests/fixtures/modflow-import/x06-sto-noperiod and x08-sto-later).
      notes.push(`${pk.STO6.toks[1]} has no PERIOD block, so MODFLOW 6 runs every period as transient, and so does this page.`);
      state = false;
    }
    const set = {};
    for (const b of pblocks) {
      const p = toInt(b.args[0] ?? '', b.where, 'PERIOD number');
      if (p < 1 || p > nper) fail(b.where, `PERIOD ${p} is not one of 1 to ${nper}.`);
      if (p <= last) fail(b.where, `PERIOD ${p} comes after period ${last}.`);
      last = p;
      if (b.lines.length !== 1) fail(b.lines[1] ?? b.where, 'expected STEADY-STATE or TRANSIENT.');
      const w = b.lines[0].toks[0].toUpperCase();
      if (w !== 'STEADY-STATE' && w !== 'TRANSIENT') fail(b.lines[0], `expected STEADY-STATE or TRANSIENT, not ${w}.`);
      set[p - 1] = w === 'STEADY-STATE';
    }
    if (pblocks.length && !(0 in set)) {
      // As with no PERIOD block: transient until the first block says otherwise.
      notes.push(`${pk.STO6.toks[1]} has no PERIOD block for period 1, so MODFLOW 6 runs the periods before its first PERIOD block as transient, and so does this page.`);
      state = false;
    }
    // Each setting stands until a later PERIOD block changes it (mf6io, STO PERIOD).
    periods.forEach((p, i) => {
      if (i in set) state = set[i];
      p.steady = state;
    });
  }
  model.ic = { strt: [...ic.STRT] };
  model.periods = periods;

  for (const key of ['chd', 'wel', 'rch', 'riv', 'drn', 'ghb']) {
    if (key === 'rch') {
      if (pk.RCH6) readRch(files, pk.RCH6, model, dims, nper, notes);
      continue;
    }
    const t = LISTS[key][0];
    if (pk[t]) model[key] = readList(files, pk[t].toks[1], pk[t], key, dims, nper, notes);
  }

  if (pk.EVT6) readEvt(files, pk.EVT6, model, dims, nper, notes);

  model.obs = [];
  if (pk.OBS6) {
    const fname = pk.OBS6.toks[1];
    const ob = readBlocks(files, fname, pk.OBS6);
    checkBlocks(ob, ['OPTIONS', 'CONTINUOUS']);
    options(only(ob, 'OPTIONS'), [], ['DIGITS', 'PRINT_INPUT']);
    for (const b of ob.filter((x) => x.name === 'CONTINUOUS')) {
      for (const ln of b.lines) {
        if (ln.toks.length !== 5) fail(ln, 'expected an observation name, HEAD, layer, row and column.');
        if (ln.toks[1].toUpperCase() !== 'HEAD') fail(ln, `observation type ${ln.toks[1]} is not supported (only HEAD).`);
        const [lay, row, col] = cellFrom(ln, ln.toks.slice(2), dims, 'observation');
        model.obs.push({ name: ln.toks[0], lay, row, col });
      }
    }
  }
  if (pk.OC6) {
    // Output control decides what is saved, not the flow, so its content is not kept.
    checkBlocks(readBlocks(files, pk.OC6.toks[1], pk.OC6), ['OPTIONS', 'PERIOD']);
  }
  model.solver = solver;
  if (newton) model.newton = newton;
  if (Object.keys(georef).length) {
    model.georef = georef;
    const said = [];
    if ('xorigin' in georef || 'yorigin' in georef) {
      said.push(`${listed([['xorigin', 'XORIGIN'], ['yorigin', 'YORIGIN']].filter(([k]) => k in georef).map(([k, K]) => `${K} ${georef[k]}`))}, the lower-left corner of the grid in the file's length unit`);
    }
    if ('angrot' in georef) said.push(`ANGROT ${georef.angrot}, the grid's rotation in degrees counter-clockwise about that corner`);
    if ('crs' in georef) said.push(`CRS ${georef.crs}, its coordinate reference system`);
    notes.push(`${pk.DIS6.toks[1]} places the grid on a map: ${said.join('; ')}. `
      + 'This changes no head. It is kept with the model and written back to the MODFLOW 6 files the page exports; the page\'s own map and cell positions are measured from the grid\'s corner, unrotated.');
  }
  if (topt.START_DATE_TIME) {
    if (!topt.START_DATE_TIME.toks[0]) fail(topt.START_DATE_TIME.where, 'START_DATE_TIME without a value.');
    model.startDateTime = topt.START_DATE_TIME.toks[0];
    notes.push(`${tdisName} gives START_DATE_TIME ${model.startDateTime}. It changes no head. It is kept with the model and written back to the MODFLOW 6 files the page exports; the page counts time in days from the start of the run.`);
  }

  // Units: anything known is converted to metres and days; anything not given is kept as
  // it is and marked, so the page asks for it rather than assuming metres or days.
  const convert = {};
  if (lengthUnit !== 'METERS' && lengthUnit !== 'UNKNOWN') convert.length = lengthUnit;
  if (timeUnit !== 'DAYS' && timeUnit !== 'UNKNOWN') convert.time = timeUnit;
  let out = model;
  if (lengthUnit === 'UNKNOWN' || timeUnit === 'UNKNOWN') {
    out.units = {};
    if (lengthUnit === 'UNKNOWN') {
      out.units.length = 'UNKNOWN';
      notes.push(`${pk.DIS6.toks[1]} gives no LENGTH_UNITS (FloPy leaves it out unless told), so the model's length unit is not known. Say whether it is in metres, feet or centimetres; it is not run until then.`);
    }
    if (timeUnit === 'UNKNOWN') {
      out.units.time = 'UNKNOWN';
      notes.push(`${tdisName} gives no TIME_UNITS, so the model's time unit is not known. Say whether it is in days, hours, minutes or seconds; it is not run until then.`);
    }
  }
  if (notes.length) out.notes = notes;
  if (Object.keys(convert).length) out = convertUnits(out, convert);
  // What it built holds only the keys run() knows (keys.js), as run() will check.
  checkKeys(out);
  return out;
}

// RCH6 (gwf-rcha.dfn, gwf-rch.dfn) into model.rch and model.irch (arrays) or model.rchList.
function readRch(files, ln, model, dims, nper, notes) {
  const fname = ln.toks[1], n2 = dims.nrow * dims.ncol;
  const blocks = readBlocks(files, fname, ln);
  const ob = only(blocks, 'OPTIONS');
  if (!(ob && ob.lines.some((l) => l.toks[0].toUpperCase() === 'READASARRAYS'))) {
    const spec = { ftype: 'RCH6', options: ['FIXED_CELL'], dims: [], cols: () => ['recharge'] };
    model.rchList = readList(files, fname, ln, 'rchList', dims, nper, notes, spec);
    if (spec.found.opts.FIXED_CELL) model.options = { ...(model.options || {}), rchList: { fixedCell: true } };
    return;
  }
  checkBlocks(blocks, ['OPTIONS', 'PERIOD']);
  const o = options(ob, ['READASARRAYS', 'FIXED_CELL'], PRINT);
  model.rch = {};
  let last = 0, first = true;
  for (const b of blocks.filter((x) => x.name === 'PERIOD')) {
    const p = toInt(b.args[0] ?? '', b.where, 'PERIOD number');
    if (p < 1 || p > nper) fail(b.where, `PERIOD ${p} is not one of 1 to ${nper}.`);
    if (p <= last) fail(b.where, `PERIOD ${p} comes after period ${last}.`);
    last = p;
    const g2 = readGridBlock(files, b, { IRCH: { n: n2, int: true }, RECHARGE: { n: n2 } }, dims);
    if (g2.IRCH !== undefined && b.lines[0] !== g2.at.IRCH) fail(g2.at.IRCH, 'IRCH must come first in the PERIOD block, as MODFLOW 6 requires.');
    // An RCHA block with no RECHARGE gave no recharge in MODFLOW 6 6.7.0, not the 0.001 that
    // gwf-rcha.dfn gives as its default (FloPy's own, which it writes into the file).
    if (first && g2.RECHARGE === undefined) fail(b.where, 'the first PERIOD block has no RECHARGE array: give it. MODFLOW 6 6.7.0 takes an array left out as zero, not as the default gwf-rcha.dfn documents, so none is assumed here.');
    first = false;
    if (g2.IRCH !== undefined) {
      const k = typeof g2.IRCH === 'number' ? g2.IRCH - 1 : g2.IRCH.map((x) => x - 1);
      const bad = expand(k, n2).findIndex((x) => x < 0 || x >= dims.nlay);
      if (bad >= 0) fail(g2.at.IRCH, `IRCH ${expand(k, n2)[bad] + 1} at row ${Math.floor(bad / dims.ncol) + 1}, column ${(bad % dims.ncol) + 1} is not a layer of the model (1 to ${dims.nlay}).`);
      model.irch = { ...(model.irch || {}), [String(p - 1)]: k };
    }
    // A later block without RECHARGE keeps the recharge before it, as MODFLOW 6 keeps an array.
    if (g2.RECHARGE !== undefined) model.rch[String(p - 1)] = g2.RECHARGE;
  }
  if (o.FIXED_CELL) model.options = { ...(model.options || {}), rch: { fixedCell: true } };
}

// EVT6 (gwf-evt.dfn, gwf-evta.dfn) into model.evt (arrays) or model.evtList.
function readEvt(files, ln, model, dims, nper, notes) {
  const fname = ln.toks[1], n2 = dims.nrow * dims.ncol;
  const blocks = readBlocks(files, fname, ln);
  const ob = only(blocks, 'OPTIONS');
  const arrays = ob && ob.lines.some((l) => l.toks[0].toUpperCase() === 'READASARRAYS');
  let fixed = false;
  if (!arrays) {
    const spec = {
      ftype: 'EVT6', options: ['FIXED_CELL'], dims: ['NSEG'],
      cols: (d) => {
        let nseg = 1;
        if (d.NSEG) nseg = toInt(d.NSEG.toks[0] ?? '', d.NSEG.where, 'NSEG');
        else notes.push(`${fname} gives no NSEG, so the ET rate is one straight segment from the surface to the extinction depth: NSEG is 1 by default (gwf-evt.dfn, "Default is one").`);
        if (nseg < 1) fail(d.NSEG.where, `NSEG must be at least 1, not ${nseg}.`);
        return ['surface', 'rate', 'depth', ...Array.from({ length: nseg - 1 }, (_, i) => `pxdp ${i + 1}`), ...Array.from({ length: nseg - 1 }, (_, i) => `petm ${i + 1}`)];
      },
    };
    model.evtList = readList(files, fname, ln, 'evtList', dims, nper, notes, spec);
    fixed = Boolean(spec.found.opts.FIXED_CELL);
    if (fixed) model.options = { ...(model.options || {}), evtList: { fixedCell: true } };
    return;
  }
  checkBlocks(blocks, ['OPTIONS', 'PERIOD']);
  const o = options(ob, ['READASARRAYS', 'FIXED_CELL'], PRINT);
  model.evt = {};
  let last = 0, first = true;
  for (const b of blocks.filter((x) => x.name === 'PERIOD')) {
    const p = toInt(b.args[0] ?? '', b.where, 'PERIOD number');
    if (p < 1 || p > nper) fail(b.where, `PERIOD ${p} is not one of 1 to ${nper}.`);
    if (p <= last) fail(b.where, `PERIOD ${p} comes after period ${last}.`);
    last = p;
    const g2 = readGridBlock(files, b, { IEVT: { n: n2, int: true }, SURFACE: { n: n2 }, RATE: { n: n2 }, DEPTH: { n: n2 } }, dims);
    if (g2.IEVT !== undefined && b.lines[0] !== g2.at.IEVT) fail(g2.at.IEVT, 'IEVT must come first in the PERIOD block, as MODFLOW 6 requires.');
    const missing = ['SURFACE', 'RATE', 'DEPTH'].filter((k) => g2[k] === undefined);
    // MODFLOW 6 6.7.0 sets an array the first block leaves out to zero, not to the values
    // gwf-evta.dfn gives as defaults (0, 0.001, 1.0, which FloPy fills in itself), as runs of
    // it show; so nothing is assumed here.
    if (first && missing.length) fail(b.where, `the first PERIOD block has no ${listed(missing)}: give ${missing.length === 1 ? 'it' : 'them'}. MODFLOW 6 6.7.0 takes an array left out as zero, not as the default gwf-evta.dfn documents, so none is assumed here.`);
    first = false;
    const v = {};
    if (g2.IEVT !== undefined) {
      v.ievt = typeof g2.IEVT === 'number' ? g2.IEVT - 1 : g2.IEVT.map((k) => k - 1);
      const bad = expand(v.ievt, n2).findIndex((k) => k < 0 || k >= dims.nlay);
      if (bad >= 0) fail(g2.at.IEVT, `IEVT ${expand(v.ievt, n2)[bad] + 1} at row ${Math.floor(bad / dims.ncol) + 1}, column ${(bad % dims.ncol) + 1} is not a layer of the model (1 to ${dims.nlay}).`);
    }
    for (const k of ['SURFACE', 'RATE', 'DEPTH']) if (g2[k] !== undefined) v[k.toLowerCase()] = g2[k];
    model.evt[String(p - 1)] = v;
  }
  if (o.FIXED_CELL) model.options = { ...(model.options || {}), evt: { fixedCell: true } };
}

// The IMS file for the solver settings. Every setting is written, so nothing rests on a
// COMPLEXITY default, and they are the solver's own (ims.js), so MODFLOW 6
// takes the same iterations: the linear acceleration, the preconditioner (MILU(0) at the
// page's relaxation factor unless solver.relax gives another, ILUT when solver.levels is
// above 0), the outer under-relaxation and backtracking, and no scaling or reordering.
function imsFile(s) {
  const ur = s.underRelaxation, bt = s.backtracking;
  const nonlinear = [`  OUTER_DVCLOSE ${num(s.hclose, 'solver.hclose')}`, `  OUTER_MAXIMUM ${int(s.outer, 'solver.outer')}`, `  UNDER_RELAXATION ${ur ? ur.method.toUpperCase() : 'NONE'}`];
  if (ur) {
    for (const k of ['theta', 'kappa', 'gamma', 'momentum']) if (ur[k] !== undefined) nonlinear.push(`  UNDER_RELAXATION_${k.toUpperCase()} ${num(ur[k], `solver.underRelaxation.${k}`)}`);
  }
  if (bt) {
    nonlinear.push(`  BACKTRACKING_NUMBER ${int(bt.number, 'solver.backtracking.number')}`, `  BACKTRACKING_TOLERANCE ${num(bt.tolerance, 'solver.backtracking.tolerance')}`,
      `  BACKTRACKING_REDUCTION_FACTOR ${num(bt.reductionFactor, 'solver.backtracking.reductionFactor')}`, `  BACKTRACKING_RESIDUAL_LIMIT ${num(bt.residualLimit, 'solver.backtracking.residualLimit')}`);
  }
  return file('Iterative model solution', [
    block('OPTIONS', ['  PRINT_OPTION SUMMARY', ...(s.noPtc ? [`  NO_PTC ${s.noPtc.toUpperCase()}`] : [])]),
    block('NONLINEAR', nonlinear),
    block('LINEAR', [
      `  INNER_MAXIMUM ${int(s.inner, 'solver.inner')}`, `  INNER_DVCLOSE ${num(s.innerHclose ?? s.hclose, 'solver.innerHclose')}`,
      `  INNER_RCLOSE ${num(s.rclose, 'solver.rclose')}${s.strict ? ' STRICT' : ''}`, `  LINEAR_ACCELERATION ${(s.linear ?? 'cg').toUpperCase()}`,
      `  RELAXATION_FACTOR ${num(s.relax ?? RELAX, 'solver.relax')}`,
      `  PRECONDITIONER_LEVELS ${int(s.levels ?? 0, 'solver.levels')}`, `  PRECONDITIONER_DROP_TOLERANCE ${s.dropTolerance ? num(s.dropTolerance, 'solver.dropTolerance') : '0.0'}`,
      `  NUMBER_ORTHOGONALIZATIONS ${int(s.orthogonalizations ?? 0, 'solver.orthogonalizations')}`,
      '  SCALING_METHOD NONE', '  REORDERING_METHOD NONE',
    ]),
  ]);
}

// The solver settings of an IMS file (sln-ims.dfn 6.7.0). A value the file leaves out takes
// the one MODFLOW 6 6.7.0 gives it for the file's COMPLEXITY, or SIMPLE's when there is none
// (ims.js COMPLEXITY and OUTER_DEFAULTS), and a note names each. Settings that are the
// solver's defaults are left out of the JSON: CG, the page's relaxation factor, no ILUT, no
// re-orthogonalization, no under-relaxation, no backtracking, INNER_DVCLOSE equal to
// OUTER_DVCLOSE.
function readIms(files, sln, notes) {
  const imsName = sln.toks[1];
  const ims = readBlocks(files, imsName, sln);
  checkBlocks(ims, ['OPTIONS', 'NONLINEAR', 'LINEAR']);
  const io = options(only(ims, 'OPTIONS'), ['COMPLEXITY', 'NO_PTC'], ['PRINT_OPTION', 'CSV_OUTPUT', 'CSV_OUTER_OUTPUT', 'CSV_INNER_OUTPUT', 'ATS_OUTER_MAXIMUM_FRACTION']);
  const nl = options(only(ims, 'NONLINEAR'), ['OUTER_DVCLOSE', 'OUTER_HCLOSE', 'OUTER_MAXIMUM', 'UNDER_RELAXATION', 'BACKTRACKING_NUMBER',
    'UNDER_RELAXATION_GAMMA', 'UNDER_RELAXATION_THETA', 'UNDER_RELAXATION_KAPPA', 'UNDER_RELAXATION_MOMENTUM',
    'BACKTRACKING_TOLERANCE', 'BACKTRACKING_REDUCTION_FACTOR', 'BACKTRACKING_RESIDUAL_LIMIT'], ['OUTER_RCLOSEBND', 'LINEAR_SOLVER']);
  const li = options(only(ims, 'LINEAR'), ['INNER_MAXIMUM', 'INNER_RCLOSE', 'LINEAR_ACCELERATION', 'INNER_DVCLOSE', 'INNER_HCLOSE', 'RELAXATION_FACTOR', 'PRECONDITIONER_LEVELS',
    'PRECONDITIONER_DROP_TOLERANCE', 'NUMBER_ORTHOGONALIZATIONS', 'SCALING_METHOD', 'REORDERING_METHOD'], ['RED_BLACK_ORDERING']);
  let complexity = 'SIMPLE';
  if (io.COMPLEXITY) {
    complexity = (io.COMPLEXITY.toks[0] || '').toUpperCase();
    if (!COMPLEXITY[complexity]) fail(io.COMPLEXITY.where, `COMPLEXITY ${io.COMPLEXITY.toks[0] || ''} is not one of SIMPLE, MODERATE or COMPLEX.`);
  }
  const preset = COMPLEXITY[complexity], outerDefault = OUTER_DEFAULTS[complexity];
  const filled = [];
  const given = (o, k, alias) => o[k] ?? (alias && o[alias]);
  const value = (o, k, read, fallback, alias) => {
    const v = given(o, k, alias);
    if (v) return read(v.toks[0] ?? '', v.where, k);
    filled.push([k, fallback]);
    return fallback;
  };
  const word = (o, k, fallback, allowed) => {
    if (!o[k]) { filled.push([k, fallback]); return fallback; }
    const w = (o[k].toks[0] || '').toUpperCase();
    if (!allowed.includes(w)) fail(o[k].where, `${k} ${o[k].toks[0] || ''} is not one of ${listed(allowed)}.`);
    return w;
  };
  const rc = li.INNER_RCLOSE;
  const rcOpt = rc ? (rc.toks[1] || '').toUpperCase() : '';
  if (rcOpt && rcOpt !== 'STRICT') fail(rc.where, `INNER_RCLOSE ${rcOpt} (a residual measured as an L2 or relative norm) is not supported: the solver's rclose is the largest residual at any one cell.`);
  const solver = {
    outer: value(nl, 'OUTER_MAXIMUM', toInt, preset.outer),
    inner: value(li, 'INNER_MAXIMUM', toInt, preset.inner),
    hclose: value(nl, 'OUTER_DVCLOSE', toNumber, preset.hclose, 'OUTER_HCLOSE'),
    rclose: value(li, 'INNER_RCLOSE', toNumber, preset.rclose),
  };
  // INNER_DVCLOSE: each COMPLEXITY gives it OUTER_DVCLOSE's value.
  const innerDv = value(li, 'INNER_DVCLOSE', toNumber, preset.hclose, 'INNER_HCLOSE');
  if (innerDv !== solver.hclose) solver.innerHclose = innerDv;
  if (rcOpt === 'STRICT') solver.strict = true;
  const linear = word(li, 'LINEAR_ACCELERATION', preset.linear.toUpperCase(), ['CG', 'BICGSTAB']);
  if (linear === 'BICGSTAB') solver.linear = 'bicgstab';
  const relax = value(li, 'RELAXATION_FACTOR', toNumber, preset.relax);
  if (!(relax >= 0 && relax <= 1)) fail(li.RELAXATION_FACTOR.where, `RELAXATION_FACTOR ${relax} is outside 0 to 1.`);
  if (relax !== RELAX) solver.relax = relax;
  const levels = value(li, 'PRECONDITIONER_LEVELS', toInt, preset.levels);
  if (levels < 0) fail(li.PRECONDITIONER_LEVELS.where, 'PRECONDITIONER_LEVELS must be 0 or more.');
  const drop = value(li, 'PRECONDITIONER_DROP_TOLERANCE', toNumber, preset.dropTolerance);
  if (!(drop >= 0)) fail(li.PRECONDITIONER_DROP_TOLERANCE.where, 'PRECONDITIONER_DROP_TOLERANCE must be 0 or more.');
  // ImsLinear.f90 imslinear_ar: ILUT only when PRECONDITIONER_LEVELS is above 0; the drop
  // tolerance is used then, and otherwise ignored (MODFLOW 6 warns that it is).
  if (levels > 0) { solver.levels = levels; solver.dropTolerance = drop; }
  const north = value(li, 'NUMBER_ORTHOGONALIZATIONS', toInt, preset.orthogonalizations);
  if (north < 0) fail(li.NUMBER_ORTHOGONALIZATIONS.where, 'NUMBER_ORTHOGONALIZATIONS must be 0 or more.');
  if (north > 0) solver.orthogonalizations = north;
  const method = word(nl, 'UNDER_RELAXATION', preset.underRelaxation ? preset.underRelaxation.method.toUpperCase() : 'NONE', ['NONE', 'SIMPLE', 'COOLEY', 'DBD']);
  if (method !== 'NONE') {
    const keys = method === 'DBD' ? ['theta', 'kappa', 'gamma', 'momentum'] : ['gamma'];
    solver.underRelaxation = { method: method.toLowerCase() };
    for (const k of keys) solver.underRelaxation[k] = value(nl, `UNDER_RELAXATION_${k.toUpperCase()}`, toNumber, outerDefault[k]);
  }
  const btn = value(nl, 'BACKTRACKING_NUMBER', toInt, outerDefault.number);
  if (btn < 0) fail(nl.BACKTRACKING_NUMBER.where, 'BACKTRACKING_NUMBER must be 0 or more.');
  if (btn > 0) {
    solver.backtracking = { number: btn };
    for (const [k, w] of [['tolerance', 'BACKTRACKING_TOLERANCE'], ['reductionFactor', 'BACKTRACKING_REDUCTION_FACTOR'], ['residualLimit', 'BACKTRACKING_RESIDUAL_LIMIT']]) solver.backtracking[k] = value(nl, w, toNumber, outerDefault[k]);
  }
  // sln_ar: NO_PTC FIRST turns pseudo-transient continuation off for the first period only;
  // ALL, or no word, for every period.
  if (io.NO_PTC) solver.noPtc = (io.NO_PTC.toks[0] || '').toUpperCase() === 'FIRST' ? 'first' : 'all';
  // The values filled in are named where they change the run from the solver's defaults:
  // the four every model gives, and the others only when they turn something on (BICGSTAB,
  // ILUT and its drop tolerance, re-orthogonalization, under-relaxation and its values,
  // backtracking and its values, an inner closure other than hclose). The relaxation
  // factor is kept in the JSON but not named, as before.
  const used = filled.filter(([k, v]) => ['OUTER_MAXIMUM', 'INNER_MAXIMUM', 'OUTER_DVCLOSE', 'INNER_RCLOSE'].includes(k)
    || (k === 'INNER_DVCLOSE' && solver.innerHclose !== undefined)
    || (k === 'LINEAR_ACCELERATION' && v === 'BICGSTAB')
    || (k === 'PRECONDITIONER_LEVELS' && v > 0) || (k === 'PRECONDITIONER_DROP_TOLERANCE' && levels > 0)
    || (k === 'NUMBER_ORTHOGONALIZATIONS' && v > 0)
    || (k === 'UNDER_RELAXATION' && v !== 'NONE') || (k.startsWith('UNDER_RELAXATION_') && solver.underRelaxation)
    || (k === 'BACKTRACKING_NUMBER' && v > 0) || (k.startsWith('BACKTRACKING_') && k !== 'BACKTRACKING_NUMBER' && solver.backtracking));
  if (used.length) {
    notes.push(`${imsName} ${io.COMPLEXITY ? `sets COMPLEXITY ${complexity}` : 'sets no COMPLEXITY, so MODFLOW 6 uses SIMPLE,'} and does not give ${listed(used.map(([k]) => k))}. `
      + `The values MODFLOW 6 6.7.0 gives them for ${complexity} were used (mf6io 6.7.0, "IMS variable values for the available complexity options", and the source where the two differ): `
      + `${used.map(([k, v]) => `${k} ${v}`).join(', ')}.`
      + (used.some(([k]) => k === 'OUTER_DVCLOSE') ? ` A run stops once no head changes by more than hclose (here ${preset.hclose} in the model's length unit) in an outer iteration, which leaves heads short of the fully converged ones, by up to about 15 times hclose on the models it was measured on; give a smaller hclose for closer heads.` : ''));
  }
  // What this page does not do: matrix scaling and reordering. They change how MODFLOW 6
  // iterates, not the heads it converges to.
  const path = [];
  for (const k of ['SCALING_METHOD', 'REORDERING_METHOD']) {
    if (li[k] && (li[k].toks[0] || '').toUpperCase() !== 'NONE') path.push(`${k} ${(li[k].toks[0] || '').toUpperCase()}`);
  }
  if (path.length) {
    notes.push(`${imsName} asks for ${listed(path)}, which this page does not do: it solves the system as it stands. These change how MODFLOW 6 iterates, not the heads it converges to, `
      + 'but neither program stops exactly at the converged heads: each stops once no head changes by more than hclose in an outer iteration, so the heads can differ by about that much, and the iteration counts differ. A smaller hclose brings them closer.');
  }
  return solver;
}
