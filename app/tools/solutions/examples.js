// Examples for the fit page, from published tests, each with the solution the book used on it.
import { toCsv, together } from '../../../engine/format.js';
import { sig } from '../../kit.js';
import { DALEM, OUDE_KORENDIJK, VENNEBULTEN } from '../textbook.js';
import { DE_RIDDER_1961, DE_RIDDER_1966, WIT_1963 } from '../../../engine/refs.js';

const MIN_HEADER = ['Time (min)', 'Drawdown (m)'], DAY_HEADER = ['Time (d)', 'Drawdown (m)'];
const KDR = 'Kruseman and de Ridder 1994';
export const EXAMPLES = [
  {
    label: 'Oude Korendijk, Theis', name: 'oude-korendijk-h30.csv', csv: toCsv(MIN_HEADER, OUDE_KORENDIJK.H30.rows), header: MIN_HEADER, rows: OUDE_KORENDIJK.H30.rows,
    values: { solution: 'theis', rateKind: 'constant', Q: 788, qUnit: 'm3/d', lUnit: 'm', g_r: 30 },
    source: WIT_1963,
    note: `Real data: pumping test 'Oude Korendijk', the Netherlands, piezometer H30, 30 m from a well pumped at 788 m³/d (${KDR}, Table 3.1, after Wit 1963). The book's Theis type curve match to H30 and H90 together gave T = 392 m²/d and S = ${sig(1.6e-4, 2, true)} (Table 3.3). It notes that the late readings fall off the Theis curve, perhaps from leakage. The rate, distance and solution are filled in from the book.`,
  },
  {
    label: 'Dalem, Hantush and Jacob', name: 'dalem-90m.csv', csv: toCsv(DAY_HEADER, DALEM[90]), header: DAY_HEADER, rows: DALEM[90],
    values: { solution: 'hantush-jacob', rateKind: 'constant', Q: 761, qUnit: 'm3/d', lUnit: 'm', g_r: 90 },
    source: DE_RIDDER_1961,
    note: `Real data: pumping test 'Dalem', the Netherlands, corrected drawdowns at the piezometer 90 m from a well pumped at 761 m³/d (${KDR}, Table 4.2, after De Ridder 1961). From this piezometer the book got T = 1731 m²/d, S = 0.0019 and B = 900 m with Walton's type curves, and T = 1665 m²/d, S = 0.0017 and B = 600 m with the Hantush inflection point (Table 4.4). The rate, distance and solution are filled in from the book.`,
  },
  {
    label: 'Vennebulten, Neuman', name: 'vennebulten-wii-90.csv', csv: toCsv(MIN_HEADER, VENNEBULTEN), header: MIN_HEADER, rows: VENNEBULTEN,
    values: { solution: 'neuman', rateKind: 'constant', Q: 873, qUnit: 'm3/d', lUnit: 'm', g_r: 90, g_b: 21 },
    source: DE_RIDDER_1966,
    note: `Real data: Vennebulten, the Netherlands, deep piezometer 90 m from a well pumped at 873 m³/d, saturated thickness 21 m (${KDR}, Example 5.1 and Table 5.1, after De Ridder 1966). Their type curve match gave T = 1447 m²/d from the early curve and 1616 m²/d from the late curve, S = ${sig(5.2e-4, 2, true)}, Sy = 0.0049 and β = 0.01. The piezometer is not screened over the full thickness; the book analyzes it as if it were, and so does this example.`,
  },
].map((x) => ({ ...x, note: together(x.note) }));
