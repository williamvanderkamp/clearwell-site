// Runs the flow model for the model page off the main thread, so the page stays live.
// Progress comes from the solver after each time step, at most every 80 ms. Each solved step
// is posted as it is solved (run()'s onStep), so when the page stops the run by ending this
// worker, it keeps the steps it already has. The last message carries the rest of the
// result without the heads and the cell-by-cell flows, which the page has from the steps,
// and an error carries its code, where and the result so far beside its message.
import { run } from '../../../engine/model/run.js';
import { serveJob } from '../../worker-job.js';

const stepOf = (out, s) => ({
  s, time: out.times[s], period: out.periods[s], step: out.steps[s], iteration: out.iterations[s],
  budget: out.budget[s], dry: out.dry[s], flows: out.flows[s], obs: Object.fromEntries(Object.entries(out.obs).map(([k, v]) => [k, v[s]])),
  notices: structuredClone(out.notices),
});
const rest = (out) => { const { heads, flows, ...r } = out; return r; };

serveJob(({ model }, { progress: post, step }) => {
  const started = Date.now();
  let last = 0;
  const progress = (p) => {
    const now = Date.now();
    if (now - last > 80) { last = now; post(p); }
  };
  const onStep = (out, s) => {
    const head = out.heads[s].slice();
    step({ ...stepOf(out, s), head }, [head.buffer]);
  };
  const res = run(model, { progress, onStep });
  res.seconds = (Date.now() - started) / 1000;
  return rest(res);
}, { details: (err) => ({ code: err.code, where: err.where, result: err.result ? rest(err.result) : undefined }) });
