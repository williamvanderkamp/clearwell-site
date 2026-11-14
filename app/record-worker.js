// Runs the well record correction off the main thread, as solutions/worker.js does for
// the pumping fits, so a long record does not hold the page up (record.js).
import { correct } from '../engine/correct.js';
import { serveJob } from './worker-job.js';

serveJob(({ input, opts }) => correct(input, opts));
