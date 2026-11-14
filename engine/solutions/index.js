// The pumping test solutions the "Fit a pumping test solution" tool offers, grouped by
// family on the page in this order. Each module follows docs/design/solutions.md.
import barkerGrf from './barker-grf.js';
import doughertyBabu from './dougherty-babu.js';
import gringartenWitherspoon from './gringarten-witherspoon.js';
import hantush1960 from './hantush-1960.js';
import hantushJacob from './hantush-jacob.js';
import hantushPartial from './hantush-partial.js';
import moench1984 from './moench-1984.js';
import moench1985 from './moench-1985.js';
import moench1997 from './moench-1997.js';
import neuman from './neuman.js';
import papadopulosCooper from './papadopulos-cooper.js';
import theis from './theis.js';

// One line per solution, in family order, so additions merge cleanly.
export const SOLUTIONS = [
  theis,
  papadopulosCooper,
  hantushPartial,
  doughertyBabu,
  hantushJacob,
  hantush1960,
  moench1985,
  neuman,
  moench1997,
  barkerGrf,
  moench1984,
  gringartenWitherspoon,
];
