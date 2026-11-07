// The tools beyond the first two. Each is one module in this folder with
// { id, title, blurb, lede, mount(host) }. Listing it here puts it on the front page.
import predict from './predict.js';
import leaky from './leaky.js';
import logger from './logger.js';
import recharge from './recharge.js';
import distance from './distance.js';
import slug from './slug.js';
import chem from './chem.js';
import step from './step.js';
import trend from './trend.js';
import unconfined from './unconfined.js';
import grainsize from './grainsize.js';

export const EXTRA_TOOLS = [
  predict,
  leaky,
  logger,
  recharge,
  distance,
  slug,
  chem,
  step,
  trend,
  unconfined,
  grainsize,
];
