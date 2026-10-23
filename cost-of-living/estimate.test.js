const assert = require('assert');
const fs = require('fs');
const path = require('path');
const estimate = require('./estimate.js');
const { checkFactors, load } = require('./check.js');

const factors = load(path.join(__dirname, 'factors.json'));
checkFactors(factors);

function throws(fn, pattern) {
  assert.throws(fn, pattern instanceof RegExp ? pattern : new RegExp(pattern));
}

function line(result, id) {
  return result.lines.find(function (row) { return row.id === id; });
}

// Rounding is to the nearest $10, with halves away from zero.
assert.strictEqual(estimate.round10(165.088), 170);
assert.strictEqual(estimate.round10(184), 180);
assert.strictEqual(estimate.round10(185), 190);
assert.strictEqual(estimate.round10(-185), -190);
assert.strictEqual(estimate.round10(-184), -180);
assert.strictEqual(estimate.round10(0), 0);

// Income-band edges. The upper bound of each closed band belongs to the next band.
const bands = factors.incomeBands;
assert.strictEqual(estimate.bandForIncome(0, bands).id, 'under75');
assert.strictEqual(estimate.bandForIncome(74999.99, bands).midpoint, 37500);
assert.strictEqual(estimate.bandForIncome(75000, bands).id, '75to150');
assert.strictEqual(estimate.bandForIncome(75000, bands).midpoint, 112500);
assert.strictEqual(estimate.bandForIncome(149999.99, bands).midpoint, 112500);
assert.strictEqual(estimate.bandForIncome(150000, bands).midpoint, 200000);
assert.strictEqual(estimate.bandForIncome(249999.99, bands).midpoint, 200000);
assert.strictEqual(estimate.bandForIncome(250000, bands).id, '250plus');
assert.strictEqual(estimate.bandForIncome(400000, bands).midpoint, 375000);

// Ohio 2026 flat tax, married, $112,500 midpoint. Exemption for this income is $1,900 each.
const ohio = estimate.stateIncomeTax('OH', 112500, 'married', factors.incomeTax.states);
assert.ok(Math.abs(ohio - 2272.875) < 0.001, ohio);
assert.strictEqual(estimate.stateIncomeTax('FL', 200000, 'single', factors.incomeTax.states), 0);
assert.strictEqual(estimate.stateIncomeTax('WA', 200000, 'married', factors.incomeTax.states), 0);
assert.strictEqual(estimate.filingStatus(1), 'single');
assert.strictEqual(estimate.filingStatus(2), 'married');

// Sales tax. Florida subtracts groceries. A taxed origin state does not.
const exempt = estimate.salesTaxMonthly(112500, 0.07, 500, 'exempt');
assert.ok(Math.abs(exempt - 161.875) < 0.001, exempt);
const taxed = estimate.salesTaxMonthly(112500, 0.0946, 500, 'taxed');
assert.ok(Math.abs(taxed - 266.0625) < 0.001, taxed);
assert.ok(exempt < taxed);
const wiped = estimate.salesTaxMonthly(10000, 0.07, 400, 'exempt');
assert.strictEqual(wiped, 0);
const reduced = estimate.salesTaxMonthlyReduced(112500, 0.0946, 0.02, 500);
const reducedExpected = ((112500 * 0.30 - 6000) * 0.0946 + 6000 * 0.02) / 12;
assert.ok(Math.abs(reduced - reducedExpected) < 0.001, reduced);

// Property tax with homestead, without it, and for a renter.
const withHome = estimate.propertySide('own', 485000, 'millage', 14.5524, 51411);
assert.ok(Math.abs(withHome.monthly - 525.81338) < 0.02, withHome.monthly);
const noHome = estimate.propertySide('own', 485000, 'millage', 14.5524, 0);
assert.ok(Math.abs(noHome.monthly - 588.1595) < 0.02, noHome.monthly);
assert.ok(withHome.monthly < noHome.monthly);
const rent = estimate.propertySide('rent', null, 'millage', null, 0);
assert.strictEqual(rent.monthly, 0);
assert.strictEqual(rent.note, 'Included in rent');
assert.strictEqual(estimate.propertySide('own', 40000, 'millage', 10, 51411).monthly, 0);

// Fuel defaults: 1,000 miles, 25 mpg, and 3.5 miles per kWh.
assert.ok(Math.abs(estimate.fuelMonthly({ fuel: 'gas', vehicles: 1 }, 4.1272) - 165.088) < 0.001);
assert.ok(Math.abs(estimate.fuelMonthly({ fuel: 'ev', vehicles: 1, miPerKwh: 3.5 }, 0.12) - (1000 / 3.5 * 0.12)) < 0.001);
assert.strictEqual(estimate.usdaHousehold(1, factors.usda), 367.4 * 1.2);
assert.ok(Math.abs(estimate.usdaHousehold(4, factors.usda) - 1389.2) < 0.001);
assert.ok(Math.abs(estimate.usdaHousehold(6, factors.usda) - 1727.005) < 0.001);

const scaled = estimate.groceryPair({
  hhSize: 1,
  rppOriginGoods: 100,
  rppFloridaGoods: 96.24,
  usda: factors.usda
});
assert.ok(Math.abs(scaled.origin - 367.4 * 1.2) < 0.001);
assert.ok(Math.abs(scaled.florida - 367.4 * 1.2 * 0.9624) < 0.001);
const entered = estimate.groceryPair({ hhSize: 2, groceriesNow: '400', rppOriginGoods: 90, rppFloridaGoods: 96.24, usda: factors.usda });
assert.strictEqual(entered.origin, 400);
assert.ok(Math.abs(entered.florida - 400 * 96.24 / 90) < 0.001);

const bills = estimate.utilitiesMonthly({
  electricity: estimate.electricityBill(1000, 0.15),
  gas: 40,
  water: estimate.waterBill(null, 50, 88.171)
});
assert.strictEqual(bills.label, 'Electricity and Natural gas and Water');
assert.ok(Math.abs(bills.monthly - (150 + 40 + 44.0855)) < 0.001);

assert.strictEqual(
  estimate.priceLevelSentence('Hillsborough County', 100.89, 'Columbus, OH', 95.469),
  'Living in Hillsborough County costs about 6% more than Columbus, OH.'
);
assert.strictEqual(
  estimate.priceLevelSentence('Manatee County', 90, 'Columbus, OH', 100),
  'Living in Manatee County costs about 10% less than Columbus, OH.'
);
assert.strictEqual(estimate.priceLevelSentence('Venice', 100, 'Your area', 0), '');

const base = {
  state: 'OH',
  toArea: 'sarasota',
  floridaName: 'Sarasota County',
  originName: 'Franklin County, OH',
  hhSize: 2,
  adults: 2,
  incomeBand: '75to150',
  ownNow: 'rent',
  planFL: 'buy',
  primary: true,
  drives: true,
  vehicles: 1,
  fuel: 'gas',
  rppOriginGoods: 93.628,
  rppFloridaGoods: 96.24,
  rppOriginAll: 95.469,
  rppFloridaAll: 102.417,
  rppOriginUtilities: 95.523,
  rppFloridaUtilities: 88.171
};

const result = estimate.buildEstimate(base, factors);
assert.strictEqual(result.income, 112500);
assert.strictEqual(result.sentence, 'Living in Sarasota County costs about 7% more than Franklin County, OH.');
const tax = line(result, 'income-tax');
assert.strictEqual(tax.difference, -190);
assert.strictEqual(tax.originNote, 'Estimated savings.');
const sales = line(result, 'sales-tax');
assert.ok(sales && sales.inTotal);
assert.ok(sales.florida < sales.origin);
const property = line(result, 'property-tax');
const sarasotaRate = factors.florida.areas.sarasota.millage;
const sarasotaHome = estimate.propertySide('own', factors.florida.areas.sarasota.median, 'millage', sarasotaRate, factors.homestead.value);
assert.strictEqual(property.origin, 0);
assert.strictEqual(property.originNote, 'Included in rent');
assert.strictEqual(property.florida, estimate.round10(sarasotaHome.monthly));
assert.ok(result.notes.indexOf('Moving within Florida? Portability can lower this.') >= 0);
assert.strictEqual(line(result, 'insurance').label, "Home or renter's insurance");
assert.strictEqual(line(result, 'insurance').originNote, "Renter's average.");
assert.strictEqual(line(result, 'insurance').floridaNote, "Homeowner's average.");
assert.strictEqual(line(result, 'median-price').inTotal, false);
assert.strictEqual(line(result, 'price-level').inTotal, false);
assert.strictEqual(line(result, 'flood'), undefined);
assert.strictEqual(line(result, 'hoa'), undefined);
const summed = result.lines.reduce(function (sum, row) { return sum + (row.inTotal ? row.difference : 0); }, 0);
assert.strictEqual(result.total.monthly, summed);
assert.strictEqual(result.total.yearly, summed * 12);
assert.ok(result.total.low <= result.total.monthly && result.total.monthly <= result.total.high);

const noPrimary = estimate.buildEstimate(Object.assign({}, base, { primary: false }), factors);
const sarasotaNoHome = estimate.propertySide('own', factors.florida.areas.sarasota.median, 'millage', sarasotaRate, 0);
assert.strictEqual(line(noPrimary, 'property-tax').florida, estimate.round10(sarasotaNoHome.monthly));

const owned = estimate.buildEstimate(Object.assign({}, base, { ownNow: 'own' }), factors);
assert.strictEqual(line(owned, 'property-tax'), undefined);

const floodFactors = JSON.parse(JSON.stringify(factors));
floodFactors.florida.flood = {
  source: 'OpenFEMA NFIP redacted policies, average premium',
  url: 'https://www.fema.gov/openfema-data-page/fima-nfip-redacted-policies-v2',
  asOf: '2026-06-01',
  retrieved: '2026-10-23'
};
floodFactors.florida.areas.sarasota.flood = 1247;
const flooded = estimate.buildEstimate(Object.assign({}, base, { flood: true }), floodFactors);
assert.strictEqual(line(flooded, 'flood').florida, estimate.round10(1247 / 12));
assert.strictEqual(line(flooded, 'flood').difference, estimate.round10(1247 / 12));
const floodOff = estimate.buildEstimate(Object.assign({}, base, { flood: false }), floodFactors);
assert.strictEqual(line(floodOff, 'flood'), undefined);

const hoa = estimate.buildEstimate(Object.assign({}, base, { hoaFL: 250, hoaNow: 80 }), factors);
assert.strictEqual(line(hoa, 'hoa').difference, 170);
const hoaBlank = estimate.buildEstimate(Object.assign({}, base, { hoaFL: 0, hoaNow: 0 }), factors);
assert.strictEqual(line(hoaBlank, 'hoa'), undefined);
const hoaFloridaOnly = estimate.buildEstimate(Object.assign({}, base, { hoaFL: 25 }), factors);
assert.strictEqual(line(hoaFloridaOnly, 'hoa').florida, 30);
assert.strictEqual(line(hoaFloridaOnly, 'hoa').origin, 0);

const same = estimate.buildEstimate(Object.assign({}, base, { state: 'FL', incomeBand: 'under75' }), factors);
assert.strictEqual(line(same, 'income-tax').text, 'No change.');

const noDrive = estimate.buildEstimate(Object.assign({}, base, { drives: false }), factors);
assert.strictEqual(line(noDrive, 'fuel'), undefined);
assert.strictEqual(line(noDrive, 'auto'), undefined);

const blob = JSON.stringify(result) + JSON.stringify(factors.incomeTax.source) + JSON.stringify(factors.gas);
['PLACEHOLDER', 'TODO', 'UNVERIFIED', 'unverified', 'MEASURED', 'INFERENCE', '8GQc'].forEach(function (word) {
  assert.strictEqual(blob.indexOf(word), -1, word);
});

const broken = JSON.parse(JSON.stringify(factors));
broken.gas.asOf = '2026';
throws(function () { checkFactors(broken); }, 'gas snapshot date');
const nameless = JSON.parse(JSON.stringify(factors));
nameless.health.source = '';
throws(function () { checkFactors(nameless); }, 'factor missing source health');

const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.strictEqual(page.indexOf('8GQc'), -1);
assert.strictEqual(page.indexOf('https://calendar.app.google/5xtMmGSY9kCY5NRk7'), page.lastIndexOf('https://calendar.app.google/5xtMmGSY9kCY5NRk7'));
assert.ok(page.indexOf("const BOOKING_URL='https://calendar.app.google/5xtMmGSY9kCY5NRk7'") > 0);

console.log('cost-of-living formula checks passed');
