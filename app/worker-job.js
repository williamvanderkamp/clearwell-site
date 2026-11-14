// One piece of long work run in a Web Worker, so the page stays live: the slug and pumping
// fits, a prediction, the well record's correction, the flow model's run and calibration
// (docs/design/workers.md). startJob is the page's side and serveJob the worker's.
//
// The worker answers with { progress }, { step } or, last, { res } or { error }, the error
// with whatever else it carries. Where a worker cannot start (no url, or no Worker, as in
// Node), or fails to load, which it says only as an error before its first message, the
// work is done on the page instead: fallback(), after delay ms, so the page has a moment to
// draw what it shows meanwhile. With no fallback, as for the model's calibration, that is
// an error. An error after the worker's first message is the work's own, and rejects.

/**
 * Starts msg in a module worker made from url. Gives { promise, stop }: a promise of the
 * worker's res, or of fallback()'s value, and a stop that ends the work if it is still
 * going, after which the promise never settles and no progress comes. Aborting signal, the
 * tool's teardown signal (mount(host, signal)), stops it too. The promise rejects with an
 * Error of the worker's error message that has the rest of what it posted with it as its
 * own fields, such as the model run's code, where and result. onProgress and onStep get
 * each progress and step the worker posts; transfer is postMessage's; failed is the message
 * for an error the worker gives no words to.
 */
export function startJob(url, msg, { onProgress = () => {}, onStep = () => {}, fallback, transfer = [], signal, delay = 30, failed = 'The work stopped with an error.' } = {}) {
  let worker = null, timer = null;
  const end = () => {
    if (worker) worker.terminate();
    clearTimeout(timer);
    worker = null; timer = null;
    if (signal) signal.removeEventListener('abort', end);
  };
  const promise = new Promise((resolve, reject) => {
    if (signal && signal.aborted) return;
    if (signal) signal.addEventListener('abort', end);
    const here = (e) => {
      if (!fallback) { end(); reject(new Error((e && e.message) || failed)); return; }
      timer = setTimeout(() => {
        timer = null;
        end();
        try {
          resolve(fallback());
        } catch (err) {
          reject(err);
        }
      }, delay);
    };
    if (!url) { here(); return; }
    try {
      worker = new Worker(url, { type: 'module' });
    } catch (e) {
      here(e);
      return;
    }
    // Once stopped, or settled, this worker is no longer the job's, and whatever it still
    // says goes unheard.
    const mine = worker;
    let heard = false;
    mine.onmessage = (e) => {
      if (worker !== mine) return;
      heard = true;
      if (e.data.progress) { onProgress(e.data.progress); return; }
      if (e.data.step) { onStep(e.data.step); return; }
      end();
      if (e.data.error) {
        const { error, ...more } = e.data;
        reject(Object.assign(new Error(error), more));
      } else resolve(e.data.res);
    };
    // A worker that fails to load says nothing; the work is then done on the page.
    mine.onerror = (e) => {
      if (worker !== mine) return;
      if (heard) { end(); reject(new Error(e.message || failed)); return; }
      mine.terminate();
      worker = null;
      here(e);
    };
    mine.postMessage(msg, transfer);
  });
  return { promise, stop: end };
}

/**
 * The worker's side: fn(data, { progress, step }) for each message, its value posted as
 * { res }, or its error as { error }. progress(p) posts { progress: p }, and step(s,
 * transfer) posts { step: s }. transfer(res) gives the result's transferables, and
 * details(err) what else to post with an error's message, such as the model run's code,
 * where and result so far.
 */
export function serveJob(fn, { transfer = () => [], details = () => ({}) } = {}) {
  const progress = (p) => self.postMessage({ progress: p });
  const step = (s, list = []) => self.postMessage({ step: s }, list);
  self.onmessage = (e) => {
    try {
      const res = fn(e.data, { progress, step });
      self.postMessage({ res }, transfer(res));
    } catch (err) {
      self.postMessage({ ...details(err), error: err.message });
    }
  };
}
