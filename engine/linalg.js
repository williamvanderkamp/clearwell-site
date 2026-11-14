// Linear algebra on small flat symmetric matrices.
// Not numeric.js's solveSPD, which solves by other arithmetic and gives other last bits.

/**
 * The inverse of a symmetric positive definite k x k matrix (flat), by Cholesky after
 * scaling to a unit diagonal. Returns { inv, weak }, where weak lists the columns that
 * are (near) combinations of earlier ones, so the data cannot fix them; inv is null then.
 */
export function invertSPD(A, k) {
  const d = Array.from({ length: k }, (_, i) => Math.sqrt(A[i * k + i]));
  const weak = d.map((x, i) => (x > 0 && Number.isFinite(x) ? -1 : i)).filter((i) => i >= 0);
  if (weak.length) return { inv: null, weak };
  const L = new Float64Array(k * k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) L[i * k + j] = A[i * k + j] / (d[i] * d[j]);
  for (let j = 0; j < k; j++) {
    let v = L[j * k + j];
    for (let m = 0; m < j; m++) v -= L[j * k + m] * L[j * k + m];
    // Pivot as a share of the column's own size: below 1e-12 it is lost to rounding.
    if (!(v > 1e-12)) weak.push(j);
    v = Math.sqrt(Math.max(v, 1e-300));
    L[j * k + j] = v;
    for (let i = j + 1; i < k; i++) {
      let w = L[i * k + j];
      for (let m = 0; m < j; m++) w -= L[i * k + m] * L[j * k + m];
      L[i * k + j] = w / v;
    }
  }
  if (weak.length) return { inv: null, weak };
  // Columns of the inverse, one solve each.
  const inv = new Float64Array(k * k);
  for (let c = 0; c < k; c++) {
    const x = new Float64Array(k);
    x[c] = 1;
    for (let i = 0; i < k; i++) { let w = x[i]; for (let m = 0; m < i; m++) w -= L[i * k + m] * x[m]; x[i] = w / L[i * k + i]; }
    for (let i = k - 1; i >= 0; i--) { let w = x[i]; for (let m = i + 1; m < k; m++) w -= L[m * k + i] * x[m]; x[i] = w / L[i * k + i]; }
    for (let i = 0; i < k; i++) inv[i * k + c] = x[i] / (d[i] * d[c]);
  }
  return { inv, weak: [] };
}

/**
 * The eigenvalues and eigenvectors of a symmetric k x k matrix (flat), by the cyclic
 * Jacobi method (Golub and Van Loan 1996, section 8.4). Returns { values, vectors }, with
 * vectors[i] the unit eigenvector of values[i]. For the few values of a fit, k is small.
 */
export function symmetricEigen(A, k) {
  const a = Float64Array.from(A);
  const v = new Float64Array(k * k);
  for (let i = 0; i < k; i++) v[i * k + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0, diag = 0;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) (i === j ? (diag += a[i * k + j] * a[i * k + j]) : (off += a[i * k + j] * a[i * k + j]));
    if (off <= 1e-30 * diag || off === 0) break;
    for (let p = 0; p < k - 1; p++) for (let q = p + 1; q < k; q++) {
      const apq = a[p * k + q];
      if (apq === 0) continue;
      const theta = (a[q * k + q] - a[p * k + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let m = 0; m < k; m++) {
        const amp = a[m * k + p], amq = a[m * k + q];
        a[m * k + p] = c * amp - s * amq; a[m * k + q] = s * amp + c * amq;
      }
      for (let m = 0; m < k; m++) {
        const apm = a[p * k + m], aqm = a[q * k + m];
        a[p * k + m] = c * apm - s * aqm; a[q * k + m] = s * apm + c * aqm;
      }
      for (let m = 0; m < k; m++) {
        const vmp = v[m * k + p], vmq = v[m * k + q];
        v[m * k + p] = c * vmp - s * vmq; v[m * k + q] = s * vmp + c * vmq;
      }
    }
  }
  return { values: Array.from({ length: k }, (_, i) => a[i * k + i]), vectors: Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, m) => v[m * k + i])) };
}

// An eigenvalue of J'J, scaled to a unit diagonal, at or below this is lost to rounding:
// the direction it belongs to changes the computed drawdown by nothing measurable.
const NULL_EIGEN = 1e-10;
// A value takes part in such a direction when its share of it is above this.
const NULL_SHARE = 1e-3;

/**
 * The covariance factor (J'J)^-1 when it exists, and otherwise the pseudo-inverse over the
 * directions the readings do fix. J'J has no inverse when some combination of the values
 * leaves the computed drawdown unchanged: its null space. A value is not determined only
 * when that null space touches it; every other value is a function of the readings, and
 * its variance from the pseudo-inverse is exact (for a model linear near the minimum),
 * however the undetermined ones are set. Returns { inv, weak, rank, nulls }: weak lists the
 * columns not determined, and nulls the null directions on the fit scale, each { index:
 * share } over the columns it touches.
 */
export function covarianceFactor(A, k) {
  const full = invertSPD(A, k);
  if (full.inv) return { inv: full.inv, weak: [], rank: k, nulls: [] };
  const d = Array.from({ length: k }, (_, i) => Math.sqrt(A[i * k + i]));
  // A value that does not change the drawdown at all has a zero column of its own.
  const dead = d.map((x, i) => (x > 0 && Number.isFinite(x) ? -1 : i)).filter((i) => i >= 0);
  const live = d.map((_, i) => i).filter((i) => !dead.includes(i));
  const m = live.length;
  const C = new Float64Array(m * m);
  live.forEach((i, a) => live.forEach((j, b) => { C[a * m + b] = A[i * k + j] / (d[i] * d[j]); }));
  const { values, vectors } = symmetricEigen(C, m);
  const nulls = dead.map((i) => ({ [i]: 1 }));
  const weak = new Set(dead);
  const inv = new Float64Array(k * k);
  values.forEach((lambda, e) => {
    const vec = vectors[e];
    if (lambda <= NULL_EIGEN) {
      // On the fit scale the direction is vec_a / d_a; the share is kept as found.
      const touched = {};
      vec.forEach((x, a) => { if (Math.abs(x) > NULL_SHARE) { touched[live[a]] = x / d[live[a]]; weak.add(live[a]); } });
      nulls.push(touched);
      return;
    }
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) inv[live[a] * k + live[b]] += (vec[a] * vec[b]) / (lambda * d[live[a]] * d[live[b]]);
  });
  // Rounding can leave Cholesky refusing a matrix whose smallest eigenvalue is just above
  // the line: then the smallest direction is the null one.
  if (nulls.length === dead.length && m && !invertSPD(C, m).inv) {
    const e = values.indexOf(Math.min(...values)), vec = vectors[e], touched = {};
    vec.forEach((x, a) => { if (Math.abs(x) > NULL_SHARE) { touched[live[a]] = x / d[live[a]]; weak.add(live[a]); } });
    nulls.push(touched);
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) inv[live[a] * k + live[b]] -= (vec[a] * vec[b]) / (values[e] * d[live[a]] * d[live[b]]);
  }
  return { inv, weak: [...weak].sort((x, y) => x - y), rank: m - (nulls.length - dead.length), nulls };
}
