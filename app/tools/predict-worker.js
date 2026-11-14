// Works out one prediction for the predict page off the main thread, as solutions/worker.js
// does for the fits: the drawdowns, their range over the intervals and the steady
// drawdown (runPrediction in predict-run.js).
import { serveJob } from '../worker-job.js';
import { runPrediction } from './predict-run.js';

serveJob((job) => runPrediction(job));
