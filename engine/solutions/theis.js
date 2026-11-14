// Theis (1935): a fully penetrating well of small diameter pumping at a constant rate
// from a confined aquifer of infinite extent.
//   s = Q / (4 pi T) W(u),  u = r^2 S / (4 T t)
// W(u) is the well function of src/engine/pumping.js, checked there against the table
// of Kruseman and de Ridder (1994), Annex 3.1.
import { wellFunction } from '../pumping.js';
import { FRACTION_MAX } from './bounds.js';
import { KRUSEMAN_DE_RIDDER_1994, THEIS_1935 } from '../refs.js';

export default {
  id: 'theis',
  name: 'Theis (1935)',
  family: 'confined',
  summary: 'A confined aquifer of infinite extent, pumped by a fully penetrating well of small diameter. The standard curve the others are measured against.',
  params: [
    { id: 'T', symbol: 'T', label: 'Transmissivity', kind: 'T' },
    { id: 'S', symbol: 'S', label: 'Storativity', kind: 'S', max: FRACTION_MAX },
  ],
  geometry: ['r'],
  images: true,
  drawdown(p, g, t, Q) {
    const c = Q / (4 * Math.PI * p.T), a = (g.r * g.r * p.S) / (4 * p.T);
    return t.map((x) => (x > 0 ? c * wellFunction(a / x) : 0));
  },
  references: [THEIS_1935, KRUSEMAN_DE_RIDDER_1994],
  method() {
    return {
      lines: [
        'The drawdown from a well pumping from a confined aquifer, as given by Theis (1935). Its assumptions: the aquifer is confined, uniform, of the same thickness everywhere and of infinite extent; the well penetrates the whole aquifer and has a small diameter, so the water stored in it is neglected; water is released from storage at once as the head falls (Kruseman and de Ridder 1994, chapter 3).',
        'Here s is the drawdown, Q the pumping rate, T the transmissivity, S the storativity, r the distance from the pumped well and t the time since pumping began. W(u) is the Theis well function, computed by its series below u = 1 and by a continued fraction above, and checked against the table in Kruseman and de Ridder (1994, Annex 3.1). In metres and days throughout.',
      ],
      formula: 's = Q / (4πT) · W(u),  u = r²S / (4Tt)\nW(u) = integral from u to infinity of (e^(−y) / y) dy',
    };
  },
};
