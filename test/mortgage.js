const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { monthlyPayment, buildEstimate, cents } = require('../mortgage.js');

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 0.02, `${msg}: ${actual} vs ${expected}`);
}

const zero = monthlyPayment(120000, 0, 30);
near(zero, 120000 / 360, 'a zero rate spreads the loan across the months');

const pay = monthlyPayment(100000, 6, 30);
assert.ok(pay > 599 && pay < 600, '6% of 100000 over 30 years is the standard payment');
assert.ok(monthlyPayment(100000, 7, 30) > pay, 'a higher rate costs more each month');
assert.strictEqual(monthlyPayment(0, 6, 30), null);
assert.strictEqual(monthlyPayment(100000, 6, null), null);

const defaults = {
  term: { years: 30 },
  rate: { value: 6, low: null, high: null },
  insurance: {},
  places: [{
    id: 'sarasota',
    name: 'Sarasota County',
    millage: { value: 15, low: 10, high: 20 },
    hoa: { monthly: null, low: null, high: null }
  }]
};

const ranged = buildEstimate({
  price: 200000,
  downDollars: 40000,
  downPercent: null,
  rate: 6,
  rateTouched: false,
  placeId: 'sarasota',
  taxAnnual: null,
  taxTouched: false,
  insuranceMonthly: 100,
  insuranceTouched: true,
  hoaMonthly: null,
  hoaTouched: false
}, defaults);
assert.strictEqual(ranged.complete, true);
assert.ok(ranged.total.low < ranged.total.high, 'millage low and high open a range');
assert.ok(ranged.lines.find(l => l.id === 'hoa').omitted);

const typed = buildEstimate({
  price: 200000,
  downDollars: null,
  downPercent: 20,
  rate: 6,
  rateTouched: true,
  placeId: 'sarasota',
  taxAnnual: 3000,
  taxTouched: true,
  insuranceMonthly: 150,
  insuranceTouched: true,
  hoaMonthly: 50,
  hoaTouched: true
}, defaults);
near(typed.lines.find(l => l.id === 'tax').range.low, 250, 'typed annual tax becomes a monthly amount');
near(typed.lines.find(l => l.id === 'principal').range.low, typed.lines.find(l => l.id === 'principal').range.high, 'a typed rate uses one payment on both ends');
assert.strictEqual(typed.loan, 160000);

const empty = buildEstimate({}, { term: { years: null }, rate: {}, insurance: {}, places: [] });
assert.strictEqual(empty.complete, false);
assert.ok(empty.missing.includes('home price'));
assert.ok(empty.missing.includes('loan term in the data file'));

const file = fs.readFileSync(path.join(__dirname, '..', 'data', 'mortgage_defaults.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(file, sandbox);
const data = sandbox.window.MORTGAGE_DEFAULTS;
assert.strictEqual(data.fred.apiKey, null);
assert.strictEqual(data.fred.seriesId, 'MORTGAGE30US');
for (const group of [data.rate, data.term, data.price, data.downPayment, data.insurance]) {
  assert.ok('source' in group && 'asOf' in group, 'each default group has source and as-of');
}
assert.strictEqual(data.rate.value, null);
assert.strictEqual(data.rate.low, null);
assert.strictEqual(data.rate.high, null);
assert.strictEqual(data.term.years, null);
assert.strictEqual(data.price.value, null);
assert.strictEqual(data.downPayment.dollars, null);
assert.strictEqual(data.downPayment.percent, null);
assert.strictEqual(data.insurance.quarterly, null);
assert.strictEqual(data.insurance.lowQuarterly, null);
assert.strictEqual(data.insurance.highQuarterly, null);
const ids = data.places.map(p => p.id);
assert.strictEqual(ids.join(','), 'manatee,hillsborough,pinellas,sarasota,venice,north-port');
for (const place of data.places) {
  assert.strictEqual(place.millage.value, null);
  assert.strictEqual(place.millage.low, null);
  assert.strictEqual(place.millage.high, null);
  assert.strictEqual(place.hoa.monthly, null);
  assert.ok(place.millage.source === null && place.millage.asOf === null);
  assert.ok(place.hoa.source === null && place.hoa.asOf === null);
}
assert.ok(!/charlotte|lee county/i.test(JSON.stringify(data)));
assert.strictEqual(cents(10.1 + 10.2), 20.3);

const page = fs.readFileSync(path.join(__dirname, '..', 'mortgage.html'), 'utf8');
const calc = fs.readFileSync(path.join(__dirname, '..', 'mortgage.js'), 'utf8');
assert.ok(page.includes('https://calendar.app.google/5xtMmGSY9kCY5NRk7'));
assert.ok(!page.includes('8GQc'));
assert.ok(page.includes('assets/mortgage/step1.jpg'));
assert.ok(page.includes('rgba(13,34,53,.45)'));
assert.ok(calc.includes('The exact monthly figure depends on the lot.'));

console.log('mortgage checks passed');
