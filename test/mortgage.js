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
assert.strictEqual(data.rate.value, 7.32);
assert.strictEqual(data.rate.low, null);
assert.strictEqual(data.rate.high, null);
assert.strictEqual(data.rate.asOf, '2026-10-22');
assert.strictEqual(data.term.years, 30);
assert.strictEqual(data.price.value, null);
assert.strictEqual(data.downPayment.dollars, null);
assert.strictEqual(data.insurance.range.low, 3181);
assert.strictEqual(data.insurance.range.high, 6826);
assert.strictEqual(data.insurance.range.label, 'INFERENCE');
assert.strictEqual(data.insurance.counties.Manatee.annual, 3181);
assert.strictEqual(data.insurance.counties.Sarasota.annual, 3457);
assert.strictEqual(data.insurance.counties.Hillsborough.annual, 3525);
assert.strictEqual(data.insurance.counties.Pinellas.annual, 4063);
const hills = data.places.find(p => p.id === 'hillsborough').millage;
assert.strictEqual(hills.value, 18.8553);
assert.strictEqual(hills.low, 18.29);
assert.strictEqual(hills.high, 19.84);
const venice = data.places.find(p => p.id === 'venice').millage;
assert.strictEqual(venice.value, 12.7527);
assert.strictEqual(venice.low, null);
assert.strictEqual(data.places.find(p => p.id === 'north-port').millage.value, 12.7527);
assert.strictEqual(data.places.find(p => p.id === 'pinellas').millage.low, null);
assert.strictEqual(data.places.find(p => p.id === 'manatee').millage.value, 14.5524);
const sara = data.places.find(p => p.id === 'sarasota').millage;
assert.strictEqual(sara.value, 12.7527);
assert.strictEqual(sara.low, 10.7437);
assert.strictEqual(sara.high, 11.4737);
assert.strictEqual(data.communities.find(c => c.id === 'wildleaf-nrr').hoaAnnualLow, 111);
assert.strictEqual(data.communities.find(c => c.id === 'wildleaf-nrr').cddAnnualHigh, 3764);
assert.strictEqual(data.communities.find(c => c.id === 'wellen-park').label, 'UNVERIFIED');
assert.strictEqual(data.communities.find(c => c.id === 'lakewood-ranch').label, 'UNVERIFIED');
assert.strictEqual(data.communities.find(c => c.id === 'del-webb-nrr').label, 'UNVERIFIED');
assert.ok(!/charlotte|lee county/i.test(JSON.stringify(data)));

const cited = buildEstimate({
  price: 400000,
  downDollars: 80000,
  rate: 7.32,
  rateTouched: false,
  placeId: 'hillsborough',
  taxTouched: false,
  insuranceTouched: false,
  hoaTouched: false,
  communityId: 'wildleaf-nrr'
}, data);
assert.strictEqual(cited.complete, true, cited.missing.join(','));
assert.ok(cited.total.low < cited.total.high);
near(cited.lines.find(l => l.id === 'tax').range.low, 400000 * 18.29 / 1000 / 12, 'Hillsborough millage low');
near(cited.lines.find(l => l.id === 'tax').range.high, 400000 * 19.84 / 1000 / 12, 'Hillsborough millage high');
near(cited.lines.find(l => l.id === 'insurance').range.low, 3181 / 12, 'insurance range low');
near(cited.lines.find(l => l.id === 'insurance').range.high, 6826 / 12, 'insurance range high');
assert.strictEqual(cited.lines.find(l => l.id === 'insurance').labelStatus, 'INFERENCE');
near(cited.lines.find(l => l.id === 'hoa').range.low, (111 + 2336) / 12, 'Wildleaf low');
near(cited.lines.find(l => l.id === 'hoa').range.high, (1541 + 3764) / 12, 'Wildleaf high');
assert.ok(cited.notes.some(n => /flood/i.test(n)));

const estimateOnly = buildEstimate({
  price: 400000,
  downDollars: 80000,
  rate: 7.32,
  rateTouched: true,
  placeId: 'sarasota',
  taxAnnual: 5000,
  taxTouched: true,
  insuranceMonthly: 200,
  insuranceTouched: true,
  hoaTouched: false,
  communityId: 'wellen-park'
}, data);
assert.strictEqual(estimateOnly.lines.find(l => l.id === 'hoa').omitted, true);
assert.ok(estimateOnly.notes.some(n => /estimate/i.test(n)));

const cityGap = buildEstimate({
  price: 300000,
  downDollars: 60000,
  rate: 7.32,
  rateTouched: true,
  placeId: 'venice',
  taxTouched: false,
  insuranceMonthly: 100,
  insuranceTouched: true,
  hoaTouched: false
}, data);
near(cityGap.lines.find(l => l.id === 'tax').range.low, 300000 * 12.7527 / 1000 / 12, 'Venice uses the county average');
near(cityGap.lines.find(l => l.id === 'tax').range.high, cityGap.lines.find(l => l.id === 'tax').range.low, 'Venice has no city millage range');

const page = fs.readFileSync(path.join(__dirname, '..', 'mortgage.html'), 'utf8');
const calc = fs.readFileSync(path.join(__dirname, '..', 'mortgage.js'), 'utf8');
assert.ok(page.includes('https://calendar.app.google/5xtMmGSY9kCY5NRk7'));
assert.ok(!page.includes('8GQc'));
assert.ok(page.includes('assets/mortgage/step1.jpg'));
assert.ok(page.includes('rgba(13,34,53,.45)'));
assert.ok(calc.includes('The exact monthly figure depends on the lot.'));

console.log('mortgage checks passed');
