// Build a groundwater flow model: a MODFLOW-style model editor on the site's own solver
// (src/engine/model/run.js), which solves what MODFLOW 6 solves for these packages. The
// user makes a grid, paints cell values on a plan-view map, places boundaries period by
// period, runs the model in a Web Worker and reads heads, drawdown, the budget and
// observation hydrographs. Models are saved as the JSON of docs/design/model.md, and
// written and read as MODFLOW 6 files (src/engine/model/mf6.js). Nothing is filled in for
// the user: every value comes from them, a loaded file or an example.
//
// The page is made of sections, one module each, which share one object, page: the state
// below, and the functions each section's mount adds to it for the others to call (each
// mount's comment lists them). Each mount appends its section, so they mount in the page's
// order; a section calls another's functions only through page, once every mount has run.
import { el } from '../../kit.js';
import { mountDrop } from './drop.js';
import { mountGrid } from './grid.js';
import { mountLayers } from './layers.js';
import { mountLists } from './lists.js';
import { mountMapEdits } from './map-edits.js';
import { mountPanels } from './panels.js';
import { mountPeriods } from './periods.js';
import { mountResults } from './results.js';
import { mountRun } from './run.js';
import { mountSync } from './sync.js';
import { mountView } from './view.js';

export default {
  id: 'model',
  group: 'models',
  title: 'Build a groundwater flow model',
  blurb: 'Make a grid, paint hydraulic conductivity and storage, place wells, rivers and constant heads, and run a MODFLOW 6-style model in your browser. Export and import MODFLOW 6 files.',
  lede: 'A block-centred finite-difference model of groundwater flow. For the packages it has (DIS, NPF, IC, STO, CHD, WEL, RCH, EVT, RIV, DRN, GHB and OBS) it solves the equations of MODFLOW 6 (Langevin et al. 2017) and gives the same heads; the method is written out under the results. Rows, columns and layers are numbered from 1 here, as in MODFLOW 6; values are in metres and days.',
  mount(host, signal) {
    const root = el('div', { class: 'stack model-page' });
    host.append(root);

    const page = {
      host,                 // the tool's host, which the panels are placed in after root
      root,                 // the page itself
      signal,               // aborted when the page is left
      model: null,          // the model being edited (null entries where values are needed)
      result: null,         // the latest run's result
      resultModel: null,    // the model it was run on
      stale: false,         // edited since the latest run
      example: null,        // the example loaded, while it is unchanged
      resultExample: null,  // the example the latest run was of, for the comparison with MODFLOW 6
      running: null,        // the run under way, with stop() once it has started
      view: { layer: 0, period: 0, show: 'k', step: 0, tool: 'look', shape: 'brush', interval: undefined, ref: '', scale: 'linear' },
      notNumbers: new Map(), // field label -> true, for entries that are not numbers
      blanks: new Map(),     // list values emptied by the user, still needed
      editCount: 0,          // edits so far, so a run knows whether the model changed while it ran
      overlays: {},          // what each panel draws on the map, by panel id
    };

    mountDrop(page);      // drop box and examples, units, what a model needs
    mountGrid(page);
    mountLayers(page);
    mountPeriods(page);   // periods and solver
    mountView(page);      // the map and what it draws
    mountMapEdits(page);  // edits on the map
    mountLists(page);     // boundary and observation lists, under the map
    mountRun(page);       // run, save and export
    mountResults(page);
    mountSync(page);      // keeping the page in step
    mountPanels(page);    // panels from later stages (panels.js)
  },
};
