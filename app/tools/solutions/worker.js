// Runs one fit for the "Fit a pumping test solution" page off the main thread. The
// solution is named by its id, since functions cannot be sent to a worker.
import { fitWithCurve } from '../../../engine/fit.js';
import { SOLUTIONS } from '../../../engine/solutions/index.js';
import { serveJob } from '../../worker-job.js';

serveJob(({ id, input }, { progress }) => {
  const solution = SOLUTIONS.find((s) => s.id === id);
  if (!solution) throw new Error(`No solution called ${id}.`);
  return fitWithCurve({ ...input, solution, progress });
});
