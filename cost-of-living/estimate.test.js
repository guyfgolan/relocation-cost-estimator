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
assert.strictEqual(estimate.usdaHousehold(7, factors.usda), estimate.usdaHousehold(6, factors.usda));

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
const sarasota = factors.florida.areas.sarasota;
const sarasotaHome = estimate.propertySide(
  'own',
  sarasota.median,
  'millage',
  sarasota.millage,
  factors.homestead.value,
  sarasota.schoolMillage,
  factors.homestead.schoolValue,
  factors.homestead.additionalStartsAt
);
assert.strictEqual(estimate.round10(sarasotaHome.monthly), 470);
assert.strictEqual(property.origin, 0);
assert.strictEqual(property.originNote, 'Included in rent');
assert.strictEqual(property.florida, 470);
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
const sarasotaNoHome = estimate.propertySide('own', sarasota.median, 'millage', sarasota.millage, 0);
assert.strictEqual(estimate.round10(sarasotaNoHome.monthly), 520);
assert.strictEqual(line(noPrimary, 'property-tax').florida, 520);

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

assert.strictEqual(factors.health.asOf, '2025');
assert.strictEqual(factors.health.states.FL.single, 1913);
assert.strictEqual(factors.health.states.FL.family, 7976);
assert.strictEqual(factors.health.states.OH.single, 2016);
assert.strictEqual(factors.health.states.OH.family, 6453);
assert.strictEqual(factors.naturalGas.enabled, false);
assert.strictEqual(factors.florida.flood.enabled, false);
assert.strictEqual(factors.florida.flood.statistic, 'median');
assert.ok(factors.florida.flood.source.indexOf('median policy cost') > 0);
assert.strictEqual(factors.florida.flood.source.indexOf('average'), -1);
assert.strictEqual(factors.engagement.samePosition, false);
assert.strictEqual(line(result, 'health').difference, 120);
assert.strictEqual(line(result, 'utilities').label, 'Electricity and Water');
assert.strictEqual(line(result, 'utilities').difference, 20);
assert.strictEqual(line(result, 'fuel').difference, 0);
assert.strictEqual(line(result, 'auto').difference, 60);
assert.strictEqual(line(result, 'groceries').difference, 20);
assert.strictEqual(line(result, 'insurance').difference, 280);
assert.strictEqual(line(result, 'sales-tax').difference, -10);
assert.strictEqual(result.total.monthly, 770);
assert.strictEqual(result.total.low, 650);
assert.strictEqual(result.total.high, 890);
assert.strictEqual(result.total.yearly, 9240);
const noDriveTotal = estimate.buildEstimate(Object.assign({}, base, { drives: false }), factors);
assert.strictEqual(noDriveTotal.total.monthly, 710);

const bases = estimate.homesteadBases(485000, 51411, 25000, 50000);
assert.strictEqual(bases.school, 460000);
assert.strictEqual(bases.other, 433589);

const ownedCounty = estimate.buildEstimate(Object.assign({}, base, { ownNow: 'own', countyFips: '39049' }), factors);
assert.strictEqual(line(ownedCounty, 'property-tax').origin, 430);
assert.strictEqual(line(ownedCounty, 'property-tax').florida, 470);
assert.strictEqual(line(ownedCounty, 'property-tax').difference, 40);

const ev = estimate.buildEstimate(Object.assign({}, base, { fuel: 'ev' }), factors);
assert.strictEqual(line(ev, 'fuel').label, 'Driving: electricity');
assert.strictEqual(line(ev, 'fuel').origin, estimate.round10(1000 / 3.5 * 0.1599));
assert.strictEqual(line(ev, 'fuel').florida, estimate.round10(1000 / 3.5 * 0.1414));
assert.strictEqual(line(ev, 'fuel').origin, 50);
assert.strictEqual(line(ev, 'fuel').florida, 40);

const floodHidden = estimate.buildEstimate(Object.assign({}, base, { flood: true }), factors);
assert.strictEqual(line(floodHidden, 'flood'), undefined);
const floodOn = JSON.parse(JSON.stringify(factors));
floodOn.florida.flood.enabled = true;
const floodMedian = estimate.buildEstimate(Object.assign({}, base, { flood: true }), floodOn);
assert.strictEqual(line(floodMedian, 'flood').florida, estimate.round10(1088 / 12));
const floodVenice = estimate.buildEstimate(Object.assign({}, base, { toArea: 'venice', flood: true }), floodOn);
assert.strictEqual(line(floodVenice, 'flood').florida, estimate.round10(1088 / 12));
floodOn.florida.flood.statistic = 'average';
const floodAverage = estimate.buildEstimate(Object.assign({}, base, { flood: true }), floodOn);
assert.strictEqual(line(floodAverage, 'flood').florida, estimate.round10(1755 / 12));

const gasOn = JSON.parse(JSON.stringify(factors));
gasOn.naturalGas.enabled = true;
const withGas = estimate.buildEstimate(base, gasOn);
assert.ok(line(withGas, 'utilities').label.indexOf('Natural gas') >= 0);
assert.strictEqual(line(result, 'utilities').label.indexOf('Natural gas'), -1);

['PR', 'GU', 'VI', 'AS', 'MP'].forEach(function (code) {
  const territory = estimate.buildEstimate(Object.assign({}, base, { state: code }), factors);
  assert.strictEqual(line(territory, 'income-tax').text, 'Not available', code);
  assert.strictEqual(line(territory, 'income-tax').inTotal, false, code);
  assert.strictEqual(line(territory, 'sales-tax').text, 'Not available', code);
  assert.strictEqual(line(territory, 'sales-tax').inTotal, false, code);
  assert.ok(territory.lines.every(function (row) { return row.text === 'Not available' || row.inTotal === false || row.difference != null; }));
});

const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.strictEqual(page.indexOf('8GQc'), -1);
assert.strictEqual(page.indexOf('https://calendar.app.google/5xtMmGSY9kCY5NRk7'), page.lastIndexOf('https://calendar.app.google/5xtMmGSY9kCY5NRk7'));
assert.ok(page.indexOf("const BOOKING_URL='https://calendar.app.google/5xtMmGSY9kCY5NRk7'") > 0);
assert.ok(page.indexOf('Schedule a call with Guy') > 0);
assert.ok(page.indexOf('class="sourcesToggle"') > 0);
assert.strictEqual(page.indexOf('sourcesToggle" open'), -1);
assert.ok(page.indexOf('favicon.ico') > 0);
assert.ok(page.indexOf('function selectedArea()') > 0);
assert.ok(page.indexOf('Source: U.S. Bureau of Economic Analysis, Regional Price Parities 2024.') > 0);
assert.ok(page.indexOf('This total includes only the lines above.') > 0);
assert.ok(page.indexOf("{id:'not-sure',label:'Not sure'}") > 0);
assert.ok(page.indexOf('Your Estimate') > 0);
assert.ok(page.indexOf('Thank you for filling out the information!') > 0);
assert.ok(page.indexOf('It seems as if you are still narrowing down your plans, so a number right now might not tell you much. I encourage you to book a call. I am happy to help in any way I can.') > 0);
assert.ok(page.indexOf('Book a Call with Guy') > 0);
assert.ok(page.indexOf('>Retake<') > 0);
assert.ok(page.indexOf('function retake(){durations=[];flowStart=0;shownAt=0;go(\'from\')}') > 0);

const slow = { timing: { durationsMs: [4000, 4000, 4000, 4000, 4000, 4000], elapsedMs: 40000 }, choiceIndexes: [3, 1, 1, 1, 0, 0] };
const answered = { household: '2', income: '75to150', ownNow: 'rent', planFL: 'buy', drives: 'yes' };
assert.strictEqual(estimate.lowInformation(answered, slow).show, false);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { household: 'not-sure', income: 'not-sure', drives: 'not-sure' }), slow).show, true);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { income: 'not-sure', ownNow: 'not-sure' }), slow).show, true);
assert.strictEqual(estimate.lowInformation(answered, { timing: { durationsMs: [500, 600, 700], elapsedMs: 20000 }, choiceIndexes: [0, 1, 2, 1, 0] }).show, true);
assert.strictEqual(estimate.lowInformation(answered, { timing: { durationsMs: [4000], elapsedMs: 8000 }, choiceIndexes: [0, 1, 2, 3, 1] }).show, true);
assert.strictEqual(estimate.lowInformation(answered, { timing: slow.timing, choiceIndexes: [0, 0, 0, 0, 0] }).show, false);
assert.strictEqual(estimate.lowInformation(answered, { timing: slow.timing, choiceIndexes: [0, 0, 0, 0, 0], samePosition: true }).show, true);
assert.strictEqual(estimate.lowInformation(answered, { timing: slow.timing, choiceIndexes: [2, 2, 2, 2, 2], samePosition: false }).show, false);
// Dexter's honest first-option path: 1 person, under $75k, own, buy, drives yes.
const honestFirst = { household: '1', income: 'under75', ownNow: 'own', planFL: 'buy', drives: 'yes' };
const firstOptions = { timing: slow.timing, choiceIndexes: [0, 0, 0, 0, 0] };
assert.strictEqual(estimate.lowInformation(honestFirst, firstOptions).show, false);
assert.strictEqual(estimate.lowInformation(honestFirst, Object.assign({ samePosition: true }, firstOptions)).reasons.indexOf('defaults') >= 0, true);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { household: '1', income: '250plus', groceriesNow: '0', hoaNow: '0', hoaFL: '0' }), slow).show, true);
// Dexter's blank HOA: the default empty field is not an entered zero.
const blankHoa = Object.assign({}, answered, { household: '1', income: '250plus', groceriesNow: '0' });
assert.strictEqual(estimate.lowInformation(blankHoa, slow).show, false);
assert.strictEqual(estimate.lowInformation(Object.assign({}, blankHoa, { hoaNow: '', hoaFL: '' }), slow).show, false);
assert.strictEqual(estimate.lowInformation(Object.assign({}, blankHoa, { hoaNow: null, hoaFL: null }), slow).show, false);
assert.strictEqual(estimate.lowInformation(Object.assign({}, blankHoa, { hoaNow: '0', hoaFL: '' }), slow).show, false);
assert.strictEqual(estimate.lowInformation(Object.assign({}, blankHoa, { groceriesNow: '', hoaNow: '0', hoaFL: '0' }), slow).show, false);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { homeBudget: '99999999' }), slow).show, true);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { homeBudget: '5000' }), slow).show, true);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { vehicles: '50' }), slow).show, true);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { miles: '999999' }), slow).show, true);
assert.strictEqual(estimate.lowInformation(Object.assign({}, answered, { mpg: '0' }), slow).show, true);
assert.strictEqual(estimate.boundMessage('budget', '250000'), '');
assert.strictEqual(estimate.boundMessage('budget', ''), '');
assert.ok(estimate.boundMessage('budget', '99999999'));
assert.ok(estimate.boundMessage('budget', '1000'));
assert.ok(estimate.boundMessage('vehicles', '11'));
assert.strictEqual(estimate.boundMessage('vehicles', '2'), '');
assert.ok(estimate.boundMessage('miles', '9000'));
assert.strictEqual(estimate.boundMessage('miles', '1000'), '');
assert.ok(estimate.boundMessage('miles', '0'));

const less = 'Living in Sarasota County costs about 11% less than San Francisco.';
assert.strictEqual(
  estimate.alignedSentence(less, 10, 'Sarasota County', 'San Francisco'),
  'The monthly lines in this estimate cost more in Sarasota County than in San Francisco.'
);
assert.strictEqual(estimate.alignedSentence(less, -20, 'Sarasota County', 'New York'), less);
assert.strictEqual(
  estimate.alignedSentence('Living in Manatee County costs about 2% more than Hillsborough County, FL.', 50, 'Manatee County', 'Hillsborough County, FL'),
  'Living in Manatee County costs about 2% more than Hillsborough County, FL.'
);
const partial = estimate.buildEstimate(Object.assign({}, base, { hhSize: null, incomeBand: '' }), factors);
assert.strictEqual(line(partial, 'groceries'), undefined);
assert.strictEqual(line(partial, 'health'), undefined);
assert.strictEqual(line(partial, 'income-tax'), undefined);
assert.strictEqual(line(partial, 'sales-tax'), undefined);
assert.ok(!partial.notes.some(function (note) { return note.indexOf('Not sure') >= 0; }));

const bothUnsure = estimate.buildEstimate(Object.assign({}, base, {
  hhSize: null,
  incomeBand: '',
  householdNotSure: true,
  incomeNotSure: true
}), factors);
['income-tax', 'groceries', 'health', 'sales-tax'].forEach(function (id) {
  assert.strictEqual(line(bothUnsure, id).text, 'Not available', id);
  assert.strictEqual(line(bothUnsure, id).inTotal, false, id);
  assert.strictEqual(line(bothUnsure, id).difference, null, id);
});
assert.strictEqual(bothUnsure.notes.filter(function (note) { return note === 'Some lines are left out because an answer was Not sure.'; }).length, 1);
assert.strictEqual(bothUnsure.total.monthly, partial.total.monthly);
assert.ok(JSON.stringify(bothUnsure).indexOf('not-sure people') === -1);
assert.ok(JSON.stringify(bothUnsure).indexOf('Income: .') === -1);

const householdUnsure = estimate.buildEstimate(Object.assign({}, base, { hhSize: null, householdNotSure: true }), factors);
assert.strictEqual(line(householdUnsure, 'groceries').text, 'Not available');
assert.strictEqual(line(householdUnsure, 'health').text, 'Not available');
assert.strictEqual(line(householdUnsure, 'sales-tax').text, 'Not available');
assert.notStrictEqual(line(householdUnsure, 'income-tax').text, 'Not available');
assert.strictEqual(line(householdUnsure, 'income-tax').inTotal, true);
assert.strictEqual(householdUnsure.notes.filter(function (note) { return note.indexOf('Not sure') >= 0; }).length, 1);

const incomeUnsure = estimate.buildEstimate(Object.assign({}, base, { incomeBand: '', incomeNotSure: true }), factors);
assert.strictEqual(line(incomeUnsure, 'income-tax').text, 'Not available');
assert.strictEqual(line(incomeUnsure, 'sales-tax').text, 'Not available');
assert.strictEqual(line(incomeUnsure, 'groceries').inTotal, true);
assert.strictEqual(line(incomeUnsure, 'health').inTotal, true);
assert.strictEqual(incomeUnsure.notes.filter(function (note) { return note.indexOf('Not sure') >= 0; }).length, 1);

assert.ok(page.indexOf("if(A.household==='not-sure') return 'not sure'") > 0);
assert.ok(page.indexOf("A.income==='not-sure'?'Income: not sure.'") > 0);
assert.strictEqual(page.indexOf('not-sure people'), -1);
assert.ok(page.indexOf('householdNotSure:A.household===\'not-sure\'') > 0);
assert.ok(page.indexOf('incomeNotSure:A.income===\'not-sure\'') > 0);
assert.ok(page.indexOf('samePosition:!!(factors&&factors.engagement&&factors.engagement.samePosition===true)') > 0);

const BOOKING = 'https://calendar.app.google/5xtMmGSY9kCY5NRk7';
const PHONE = 'tel:+13019196726';
function anchorHrefs(html) {
  const found = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = match[1] || match[2] || match[3] || '';
    found.push(href.indexOf('BOOKING_URL') >= 0 || href.indexOf('BOOK_URL') >= 0 ? BOOKING : href);
  }
  return found;
}
function addresses(html) {
  return anchorHrefs(html).filter(function (href) { return /^https?:|^tel:/i.test(href); });
}
function sliceFn(html, name, nextName) {
  const start = html.indexOf('function ' + name);
  const end = html.indexOf('function ' + nextName);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end);
}
const creditStart = page.indexOf('function censusCredit()');
const creditEnd = page.indexOf('function lineNotes');
const creditFn = new Function('bundle', 'esc', page.slice(creditStart, creditEnd) + '\nreturn censusCredit();');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'cost-of-living.json'), 'utf8'));
const esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
};
const credit = creditFn(bundle, esc);
assert.strictEqual(credit, '<p class="credit">ZIP lookup: U.S. Census Bureau, 2020 ZCTA5 to County relationship file.</p>');
assert.strictEqual(credit.indexOf('<a'), -1);
assert.strictEqual(credit.indexOf('census.gov'), -1);

const colResults = sliceFn(page, 'drawResults', 'layoutResults') + sliceFn(page, 'bookingLink', 'noteShown') + sliceFn(page, 'censusCredit', 'lineNotes') + credit;
const colLowInfo = sliceFn(page, 'showLowInfo', 'isSourced') + sliceFn(page, 'bookingLink', 'noteShown');
[colResults, colLowInfo].forEach(function (html) {
  const found = addresses(html);
  found.forEach(function (href) {
    assert.ok(href === BOOKING || href === PHONE, href);
  });
  assert.ok(found.indexOf(BOOKING) >= 0);
  assert.strictEqual(html.indexOf('census.gov'), -1);
});
const colPageAddresses = Array.from(new Set(addresses(page))).sort();
assert.deepStrictEqual(colPageAddresses, [BOOKING, PHONE].sort());
assert.ok(page.indexOf('href="tel:+13019196726"') > 0);

const moverPage = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moverLow = sliceFn(moverPage, 'lowInfoCopy', 'result');
const moverResults = sliceFn(moverPage, 'result', 'sendEmail');
[moverLow, moverResults].forEach(function (html) {
  const found = Array.from(new Set(addresses(html)));
  assert.deepStrictEqual(found, [BOOKING]);
});
assert.deepStrictEqual(Array.from(new Set(addresses(moverPage))).sort(), [BOOKING]);

console.log('cost-of-living formula checks passed');
