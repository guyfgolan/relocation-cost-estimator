const assert = require('assert');
const estimate = require('./estimate.js');
const refresh = require('./refresh.js');

function incomeRow(name, rate) {
  return '<tr><td>' + name + '</td><td>' + rate + '</td><td>&gt;</td><td>$0</td></tr>';
}
const noWage = { AK: 1, FL: 1, NV: 1, NH: 1, SD: 1, TN: 1, TX: 1, WY: 1 };
let incomeRows = '<table><tr><th>State</th><th>Single Filer (Rates)</th><td></td><th>Single Filer (Brackets)</th></tr>';
Object.keys(estimate.STATE_NAME).forEach(function (code) {
  const label = code === 'DC' ? 'Washington DC' : estimate.STATE_NAME[code];
  if (code === 'OH') incomeRows += incomeRow('Ohio (a)', '2.75%');
  else if (code === 'CA') {
    incomeRows += incomeRow('California (a)', '1.00%');
    incomeRows += incomeRow('- California', '13.30%');
  } else if (code === 'SC') {
    incomeRows += incomeRow('South Carolina', '0.00%');
    incomeRows += incomeRow('- South Carolina', '3.00%');
    incomeRows += incomeRow('- South Carolina', '6.00%');
  } else if (code === 'WA') {
    incomeRows += incomeRow('Washington (n)', 'Capital gains income only');
    incomeRows += incomeRow('- Washington', '7%');
  } else if (noWage[code]) incomeRows += incomeRow(label, 'none');
  else incomeRows += incomeRow(label, '5.00%');
});
const incomeHtml = '<html><title>State Individual Income Tax Rates, 2026</title>' + incomeRows + '</table></html>';
const sample = refresh.parseIncomeTaxHtml(incomeHtml);
assert.deepStrictEqual(sample.states.OH, { kind: 'flat', rate: 0.0275 });
assert.deepStrictEqual(sample.states.CA, { kind: 'graduated', min: 0.01, max: 0.133 });
assert.deepStrictEqual(sample.states.SC, { kind: 'graduated', min: 0.03, max: 0.06 });
assert.deepStrictEqual(sample.states.TX, { kind: 'none' });
assert.deepStrictEqual(sample.states.WA, { kind: 'none' });
assert.strictEqual(sample.asOf, '2026-01-01');
assert.strictEqual(estimate.incomeTaxNote('WA', sample.states, { asOf: sample.asOf, source: 'Tax Foundation' }).text.indexOf('savings'), -1);
assert.throws(function () { refresh.parseIncomeTaxHtml('<table><tr><th>Single Filer (Rates)</th></tr></table>'); }, /unknown state|missing/);

let salesRows = '<p>Rates as of July 1, 2026.</p><table><tr><th>State</th><th>State Tax Rate</th><th>Rank</th><th>Avg Local</th><th>Max</th><th>Combined Tax Rate</th><th>Rank</th></tr>';
Object.keys(estimate.STATE_NAME).forEach(function (code) {
  const label = code === 'DC' ? 'DC' : estimate.STATE_NAME[code];
  if (code === 'AL') salesRows += '<tr><td>Alabama</td><td>4.00%</td><td>40</td><td>5.46%</td><td>8.00%</td><td>9.46%</td><td>5</td></tr>';
  else salesRows += '<tr><td>' + label + '</td><td>5.00%</td><td>1</td><td>1.00%</td><td>2.00%</td><td>6.00%</td><td>1</td></tr>';
});
const sales = refresh.parseSalesTaxHtml(salesRows + '</table>');
assert.strictEqual(sales.asOf, '2026-07-01');
assert.deepStrictEqual(sales.states.AL, { state: 0.04, avgLocal: 0.0546, combined: 0.0946 });
assert.strictEqual(sales.states.DC.combined, 0.06);
assert.throws(function () { refresh.parseSalesTaxHtml('<table><tr><th>Combined Tax Rate</th></tr></table>'); }, /unknown state|missing/);

assert.deepStrictEqual(refresh.parseFredCsv('observation_date,CXUWATERLB0101M\n2023-01-01,780\n2024-01-01,826\n'), { asOf: '2024', national: 68.83 });

let census = 'GEO_ID|B25103_E001\n';
let values = 'GEO_ID|B25077_E001\n';
for (let i = 1; i <= 2500; i++) {
  const fips = String(i).padStart(5, '0');
  census += '0500000US' + fips + '|1000|1\n';
  values += '0500000US' + fips + '|200000|1\n';
}
census += '0500000US39049|4244|68\n';
values += '0500000US39049|288400|2726\n';
const rates = refresh.censusRates(refresh.parseCensusTable(census), refresh.parseCensusTable(values));
assert.strictEqual(rates['39049'], 0.01472);
assert.strictEqual(rates['00001'], 0.005);

const names = {};
let redfin = 'PERIOD_END\tREGION\tSTATE_CODE\tPROPERTY_TYPE\tMEDIAN_SALE_PRICE\tREGION_TYPE\n';
for (let i = 0; i < 500; i++) {
  const fips = String(10000 + i);
  names['county ' + i + '|oh'] = fips;
  redfin += '2026-04-30\t"County ' + i + ', OH"\t"OH"\t"All Residential"\t100000\t"county"\n';
  redfin += '2026-05-31\t"County ' + i + ', OH"\t"OH"\t"All Residential"\t' + (150000 + i) + '\t"county"\n';
  redfin += '2026-05-31\t"County ' + i + ', OH"\t"OH"\t"Single Family Residential"\t999999\t"county"\n';
}
const prices = refresh.parseRedfin(redfin, names);
assert.strictEqual(prices.asOf, '2026-05');
assert.strictEqual(prices.counties['10000'], 150000);
assert.strictEqual(prices.counties['10499'], 150499);

let bea = 'GeoFIPS,GeoName,Region,TableName,LineCode,IndustryClassification,Description,Unit,2023,2024\n';
Object.keys(estimate.STATE_NAME).forEach(function (code, index) {
  const label = code === 'DC' ? 'District of Columbia' : estimate.STATE_NAME[code];
  const fips = String(index + 1).padStart(2, '0') + '000';
  const all = code === 'FL' ? '103.414' : '100';
  bea += fips + ',"' + label + '",,SARPP,1,"...","RPPs: All items ","Index",99,' + all + '\n';
  bea += fips + ',"' + label + '",,SARPP,2,"...","RPPs: Goods ","Index",99,96.24\n';
});
const statePrices = refresh.parseBeaCsv(bea, 'state');
assert.strictEqual(statePrices.asOf, '2024');
assert.strictEqual(statePrices.areas.FL.all, 103.414);
assert.strictEqual(statePrices.areas.FL.goods, 96.24);

const grid = [['2024 Average Monthly Bill']];
Object.keys(estimate.STATE_NAME).forEach(function (code) {
  const label = code === 'DC' ? 'District of Columbia' : estimate.STATE_NAME[code];
  grid.push([label, '1', code === 'CT' ? '694.57073' : '500', code === 'CT' ? '28.745463' : '15']);
});
const power = refresh.parseElectricityGrid(grid);
assert.strictEqual(power.asOf, '2024');
assert.strictEqual(power.states.CT, 0.2875);
assert.strictEqual(power.kwhMonth.CT, 694.6);

const original = '{\n  "incomeBands": [\n    {\n      "id": "under75"\n    }\n  ],\n  "incomeTax": {\n    "asOf": "2026-01-01",\n    "states": {\n      "OH": {\n        "none": true\n      }\n    }\n  },\n  "water": {\n    "national": 10\n  }\n}\n';
const replaced = refresh.deleteJsonPath(
  refresh.setJsonPath(original, ['incomeTax', 'states'], { OH: { kind: 'flat', rate: 0.0275 } }),
  ['incomeBands']
);
const parsed = JSON.parse(replaced);
assert.strictEqual(parsed.incomeBands, undefined);
assert.deepStrictEqual(parsed.incomeTax.states.OH, { kind: 'flat', rate: 0.0275 });
assert.strictEqual(parsed.water.national, 10);
assert.strictEqual(parsed.incomeTax.asOf, '2026-01-01');

const factors = {
  incomeTax: {
    states: { OH: { kind: 'flat', rate: 0.02 } },
    asOf: '2026-01-01',
    retrieved: '2026-10-01',
    source: 'Tax Foundation',
    url: 'https://example.com/tax'
  },
  water: { national: 10, asOf: '2020', retrieved: '2026-10-01', source: 'BLS', url: 'https://example.com/water' },
  salesTax: {
    asOf: '2026-07-01',
    retrieved: '2026-10-01',
    states: {}
  }
};
Object.keys(estimate.STATE_NAME).forEach(function (code) {
  factors.salesTax.states[code] = { state: 0.04, avgLocal: 0.05, combined: 0.09, grocery: code === 'AL' ? 'reduced' : 'exempt' };
  if (code === 'AL') factors.salesTax.states[code].groceryRate = 0.02;
});
const beforeTax = JSON.stringify(factors.incomeTax);

refresh.refreshAll({
  factors: factors,
  today: '2026-10-23',
  jobs: [
    {
      id: 'incomeTax',
      fetch: async function () { throw new Error('tax page down'); },
      apply: refresh.applyIncomeTax
    },
    {
      id: 'water',
      fetch: async function () { return { asOf: '2024', national: 68.83 }; },
      apply: function (current, _bundle, next, today) {
        current.water.national = next.national;
        current.water.asOf = next.asOf;
        current.water.retrieved = today;
        return true;
      }
    },
    {
      id: 'salesTax',
      fetch: async function () {
        const states = {};
        Object.keys(estimate.STATE_NAME).forEach(function (code) {
          states[code] = code === 'AL'
            ? { state: 0.04, avgLocal: 0.0546, combined: 0.0946 }
            : { state: 0.04, avgLocal: 0.05, combined: 0.09 };
        });
        return { asOf: '2026-07-01', states: states };
      },
      apply: refresh.applySalesTax
    }
  ]
}).then(function (result) {
  assert.deepStrictEqual(result.failures.map(function (failure) { return failure.id; }), ['incomeTax']);
  assert.deepStrictEqual(result.changed.sort(), ['salesTax', 'water']);
  assert.strictEqual(JSON.stringify(factors.incomeTax), beforeTax);
  assert.strictEqual(factors.water.national, 68.83);
  assert.strictEqual(factors.water.retrieved, '2026-10-23');
  assert.strictEqual(factors.salesTax.states.AL.grocery, 'reduced');
  assert.strictEqual(factors.salesTax.states.AL.groceryRate, 0.02);
  assert.strictEqual(factors.salesTax.states.AL.combined, 0.0946);
  console.log('cost-of-living refresh checks passed');
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
