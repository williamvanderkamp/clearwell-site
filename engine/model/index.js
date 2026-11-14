// The groundwater flow model (docs/design/model.md): a block-centred finite-difference
// model that solves what MODFLOW 6 GWF solves, with no DOM so it can run in a Web Worker.
export { run } from './run.js';
export { buildGrid } from './grid.js';
