// Example slug tests for the slug page and its tests. Each has the readings as CSV and
// the values the page fills in; nothing here is used unless the example is chosen.

const PRATT = '0.1,0.663\n0.2,0.664\n0.3,0.656\n0.4,0.656\n0.5,0.656\n0.6,0.656\n0.7,0.653\n0.8,0.649\n0.9,0.649\n1.1,0.649\n1.2,0.645\n1.3,0.642\n1.5,0.653\n1.6,0.648\n1.8,0.642\n2,0.638\n2.3,0.63\n2.6,0.627\n2.9,0.619\n3.2,0.619\n3.6,0.616\n4,0.608\n4.5,0.605\n5.1,0.596\n5.7,0.59\n6.4,0.587\n7.1,0.579\n8,0.568\n9,0.56\n10,0.553\n11.3,0.539\n12.6,0.531\n14.2,0.517\n15.9,0.501\n17.8,0.486\n20,0.469\n22.4,0.45\n25.2,0.435\n28.2,0.413\n31.7,0.39\n35.5,0.368\n39.9,0.346\n44.7,0.321\n50.2,0.295\n56.3,0.273\n63.1,0.244\n70.8,0.221\n79.5,0.191\n89.2,0.166\n100.1,0.14\n112.3,0.118\n125.9,0.099\n141.3,0.081\n158.5,0.059\n177.9,0.051\n199.6,0.037\n223.9,0.025\n251.2,0.019\n281.9,0.014\n316.3,0.008\n354.9,0.008\n';

const INVENTED = '0,2.700\n0.5,2.721\n1,2.741\n1.5,2.760\n2,2.778\n2.5,2.795\n3,2.812\n3.5,2.828\n4,2.844\n4.5,2.858\n5,2.873\n5.5,2.886\n6,2.899\n6.5,2.912\n7,2.924\n7.5,2.935\n8,2.946\n8.5,2.957\n9,2.967\n9.5,2.976\n10,2.986\n12,3.019\n14,3.047\n16,3.071\n18,3.091\n20,3.108\n22,3.122\n24,3.134\n26,3.145\n28,3.153\n30,3.161\n32,3.167\n34,3.172\n36,3.176\n38,3.180\n40,3.183\n';

export const SLUG_EXAMPLES = [
  {
    label: 'Pratt County well 4 (published)',
    name: 'pratt-county-well-4.csv',
    csv: `Time (s),Displacement (m)\n${PRATT}`,
    source: 'Test 2 in well 4, Pratt County Monitoring Site 36, from Butler (1998), as listed in the AQTESOLV unconfined slug test tutorial (HydroSOLVE, http://www.aqtesolv.com/examples/uncslug1.htm). Mostly sand and gravel with clay beds. The tutorial gives rw = 0.125 m, rc = 0.064 m, screen 1.52 m, aquifer thickness 47.87 m (D here, b in the tutorial), top of screen 16.77 m below the water table (so Lw = 18.29 m to the bottom of the screen) and H0 = 0.671 m. It gives no anisotropy; it uses the original Bouwer and Rice method, which assumes an isotropic aquifer, so Kz/Kr is set to 1. The tutorial places its Bouwer and Rice line by eye (a visual match) and gets K = 3.282 m/d. This page fits a least-squares line to the 3 readings with H/H0 from 0.20 to 0.30, the range Butler (1998) recommends, and gets 3.44 m/d, 4.8% higher. A line placed by eye need not match a least-squares line through the same readings.',
    values: { method: 'bouwerRice', tUnit: 's', kind: 'disp', lUnit: 'm', rc: 0.064, rw: 0.125, Le: 1.52, Lw: 18.29, D: 47.87, anisotropy: 1, h0: 0.671 },
  },
  {
    label: 'Invented Hvorslev test',
    name: 'invented-hvorslev-test.csv',
    csv: `Time (min),Depth to water (m)\n${INVENTED}`,
    source: 'Invented, not measured. Made with the Hvorslev equation and K = 1.0 × 10⁻⁶ m/s exactly, for rc = 0.025 m, rw = 0.05 m, screen 1.5 m, Kz/Kr = 1, static depth to water 3.200 m and a 0.5 m slug, then rounded to the millimetre. The true answer is K = 1.0 × 10⁻⁶ m/s; the rounding moves the fitted answer to 9.88 × 10⁻⁷ m/s, 1.2% lower.',
    values: { method: 'hvorslev', tUnit: 'min', kind: 'level', static: 3.2, lUnit: 'm', rc: 0.025, rw: 0.05, Le: 1.5, anisotropy: 1 },
  },
];
