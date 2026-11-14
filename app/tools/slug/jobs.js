// One fit for the slug test page, as the page or its worker runs it. A type-curve job
// gives the fit without its model, which is a function and cannot be sent from a worker,
// and the model's values at each list of job.times; a van der Kamp (1976) job gives the
// analysis with its fitted curve as numbers (analyseVanDerKampData).
import { fitSlug } from '../../../engine/slug.js';
import { analyseVanDerKampData } from '../../../engine/slug-vanderkamp.js';

export function runSlugJob(job, progress = () => {}) {
  if (job.kind === 'vdk') return { analysis: analyseVanDerKampData(job.t, job.y, job.geo, { ...job.options, progress: (p) => progress({ ...p, vdk: true }) }) };
  const { model, ...fit } = fitSlug(job.kind, job.t, job.y, job.geo, job.hold, progress);
  return { fit, curves: job.times.map((x) => model(x)) };
}
