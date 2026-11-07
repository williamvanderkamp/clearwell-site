// Major-ion water chemistry: concentrations to milliequivalents per litre, the charge
// balance error, the water type, and the positions on a Piper (1944) diagram.
// No page code here, so the tests can run it directly.

// Abridged standard atomic weights, CIAAW (2024), based on IUPAC Atomic Weights 2021.
export const ATOMIC_WEIGHT = { H: 1.0080, C: 12.011, O: 15.999, Na: 22.990, Mg: 24.305, S: 32.06, Cl: 35.45, K: 39.098, Ca: 40.078 };

const A = ATOMIC_WEIGHT;
// [formula weight in g/mol, charge]. Alkalinity is reported as CaCO3, which takes two equivalents.
const IONS = {
  Ca: [A.Ca, 2], Mg: [A.Mg, 2], Na: [A.Na, 1], K: [A.K, 1],
  HCO3: [A.H + A.C + 3 * A.O, 1], CO3: [A.C + 3 * A.O, 2], Cl: [A.Cl, 1], SO4: [A.S + 4 * A.O, 2],
  Alk: [A.Ca + A.C + 3 * A.O, 2],
};

/** Grams per equivalent: formula weight over the size of the charge. */
export const EQUIVALENT_WEIGHT = Object.fromEntries(Object.entries(IONS).map(([k, [w, z]]) => [k, w / z]));

export const UNITS = ['mg/L', 'meq/L'];
export const CATIONS = ['Ca', 'Mg', 'Na', 'K'];
export const ION_NAMES = { Ca: 'Ca', Mg: 'Mg', Na: 'Na', K: 'K', HCO3: 'HCO3', CO3: 'CO3', Alk: 'Alkalinity', Cl: 'Cl', SO4: 'SO4' };

/** The ions a sample needs: basis 'ions' takes HCO3 and CO3, basis 'alk' takes total alkalinity. */
export function ionsFor(basis) {
  if (basis === 'ions') return [...CATIONS, 'HCO3', 'CO3', 'Cl', 'SO4'];
  if (basis === 'alk') return [...CATIONS, 'Alk', 'Cl', 'SO4'];
  throw new Error('Say whether the file gives bicarbonate and carbonate or total alkalinity.');
}

/** One concentration in meq/L. unit is 'mg/L' or 'meq/L'; there is no default. */
export function toMeq(value, ion, unit) {
  if (!(ion in IONS)) throw new Error(`Unknown ion ${ion}.`);
  if (unit === 'meq/L') return value;
  if (unit === 'mg/L') return value / EQUIVALENT_WEIGHT[ion];
  throw new Error('Choose the unit the concentrations are in.');
}

/** Freeze and Cherry (1979): 100 (sum of cations - sum of anions) / (sum of cations + sum of anions), in meq/L. */
export function chargeBalance(cations, anions) {
  return (100 * (cations - anions)) / (cations + anions);
}

// Back (1966) facies: an ion group is dominant when it is more than half of its side.
const FACIES = {
  cation: [['Ca', 'calcium', 'Ca'], ['Mg', 'magnesium', 'Mg'], ['NaK', 'sodium-potassium', 'Na+K']],
  anion: [['HCO3CO3', 'bicarbonate', 'HCO3'], ['SO4', 'sulfate', 'SO4'], ['Cl', 'chloride', 'Cl']],
};
function facies(pct, side) {
  const hit = FACIES[side].find(([k]) => pct[k] > 50);
  return hit ? { name: `${hit[1]} type`, short: hit[2] } : { name: 'no dominant type', short: side === 'cation' ? 'mixed cation' : 'mixed anion' };
}

/** Plain reason a cell can't be used, or '' if it holds a usable number. */
function problem(v) {
  if (v === null || v === undefined || v === '') return 'blank';
  if (typeof v !== 'number') return `not a number ("${v}")`;
  if (!Number.isFinite(v)) return 'not a number';
  if (v < 0) return 'below zero';
  return '';
}

/**
 * One sample. values: { Ca, Mg, ... } as read from the file (numbers, text or blank).
 * Returns { name, ok: false, reasons } when any needed ion is unusable, otherwise
 * { name, ok: true, meq, cations, anions, balance, pct, cationType, anionType, type }.
 */
export function analyse(name, values, { unit, basis }) {
  const need = ionsFor(basis);
  if (!UNITS.includes(unit)) throw new Error('Choose the unit the concentrations are in.');
  const reasons = need.filter((k) => problem(values[k])).map((k) => `${ION_NAMES[k]} is ${problem(values[k])}`);
  if (reasons.length) return { name, ok: false, reasons };
  const meq = Object.fromEntries(need.map((k) => [k, toMeq(values[k], k, unit)]));
  const carbonate = basis === 'ions' ? meq.HCO3 + meq.CO3 : meq.Alk;
  const cations = meq.Ca + meq.Mg + meq.Na + meq.K, anions = carbonate + meq.Cl + meq.SO4;
  if (!(cations > 0) || !(anions > 0)) return { name, ok: false, reasons: [cations > 0 ? 'the anions add up to zero' : 'the cations add up to zero'] };
  const pct = {
    Ca: (100 * meq.Ca) / cations, Mg: (100 * meq.Mg) / cations, NaK: (100 * (meq.Na + meq.K)) / cations,
    HCO3CO3: (100 * carbonate) / anions, SO4: (100 * meq.SO4) / anions, Cl: (100 * meq.Cl) / anions,
  };
  const cationType = facies(pct, 'cation'), anionType = facies(pct, 'anion');
  return {
    name, ok: true, meq, carbonate, cations, anions, balance: chargeBalance(cations, anions), pct,
    cationType: cationType.name, anionType: anionType.name, type: `${cationType.short}-${anionType.short}`,
  };
}

// Piper diagram geometry. Each triangle has sides of 1; the anion triangle starts GAP
// to the right of the cation triangle; the diamond sits above, between them.
export const GAP = 0.1;
const H = Math.sqrt(3) / 2;
const ANION_X = 1 + GAP;
const BOTTOM = [1 + GAP / 2, GAP * H];

/** The four corners of the diamond: bottom, left, top, right. */
export const DIAMOND = [BOTTOM, [BOTTOM[0] - 0.5, BOTTOM[1] + H], [BOTTOM[0], BOTTOM[1] + 2 * H], [BOTTOM[0] + 0.5, BOTTOM[1] + H]];

/**
 * Positions from percentages, y upward. Cation triangle: Ca lower left, Na+K lower right,
 * Mg at the top. Anion triangle: HCO3+CO3 lower left, Cl lower right, SO4 at the top.
 * Diamond: Ca+Mg with HCO3+CO3 at the left corner, Na+K with Cl+SO4 at the right.
 */
export function piperPoint(pct) {
  const f = (k) => pct[k] / 100;
  const cation = [f('NaK') + f('Mg') / 2, f('Mg') * H];
  const anion = [ANION_X + f('Cl') + f('SO4') / 2, f('SO4') * H];
  const a = f('NaK'), b = f('Cl') + f('SO4');
  const diamond = [BOTTOM[0] - 0.5 * (1 - a) + 0.5 * b, BOTTOM[1] + H * (1 - a) + H * b];
  return { cation, anion, diamond };
}

/** Triangle corners [lower left, lower right, top] for 'cation' or 'anion'. */
export function triangle(side) {
  const x = side === 'anion' ? ANION_X : 0;
  return [[x, 0], [x + 1, 0], [x + 0.5, H]];
}
