// Rewetting of dry cells under the standard formulation: NPF's REWET option with WETFCT, IWETIT
// and IHDWET, and the WETDRY array (gwf-npf.dfn 6.7.0), as MODFLOW 6 6.7.0 does it
// (src/Model/GroundWaterFlow/gwf-npf.f90: sgwf_npf_wetdry, rewet_check, npf_ad). The method
// is MODFLOW's since McDonald and others (1991, USGS Open-File Report 91-536):
// a dry cell is made wet again when the head in a neighbour reaches its bottom plus |WETDRY|,
// and its head is set from that neighbour's head (IHDWET 0) or from the threshold (IHDWET not 0).
//
// The model JSON: npf.rewet = { wetfct, iwetit, ihdwet }, and npf.wetdry, per layer, a number
// or nrow*ncol values: 0 for a cell that cannot be wetted; above 0, wetted by the cell below or
// a horizontal neighbour; below 0, by the cell below only (by a vertical neighbour, as
// rewet_check is written). Pure JavaScript with no DOM.
import { perLayer } from './grid.js';

const HDRY = -1e30;   // Constants.f90 DHDRY, the head MODFLOW 6 gives a dry cell
// MODFLOW 6 marks a cell wetted in this pass with ibound 30000; ibound here is an Int8Array.
const WETTED = 2;

/** null when the model has no REWET; otherwise its wetting, after checking it. */
export function createRewet(model, g) {
  const npf = model.npf || {};
  if (npf.rewet === undefined || npf.rewet === null) {
    if (npf.wetdry !== undefined && npf.wetdry !== null) throw new Error('npf.wetdry is given but npf.rewet is not: MODFLOW 6 reads WETDRY but uses it only with REWET.');
    return null;
  }
  const r = npf.rewet;
  if (typeof r !== 'object' || !(typeof r.wetfct === 'number' && Number.isFinite(r.wetfct))) throw new Error('npf.rewet needs wetfct (REWET WETFCT), a number.');
  // gwf-npf.dfn says an IWETIT of 0 or less becomes 1, but 6.7.0 does not change it, and would
  // take mod(kiter, 0): it is refused rather than guessed.
  if (!(Number.isInteger(r.iwetit) && r.iwetit >= 1)) throw new Error('npf.rewet.iwetit (REWET IWETIT) must be a whole number of at least 1.');
  if (!Number.isInteger(r.ihdwet)) throw new Error('npf.rewet.ihdwet (REWET IHDWET) must be a whole number: 0 for the neighbour\'s head, any other for the threshold.');
  if (npf.wetdry === undefined || npf.wetdry === null) throw new Error('REWET needs npf.wetdry (the WETDRY array), as MODFLOW 6 requires.');
  if (model.newton) throw new Error('Rewetting (REWET) cannot be used with the Newton-Raphson formulation, as MODFLOW 6 refuses it.');
  const { N, ncol, ncpl, bot, csE, csS, csD, domain } = g;
  const wetdry = perLayer(npf.wetdry, g.nlay, ncpl, 'npf.wetdry', ncol);
  const { wetfct, iwetit, ihdwet } = r;

  // rewet_check for cell n against neighbour m (vertical when vert).
  function check(kiter, n, m, vert, ibound, x) {
    if (kiter % iwetit !== 0 || ibound[n] !== 0 || wetdry[n] === 0) return;
    const wd = wetdry[n], awd = Math.abs(wd), turnon = bot[n] + awd, hm = x[m];
    const wet = vert ? ibound[m] > 0 && hm >= turnon : wd > 0 && ibound[m] > 0 && hm >= turnon;
    if (!wet) return;
    x[n] = ihdwet === 0 ? bot[n] + wetfct * (hm - bot[n]) : bot[n] + wetfct * awd;
    ibound[n] = WETTED;
  }

  return {
    /**
     * The wetting half of sgwf_npf_wetdry, before its drying: every dry wettable cell against
     * each neighbour in MODFLOW 6's order (below and above by layer, then by row, then by
     * column), a cell just wetted counting as wet for those after it. Returns the cells
     * wetted; their ibound is WETTED (MODFLOW 6's 30000) until the drying half has run (done()).
     */
    wet(kiter, ibound, x) {
      for (let n = 0; n < N; n++) {
        if (!domain[n]) continue;
        // Vertical neighbours past pass-through cells, as DIS connects them.
        const up = g.above[n], dn = g.down[n];
        if (up >= 0 && csD[up] > 0) check(kiter, n, up, true, ibound, x);
        if (n - ncol >= 0 && csS[n - ncol] > 0) check(kiter, n, n - ncol, false, ibound, x);
        if (n - 1 >= 0 && csE[n - 1] > 0) check(kiter, n, n - 1, false, ibound, x);
        if (n + 1 < N && csE[n] > 0) check(kiter, n, n + 1, false, ibound, x);
        if (n + ncol < N && csS[n] > 0) check(kiter, n, n + ncol, false, ibound, x);
        if (dn >= 0 && csD[n] > 0) check(kiter, n, dn, true, ibound, x);
      }
    },
    /** The end of sgwf_npf_wetdry: wetted cells become variable head. */
    done(ibound, dry) {
      for (let n = 0; n < N; n++) if (ibound[n] === WETTED) { ibound[n] = 1; dry[n] = 0; }
    },
    /** npf_ad at the start of a time step: a dry wettable cell starts from its bottom, at HDRY. */
    advance(ibound, x, hold) {
      for (let n = 0; n < N; n++) {
        if (!domain[n] || wetdry[n] === 0 || ibound[n] !== 0) continue;
        hold[n] = bot[n];
        x[n] = HDRY;
      }
    },
    HDRY,
  };
}
