// What the fit page calls each solution's inputs and values: the geometry, and each
// value's kind, name, symbol and unit.
import { SOLUTIONS } from '../../../engine/solutions/index.js';
import { unit } from '../../kit.js';

// The geometry the design allows, as a hydrogeologist would name each on a form.
const GEOMETRY = {
  r: ['Distance from the pumped well to the observation point', 'Equal to the well radius when the observation is the pumped well itself.'],
  rw: ['Radius of the pumped well screen', 'Or its effective radius.'],
  rc: ['Radius of the pumped well casing', 'Where the water level moves. 0 for no casing storage.'],
  rwObs: ['Radius of the observation well screen', ''],
  rcObs: ['Radius of the observation well casing', 'Inside radius of the standpipe. 0 for no lag.'],
  b: ['Saturated thickness of the aquifer', 'Before pumping.'],
  d: ['Depth to the top of the pumped well screen', 'Below the top of the aquifer.'],
  l: ['Depth to the bottom of the pumped well screen', 'Below the top of the aquifer.'],
  z1: ['Depth to the top of the observation screen', 'Below the top of the aquifer. For a piezometer, its depth.'],
  z2: ['Depth to the bottom of the observation screen', 'Below the top of the aquifer. For a piezometer, the same as the top.'],
  b1: ['Thickness of the aquitard above', ''],
  b2: ['Thickness of the aquitard below', ''],
  x: ['Observation point: distance along the fracture', 'From the pumped well, along the vertical fracture through it. Zero or above.'],
  y: ['Observation point: distance across the fracture', 'At right angles to the fracture. Zero or above; 0 and 0 is the pumped well.'],
  mb: ['Matrix block size', 'The slab thickness or the sphere diameter.'],
};
export const geometryKeys = [...new Set(SOLUTIONS.flatMap((s) => s.geometry))];
// A solution may name a geometry input in its own terms (Barker's r is along the flow paths).
export const geometryText = (k, sol) => (sol && sol.geometryLabels && sol.geometryLabels[k]) || GEOMETRY[k] || [`${k} (as the solution's paper names it)`, ''];
export const geometryLabel = (k, sol) => geometryText(k, sol)[0];
export const fieldId = (...parts) => parts.join('_').replace(/[^A-Za-z0-9_]/g, '_');

// Each kind of value: its unit in the user's length unit lu, and the factor to metres and days.
const KIND = {
  T: { unit: (lu) => unit(`${lu}2/d`), si: (L) => L * L, hint: 'In the length unit squared per day.' },
  K: { unit: (lu) => `${lu}/d`, si: (L) => L, hint: 'In the length unit per day.' },
  L: { unit: (lu) => lu, si: (L) => L, hint: 'In the length unit.' },
  c: { unit: () => 'd', si: () => 1, hint: 'In days.' },
  S: { unit: () => 'none', si: () => 1, hint: 'No unit.' },
  Sy: { unit: () => 'none', si: () => 1, hint: 'No unit.' },
  ratio: { unit: () => 'none', si: () => 1, hint: 'No unit.' },
  skin: { unit: () => 'none', si: () => 1, hint: 'No unit. Zero or above; 0 is no skin.' },
  Ss: { unit: (lu) => `1/${lu}`, si: (L) => 1 / L, hint: 'Per length unit.' },
  // The solution's own label states the unit, in metres and days.
  other: { unit: () => '', si: () => 1, hint: 'In the unit its name gives, in metres and days.' },
};
export const kindOf = (p) => KIND[p.kind] || KIND.other;
export const hintOf = (p) => p.hint || kindOf(p).hint;
// The unit to write after a value: none for a ratio, and none for an 'other' kind,
// whose label says it.
export const unitOf = (p, lu) => { const u = kindOf(p).unit(lu); return u === 'none' ? '' : u; };
// Each value's symbol, as the solution gives it (T, Sy, Kz/Kr, α₁, S′), never its id.
export const symbolOf = (p) => p.symbol || p.id;
// The name with its symbol, "Transmissivity T", unless the label already ends in it;
// a symbol goes before a comma or a bracket, "Storativity S, elastic".
const nameOf = (p) => {
  const sym = symbolOf(p);
  if (p.label.split(/[\s(),]+/).includes(sym)) return p.label;
  const cut = p.label.search(/,| \(/);
  return cut < 0 ? `${p.label} ${sym}` : `${p.label.slice(0, cut)} ${sym}${p.label.slice(cut)}`;
};
// The name without its bracketed unit or its qualifier, for a sentence: "Drainage
// constant α₁", "Storativity S".
export const shortName = (p) => nameOf(p).replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '');
// The name with its unit, for a table row: "Transmissivity T (m²/d)".
export const withUnit = (p, lu) => (unitOf(p, lu) ? `${nameOf(p)} (${unitOf(p, lu)})` : nameOf(p));
// The unit for the workbook: the kind's own, the one in an 'other' label's brackets,
// or none for a pure number such as the flow dimension n.
export const sheetUnit = (p, lu) => {
  const u = kindOf(p).unit(lu);
  if (u) return u;
  const m = p.label.match(/\(([^)]*\/[^)]*)\)/);
  return m ? unit(m[1]) : 'none';
};
