// The works that more than one file cites, each as its reference list prints it. A
// reference cited in one file only stays in that file. The engine's solutions and
// water-table.js take these too, so they live in the engine, which imports nothing from
// the app.
//
// Where the files cited a work in more than one form, each form is kept, named for what
// sets it apart (STEHFEST_1970 and STEHFEST_1970_DOI). Unifying them is William's call:
// it changes the text of the pages and workbooks that list them, and the fitting page
// and withCommentReferences (water-table.js) tell references apart by their text.

export const ABRAMOWITZ_STEGUN_1964 = 'Abramowitz, M., and Stegun, I.A. (1964) Handbook of Mathematical Functions with Formulas, Graphs, and Mathematical Tables. National Bureau of Standards, Applied Mathematics Series 55.';
export const BARKER_1988 = 'Barker, J.A. (1988) A generalized radial flow model for hydraulic tests in fractured rock. Water Resources Research 24(10), 1796-1804.';
export const BARLOW_MOENCH_1998 = 'Barlow, P.M., and Moench, A.F. (1998) Analytical solutions and computer programs for hydraulic interaction of stream-aquifer systems. U.S. Geological Survey Open-File Report 98-415A.';
// Two forms: "WTAQ, a computer program" and "WTAQ: A computer program".
export const BARLOW_MOENCH_1999 = 'Barlow, P.M., and Moench, A.F. (1999) WTAQ, a computer program for calculating drawdowns and estimating hydraulic properties for confined and water-table aquifers. U.S. Geological Survey Water-Resources Investigations Report 99-4225.';
export const BARLOW_MOENCH_1999_COLON = 'Barlow, P.M., and Moench, A.F. (1999) WTAQ: A computer program for calculating drawdowns and estimating hydraulic properties for confined and water-table aquifers. U.S. Geological Survey Water-Resources Investigations Report 99-4225.';
// Two forms: the book with its place and doi, and its chapter 6 with the pages.
export const BATES_WATTS_1988_DOI = 'Bates, D.M., and Watts, D.G. (1988) Nonlinear Regression Analysis and Its Applications. Wiley, New York. doi:10.1002/9780470316757';
export const BATES_WATTS_1988_CHAPTER_6 = 'Bates, D.M., and Watts, D.G. (1988) Nonlinear Regression Analysis and Its Applications. Wiley. Chapter 6, Graphical summaries of nonlinear inference regions, 200-231. doi:10.1002/9780470316757.';
// Two forms: without and with the doi.
export const BOURDET_ET_AL_1989 = 'Bourdet, D., Ayoub, J.A., and Pirard, Y.M. (1989) Use of pressure derivative in well-test interpretation. SPE Formation Evaluation 4(2), 293-302.';
export const BOURDET_ET_AL_1989_DOI = 'Bourdet, D., Ayoub, J.A., and Pirard, Y.M. (1989) Use of pressure derivative in well-test interpretation. SPE Formation Evaluation 4(2), 293-302. doi:10.2118/12777-PA.';
export const CLARK_1967 = 'Clark, W.E. (1967) Computing the barometric efficiency of a well. Journal of the Hydraulics Division, ASCE 93(HY4), 93-98.';
// Two forms: without and with the doi. water-table.js adds how it was read to the first.
export const COOPER_JACOB_1946 = 'Cooper, H.H., Jr., and Jacob, C.E. (1946) A generalized graphical method for evaluating formation constants and summarizing well-field history. Transactions, American Geophysical Union 27(4), 526-534.';
export const COOPER_JACOB_1946_DOI = 'Cooper, H.H., Jr., and Jacob, C.E. (1946) A generalized graphical method for evaluating formation constants and summarizing well-field history. Transactions, American Geophysical Union 27(4), 526-534. doi:10.1029/TR027i004p00526.';
// Two forms: without and with the doi.
export const DE_HOOG_ET_AL_1982 = 'de Hoog, F.R., Knight, J.H., and Stokes, A.N. (1982) An improved method for numerical inversion of Laplace transforms. SIAM Journal on Scientific and Statistical Computing 3(3), 357-366.';
export const DE_HOOG_ET_AL_1982_DOI = 'de Hoog, F.R., Knight, J.H., and Stokes, A.N. (1982) An improved method for numerical inversion of Laplace transforms. SIAM Journal on Scientific and Statistical Computing 3(3), 357-366. doi:10.1137/0903022';
export const DE_RIDDER_1961 = 'De Ridder, N.A. (1961) The hydraulic characteristics of the Tielerwaard calculated from pumping test data (in Dutch). Institute for Land and Water Management Research, Wageningen, Report 83.';
export const DE_RIDDER_1966 = 'De Ridder, N.A. (1966) Analysis of the pumping test \'De Vennebulten\' near Varsseveld (in Dutch). Institute for Land and Water Management Research, Wageningen, Report 335.';
// Two forms: without and with the 1985 correction.
export const DOUGHERTY_BABU_1984 = 'Dougherty, D.E., and Babu, D.K. (1984) Flow to a partially penetrating well in a double-porosity reservoir. Water Resources Research 20(8), 1116-1122.';
export const DOUGHERTY_BABU_1984_CORRECTION = 'Dougherty, D.E., and Babu, D.K. (1984) Flow to a partially penetrating well in a double-porosity reservoir. Water Resources Research 20(8), 1116-1122. Correction: Water Resources Research 21(2), 265 (1985).';
// Two forms: without and with the pages.
export const FERRIS_ET_AL_1962 = 'Ferris, J.G., Knowles, D.B., Brown, R.H., and Stallman, R.W. (1962) Theory of aquifer tests. U.S. Geological Survey Water-Supply Paper 1536-E.';
export const FERRIS_ET_AL_1962_PAGES = 'Ferris, J.G., Knowles, D.B., Brown, R.H., and Stallman, R.W. (1962) Theory of aquifer tests. U.S. Geological Survey Water-Supply Paper 1536-E, 69-174.';
export const FREEZE_CHERRY_1979 = 'Freeze, R.A., and Cherry, J.A. (1979) Groundwater. Prentice-Hall, Englewood Cliffs, New Jersey, 604 p.';
export const HANTUSH_1956 = 'Hantush, M.S. (1956) Analysis of data from pumping tests in leaky aquifers. Transactions, American Geophysical Union 37(6), 702-714.';
export const HANTUSH_1960 = 'Hantush, M.S. (1960) Modification of the theory of leaky aquifers. Journal of Geophysical Research 65(11), 3713-3725.';
export const HANTUSH_1961A = 'Hantush, M.S. (1961a) Drawdown around a partially penetrating well. Journal of the Hydraulics Division, Proceedings of the American Society of Civil Engineers 87(HY4), 83-98.';
// Two forms: "In Chow, V.T., ed., ... volume 1 ... 281-442" and "In: Chow, V.T. (ed.)
// ... Volume 1 ... 281-432". The last page differs too.
export const HANTUSH_1964 = 'Hantush, M.S. (1964) Hydraulics of wells. In Chow, V.T., ed., Advances in Hydroscience, volume 1. Academic Press, New York, 281-442.';
export const HANTUSH_1964_IN_COLON = 'Hantush, M.S. (1964) Hydraulics of wells. In: Chow, V.T. (ed.) Advances in Hydroscience, Volume 1. Academic Press, New York, 281-432.';
export const HANTUSH_JACOB_1955 = 'Hantush, M.S., and Jacob, C.E. (1955) Non-steady radial flow in an infinite leaky aquifer. Transactions, American Geophysical Union 36(1), 95-100.';
// Three forms here: the title in capitals, in capitals with the pages, and in lower case.
// The model page's calibration panel (src/app/tools/model/calibrate.js) has a fourth,
// with the full title and the doi.
export const HILL_1998 = 'Hill, M.C. (1998) Methods and Guidelines for Effective Model Calibration. U.S. Geological Survey Water-Resources Investigations Report 98-4005.';
export const HILL_1998_90_P = 'Hill, M.C. (1998) Methods and Guidelines for Effective Model Calibration. U.S. Geological Survey Water-Resources Investigations Report 98-4005, 90 p.';
export const HILL_1998_LOWER_CASE = 'Hill, M.C. (1998) Methods and guidelines for effective model calibration. U.S. Geological Survey Water-Resources Investigations Report 98-4005.';
// Two forms: the Waterways Experiment Station before or after the U.S. Army Corps of
// Engineers.
export const HVORSLEV_1951 = 'Hvorslev, M.J. (1951) Time lag and soil permeability in ground-water observations. Bulletin 36, Waterways Experiment Station, U.S. Army Corps of Engineers, Vicksburg, Mississippi.';
export const HVORSLEV_1951_CORPS_FIRST = 'Hvorslev, M.J. (1951) Time lag and soil permeability in ground-water observations. Bulletin 36, U.S. Army Corps of Engineers, Waterways Experiment Station, Vicksburg, Mississippi.';
export const KRUSEMAN_DE_RIDDER_1994 = 'Kruseman, G.P., and de Ridder, N.A. (1994) Analysis and Evaluation of Pumping Test Data, 2nd edition. Publication 47, International Institute for Land Reclamation and Improvement, Wageningen.';
// Two forms: without and with the doi.
export const LEVENBERG_1944 = 'Levenberg, K. (1944) A method for the solution of certain non-linear problems in least squares. Quarterly of Applied Mathematics 2(2), 164-168.';
export const LEVENBERG_1944_DOI = 'Levenberg, K. (1944) A method for the solution of certain non-linear problems in least squares. Quarterly of Applied Mathematics 2(2), 164-168. doi:10.1090/qam/10666';
// Two forms: without and with the doi.
export const MARQUARDT_1963 = 'Marquardt, D.W. (1963) An algorithm for least-squares estimation of nonlinear parameters. Journal of the Society for Industrial and Applied Mathematics 11(2), 431-441.';
export const MARQUARDT_1963_DOI = 'Marquardt, D.W. (1963) An algorithm for least-squares estimation of nonlinear parameters. Journal of the Society for Industrial and Applied Mathematics 11(2), 431-441. doi:10.1137/0111030';
// water-table.js adds how much of these was read.
export const MOENCH_1995 = 'Moench, A.F. (1995) Combining the Neuman and Boulton models for flow to a well in an unconfined aquifer. Ground Water 33(3), 378-384.';
export const MOENCH_1997 = 'Moench, A.F. (1997) Flow to a well of finite diameter in a homogeneous, anisotropic water table aquifer. Water Resources Research 33(6), 1397-1407.';
export const NEUMAN_1972 = 'Neuman, S.P. (1972) Theory of flow in unconfined aquifers considering delayed response of the water table. Water Resources Research 8(4), 1031-1045.';
export const NEUMAN_1974 = 'Neuman, S.P. (1974) Effect of partial penetration on flow in unconfined aquifers considering delayed gravity response. Water Resources Research 10(2), 303-312.';
export const NEUMAN_1975 = 'Neuman, S.P. (1975) Analysis of pumping test data from anisotropic unconfined aquifers considering delayed gravity response. Water Resources Research 11(2), 329-342.';
export const PAPADOPULOS_COOPER_1967 = 'Papadopulos, I.S., and Cooper, H.H., Jr. (1967) Drawdown in a well of large diameter. Water Resources Research 3(1), 241-244.';
export const RASMUSSEN_CRAWFORD_1997 = 'Rasmussen, T.C., and Crawford, L.A. (1997) Identifying and removing barometric pressure effects in confined and unconfined aquifers. Ground Water 35(3), 502-511.';
export const REED_1980 = 'Reed, J.E. (1980) Type curves for selected problems of flow to wells in confined aquifers. U.S. Geological Survey Techniques of Water-Resources Investigations, Book 3, Chapter B3.';
// Two forms: without and with the doi.
export const STEHFEST_1970 = 'Stehfest, H. (1970) Algorithm 368: Numerical inversion of Laplace transforms. Communications of the ACM 13(1), 47-49.';
export const STEHFEST_1970_DOI = 'Stehfest, H. (1970) Algorithm 368: Numerical inversion of Laplace transforms. Communications of the ACM 13(1), 47-49. doi:10.1145/361953.361969';
export const THEIS_1935 = 'Theis, C.V. (1935) The relation between the lowering of the piezometric surface and the rate and duration of discharge of a well using ground-water storage. Transactions, American Geophysical Union 16(2), 519-524.';
// Two forms: "van der Kamp ... Hydrogeology in the Service of Man, Memoires" and "Van
// der Kamp ... Hydrology in the Service of Man, Memoirs". water-table.js adds how it was
// read to the second.
export const VAN_DER_KAMP_1985 = 'van der Kamp, G. (1985) Brief quantitative guidelines for the design and analysis of pumping tests. In: Hydrogeology in the Service of Man, Memoires of the 18th Congress of the International Association of Hydrogeologists, Cambridge, 197-206.';
export const VAN_DER_KAMP_1985_CAPITAL_V = 'Van der Kamp, G. (1985) Brief quantitative guidelines for the design and analysis of pumping tests. In: Hydrology in the Service of Man, Memoirs of the 18th Congress of the International Association of Hydrogeologists, Cambridge, 197-206.';
export const VAN_DER_KAMP_1989 = 'van der Kamp, G. (1989) Calculation of constant-rate drawdowns from stepped-rate pumping tests. Ground Water 27(2), 175-183.';
export const VAN_DER_KAMP_ET_AL_2021 = 'van der Kamp, G., Grunsky, A.C., and Wei, M. (2021) Applying the extended drawdown method to interpret pumping tests in British Columbia. Water Science Series WSS2021-04, Province of British Columbia.';
export const WEEKS_1969 = 'Weeks, E.P. (1969) Determining the ratio of horizontal to vertical permeability by aquifer-test analysis. Water Resources Research 5(1), 196-214.';
export const WIT_1963 = 'Wit, K.E. (1963) The hydraulic characteristics of the Oude Korendijk polder, calculated from pumping test data and laboratory measurements of core samples (in Dutch). Institute for Land and Water Management Research, Wageningen, Report 190.';
