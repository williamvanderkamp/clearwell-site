// Runs one fit for the slug test page off the main thread, as solutions/worker.js does
// for the pumping fits: a type-curve fit, or van der Kamp's (1976) analysis (jobs.js).
import { serveJob } from '../../worker-job.js';
import { runSlugJob } from './jobs.js';

serveJob((job, { progress }) => runSlugJob(job, progress));
