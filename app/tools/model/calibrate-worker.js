// Runs a fit for the model page's calibration panel (calibrate.js) off the main thread:
// calibrate() on the model with the parameters rebuilt from their specs (fromSpec), posting
// its progress at most every 100 ms and then the result, with its heads' buffers handed over.
import { calibrate, fromSpec } from '../../../engine/model/calibrate.js';
import { serveJob } from '../../worker-job.js';

serveJob(({ model, specs, observations }, { progress }) => {
  let last = 0;
  return calibrate(model, {
    params: specs.map(fromSpec),
    observations,
    progress: (p) => { const now = Date.now(); if (now - last > 100) { last = now; progress(p); } },
  });
}, { transfer: (res) => res.result.heads.map((h) => h.buffer) });
