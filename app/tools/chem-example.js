// Real analyses for the example button: 22 samples from County Ditch 65 near Maple Bay,
// Minnesota (USGS station 05079250), 2002-2004, as the IonBalance data set of the USGS
// smwrData R package (version 1.1.2; Lorenz 2015 describes version 1.1.1), which took them from NWISWeb on 2012-01-19
// and gives them in meq/L. Alkalinity is total alkalinity. The first sample has no
// alkalinity in the source, so it cannot be plotted.
export const EXAMPLE = {
  label: '22 USGS stream analyses, Minnesota',
  name: 'usgs-05079250-major-ions.csv',
  unit: 'meq/L',
  basis: 'alk',
  about: 'Example values: 22 analyses from County Ditch 65 near Maple Bay, Minnesota (USGS station 05079250), 2002 to 2004, in meq/L with total alkalinity, from the IonBalance data set of the USGS smwrData R package (Lorenz 2015). The first sample has no alkalinity in the source, so it is listed but not plotted.',
  csv: `
Sample,Ca (meq/L),Mg (meq/L),Na (meq/L),K (meq/L),Alkalinity (meq/L),Cl (meq/L),SO4 (meq/L)
2002-11-25 11:50,4.259,3.232,0.387,0.092,,0.26,0.273
2003-01-07 12:30,4.153,2.741,0.397,0.073,6.913,0.161,0.241
2003-02-19 12:40,3.271,1.55,0.1,0.03,4.496,0.027,0.139
2003-03-31 11:50,2.098,1.404,0.182,0.165,3.197,0.168,0.387
2003-04-29 09:50,3.585,2.627,0.395,0.118,6.753,0.237,0.431
2003-06-03 08:30,2.695,1.759,0.178,0.177,4.236,0.211,0.05
2003-06-10 12:20,2.506,1.968,0.281,0.084,4.436,0.149,0.232
2003-07-01 08:30,2.744,2.124,0.215,0.057,4.695,0.108,0.128
2003-08-04 12:20,3.69,2.359,0.357,0.043,6.234,0.128,0.072
2003-09-29 12:00,4.173,2.417,0.275,0.047,5.774,0.109,0.402
2003-11-03 12:30,4.047,2.452,0.355,0.068,6.234,0.159,0.372
2003-12-08 15:20,4.921,2.96,0.513,0.064,7.313,0.144,0.492
2004-01-20 11:50,3.942,2.37,0.387,0.057,5.954,0.102,0.241
2004-03-02 10:10,3.518,1.917,0.278,0.076,5.554,0.117,0.029
2004-03-30 12:30,1.432,1.012,0.111,0.156,2.238,0.133,0.197
2004-04-13 14:40,3.244,2.279,0.331,0.133,4.775,0.192,0.456
2004-05-13 07:50,2.32,2.131,0.323,0.132,3.676,0.188,0.569
2004-05-25 08:15,2.774,2.172,0.269,0.155,4.436,0.234,0.212
2004-07-13 07:50,2.39,1.893,0.217,0.066,4.116,0.107,0.178
2004-08-30 12:40,3.708,3.127,0.639,0.102,6.573,0.123,0.528
2004-10-11 14:10,3.939,3.361,0.592,0.093,6.633,0.138,0.483
2004-10-30 11:30,1.4,1.233,0.162,0.104,2.358,0.089,0.281
`.trim(),
};
