// NPF's options for the vertical connection, beyond MODFLOW 6's defaults: VARIABLECV (with
// DEWATERED) and PERCHED. See docs/tools/model.md. The formulas are MODFLOW 6 6.7.0's: vcond in
// GwfConductanceUtils.f90 and npf_fc and sgwf_npf_qcalc in gwf-npf.f90.

/**
 * The vertical conductance between cell n and the cell m below it, with VARIABLECV (vcond with
 * ivarcv 1): the saturated value while both cells are confined, or both full; otherwise from
 * half of each cell's thickness over its K33, the upper cell's taken as saturated fraction ×
 * thickness. Without DEWATERED the lower cell counts as full; with it, a lower cell that is not
 * full adds nothing. sat is each cell's saturated fraction (1 for a confined cell, its starting
 * fraction with THICKSTRT), h the heads.
 */
export function variableCv(g, n, m, h, sat, dewatered, csat) {
  const { icelltype, top, bot, kv, area } = g;
  if (!icelltype[n] && !icelltype[m]) return csat;
  if (h[n] >= top[n] && h[m] >= top[m]) return csat;
  let sn = sat[n], sm = sat[m];
  // n is the upper cell, so bot[n] > bot[m] in vcond's test.
  if (!dewatered) sm = 1;
  else if (sm < 1) sm = 0;
  const b = sn * (top[n] - bot[n]) * 0.5 / kv[n] + sm * (top[m] - bot[m]) * 0.5 / kv[m];
  return b !== 0 ? area[n] / b : 0;
}

/**
 * PERCHED (npf_fc): whether the connection of cell n with the convertible cell m below it is
 * perched, m's head being below its top. Then the flow from n to m is C (h(n) − bot(n)), as if
 * the head below stood at n's bottom, whatever m's head (sgwf_npf_qcalc).
 */
export const isPerched = (g, m, h) => g.icelltype[m] !== 0 && h[m] < g.top[m];
