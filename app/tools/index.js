// The tools beyond the first two. Each is one module in this folder, or a folder of them,
// with { id, group, title, blurb, lede, mount(host, signal) }. Listing it here puts it on
// the front page: group is the front page group its card goes in, one of the data-group
// sections of index.html (tests, models, levels, properties, or other for "More tools"),
// and within a group the cards are in the order of this list. signal is aborted when the
// page leaves the tool: what the tool leaves running, such as a Web Worker, a timer or a
// listener on the window, ends with it.
import predict from './predict.js';
import leaky from './leaky.js';
import logger from './logger.js';
import recharge from './recharge.js';
import distance from './distance.js';
import slug from './slug/page.js';
import chem from './chem.js';
import step from './step.js';
import trend from './trend.js';
import unconfined from './unconfined.js';
import grainsize from './grainsize.js';
import solutions from './solutions/page.js';
import model from './model/page.js';

export const EXTRA_TOOLS = [
  solutions,
  distance,
  leaky,
  unconfined,
  step,
  slug,
  predict,
  model,
  logger,
  recharge,
  trend,
  chem,
  grainsize,
];
