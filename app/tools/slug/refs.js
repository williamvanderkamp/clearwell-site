// The works the slug test page cites: REF, keyed as the examples' notes (examples.js) and
// the checks (citesIn in practice.js) name them, and each method's own, REFS.
// The works other pages cite too come from src/engine/refs.js.
import { BATES_WATTS_1988_DOI, DE_HOOG_ET_AL_1982_DOI, HILL_1998_90_P, HVORSLEV_1951, KRUSEMAN_DE_RIDDER_1994, LEVENBERG_1944_DOI, MARQUARDT_1963_DOI, STEHFEST_1970_DOI } from '../../../engine/refs.js';

// Each method lists only the works its text cites.
const REF = {
  bouwer: 'Bouwer, H. (1989) The Bouwer and Rice slug test: an update. Ground Water 27(3), 304-309.',
  bouwerRice: 'Bouwer, H., and Rice, R.C. (1976) A slug test for determining hydraulic conductivity of unconfined aquifers with completely or partially penetrating wells. Water Resources Research 12(3), 423-428.',
  butler: 'Butler, J.J., Jr. (1998) The Design, Performance, and Analysis of Slug Tests. Lewis Publishers, Boca Raton, Florida, 252 p.',
  butlerGarnett: 'Butler, J.J., Jr., and Garnett, E.J. (2000) Simple procedures for analysis of slug tests in formations of high hydraulic conductivity using spreadsheet and scientific graphics software. Kansas Geological Survey Open-File Report 2000-40, Lawrence, Kansas.',
  batesWatts: BATES_WATTS_1988_DOI,
  butlerMcElweeLiu: 'Butler, J.J., Jr., McElwee, C.D., and Liu, W. (1996) Improving the quality of parameter estimates obtained from slug tests. Ground Water 34(3), 480-490. doi:10.1111/j.1745-6584.1996.tb02029.x (Read in its preprint, Kansas Geological Survey Open-File Report 95-75, section III.E.)',
  butlerHealey: 'Butler, J.J., Jr., and Healey, J.M. (1999) Performance and analysis of June 1998 and October 1999 slug tests in Kearny, Finney, and Ford Counties, Kansas. Kansas Geological Survey Open-File Report 1999-8, Lawrence, Kansas.',
  butlerMcElwee: 'Butler, J.J., Jr., and McElwee, C.D. (1996) Well-testing methodologies for characterizing heterogeneities in alluvial-aquifer systems: final technical report. Kansas Geological Survey Open-File Report 95-75, Lawrence, Kansas.',
  butlerRecovery: 'Butler, J.J., Jr. (1997) Theoretical analysis of impact of incomplete recovery of slug tests. Kansas Geological Survey Open-File Report 97-59, Lawrence, Kansas.',
  butler2019: 'Butler, J.J., Jr. (2019) The Design, Performance, and Analysis of Slug Tests, 2nd edition. CRC Press, Boca Raton, Florida. (Chapter 1, as the author posts it at the Kansas Geological Survey.)',
  cunninghamSchalk: 'Cunningham, W.L., and Schalk, C.W., comps. (2011) Groundwater technical procedures of the U.S. Geological Survey: GWPD 17, Conducting an instantaneous change in head (slug) test with a mechanical slug and submersible pressure transducer. U.S. Geological Survey Techniques and Methods 1-A1.',
  hydrosolveDsl: 'HydroSOLVE, Inc. Double straight-line effect. AQTESOLV documentation, http://www.aqtesolv.com/slug-tests/double-straight-line-effect.htm.',
  butlerZhan: 'Butler, J.J., Jr., and Zhan, X. (2004) Hydraulic tests in highly permeable aquifers. Water Resources Research 40(12), W12402. doi:10.1029/2003WR002998',
  cochraneOrcutt: 'Cochrane, D., and Orcutt, G.H. (1949) Application of least squares regression to relationships containing auto-correlated error terms. Journal of the American Statistical Association 44(245), 32-61.',
  cooper1965: 'Cooper, H.H., Jr., Bredehoeft, J.D., Papadopulos, I.S., and Bennett, R.R. (1965) The response of well-aquifer systems to seismic waves. Journal of Geophysical Research 70, 3915-3926.',
  cooper: 'Cooper, H.H., Jr., Bredehoeft, J.D., and Papadopulos, I.S. (1967) Response of a finite-diameter well to an instantaneous charge of water. Water Resources Research 3(1), 263-269. doi:10.1029/WR003i001p00263',
  deHoog: DE_HOOG_ET_AL_1982_DOI,
  hill: HILL_1998_90_P,
  hvorslev: HVORSLEV_1951,
  hydrosolve: 'HydroSOLVE, Inc. Tutorial for slug test in unconfined aquifer. AQTESOLV documentation, http://www.aqtesolv.com/examples/uncslug1.htm.',
  hyder: 'Hyder, Z., Butler, J.J., Jr., McElwee, C.D., and Liu, W. (1994) Slug tests in partially penetrating wells. Water Resources Research 30(11), 2945-2957. doi:10.1029/94WR01670',
  levenberg: LEVENBERG_1944_DOI,
  marquardt: MARQUARDT_1963_DOI,
  kipp: 'Kipp, K.L., Jr. (1985) Type curve analysis of inertial effects in the response of a well to a slug test. Water Resources Research 21(9), 1397-1408. doi:10.1029/WR021i009p01397',
  kruseman: KRUSEMAN_DE_RIDDER_1994,
  lohman: 'Lohman, S.W. (1972) Ground-water hydraulics. U.S. Geological Survey Professional Paper 708, 70 p. doi:10.3133/pp708',
  mcElweeZenner: 'McElwee, C.D., and Zenner, M.A. (1998) A nonlinear model for analysis of slug-test data. Water Resources Research 34(1), 55-66. doi:10.1029/97WR02710',
  mcElwee: 'McElwee, C.D., and Butler, J.J., Jr. (1994) Characterization of heterogeneities controlling transport and fate of pollutants in unconsolidated sand and gravel aquifers: third year report, section II.A and appendices A and B. Kansas Geological Survey Open-File Report 94-32, Lawrence, Kansas.',
  praisWinsten: 'Prais, S.J., and Winsten, C.B. (1954) Trend estimators and serial correlation. Cowles Commission Discussion Paper Statistics No. 383, Chicago.',
  papadopulos: 'Papadopulos, S.S., Bredehoeft, J.D., and Cooper, H.H., Jr. (1973) On the analysis of "slug test" data. Water Resources Research 9(4), 1087-1089. doi:10.1029/WR009i004p01087',
  rsat: 'RSAT 0.2.2, Rising head Slug test Analysis Tool. Vrije Universiteit Brussel (github.com/VUB-HYDR/RSAT). Its polynomial fits to Bouwer and Rice (1976) Figure 3 give A, B and C.',
  springerGelhar: 'Springer, R.K., and Gelhar, L.W. (1991) Characterization of large-scale aquifer heterogeneity in glacial outwash by analysis of slug tests with oscillatory responses, Cape Cod, Massachusetts. In Mallard, G.E., and Aronson, D.A., eds., U.S. Geological Survey Toxic Substances Hydrology Program: Proceedings of the technical meeting, Monterey, California, March 11-15, 1991. U.S. Geological Survey Water-Resources Investigations Report 91-4034, 36-40.',
  vanDerKamp: 'van der Kamp, G. (1976) Determining aquifer transmissivity by means of well response tests: The underdamped case. Water Resources Research 12(1), 71-77.',
  stehfest: STEHFEST_1970_DOI,
  zhanButler: 'Zhan, X., and Butler, J.J., Jr. (2003) Mathematical derivations of semianalytical solutions for hydraulic tests in highly permeable aquifers. Kansas Geological Survey Open-File Report 2003-60, Lawrence, Kansas.',
  zlotnik: 'Zlotnik, V. (1994) Interpretation of slug and packer tests in anisotropic aquifers. Ground Water 32(5), 761-766. doi:10.1111/j.1745-6584.1994.tb00917.x',
};
const REFS = {
  hvorslev: [REF.bouwer, REF.butler, REF.hvorslev],
  bouwerRice: [REF.bouwer, REF.bouwerRice, REF.butler, REF.rsat, REF.zlotnik],
  // The type-curve methods also cite the Levenberg-Marquardt method that fits them.
  cbp: [REF.cooper, REF.deHoog, REF.kruseman, REF.levenberg, REF.lohman, REF.marquardt, REF.papadopulos],
  kgs: [REF.cooper, REF.hyder, REF.levenberg, REF.marquardt, REF.mcElwee, REF.stehfest],
  highKHvorslev: [REF.butler, REF.butlerGarnett, REF.hvorslev, REF.levenberg, REF.marquardt, REF.zlotnik],
  springerGelhar: [REF.bouwerRice, REF.butlerGarnett, REF.levenberg, REF.marquardt, REF.rsat, REF.springerGelhar, REF.zlotnik],
  butlerZhan: [REF.butler, REF.butlerZhan, REF.deHoog, REF.hyder, REF.kipp, REF.levenberg, REF.marquardt, REF.zhanButler],
  vanDerKamp: [REF.batesWatts, REF.butlerGarnett, REF.butlerMcElweeLiu, REF.butlerZhan, REF.cochraneOrcutt, REF.cooper1965, REF.hill, REF.kipp, REF.kruseman, REF.levenberg, REF.marquardt, REF.mcElweeZenner, REF.praisWinsten, REF.vanDerKamp],
};
// The method's works, those the example's note cites, and those the method text and the
// checks cite (citesIn, practice.js), in alphabetical order.
export const referencesFor = (method, example, cites = []) => [...new Set([...REFS[method], ...[...(example?.cites || []), ...cites].map((k) => REF[k])])].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
