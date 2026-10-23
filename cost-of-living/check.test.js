const assert = require('assert');
const path = require('path');
const { check, load, CBSA_FOR } = require('./check.js');
const lookup = require('./lookup.js');

const file = path.join(__dirname, 'cost-of-living.json');
const doc = load(file);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function throws(fn, pattern) {
  assert.throws(fn, pattern instanceof RegExp ? pattern : new RegExp(pattern));
}

function sourcedFigure(base) {
  return Object.assign({}, base, {
    value: 12,
    status: 'sourced',
    url: 'https://example.com/source',
    license: 'Public domain',
    asOf: '2024',
    retrieved: '2026-01-15',
    source: 'Example agency',
    evidence: 'MEASURED',
    linkLabel: 'Example agency table'
  });
}

// B1. Metro codes match the named metros, on the file and on every figure.
Object.keys(CBSA_FOR).forEach(function (id) {
  const area = doc.areas.find(function (item) { return item.id === id; });
  assert.strictEqual(area.cbsa, CBSA_FOR[id], id);
  doc.figures.filter(function (figure) { return figure.areaId === id; }).forEach(function (figure) {
    assert.strictEqual(figure.areaCodes.cbsa, CBSA_FOR[id], id + ' ' + figure.categoryId);
  });
});
assert.strictEqual(CBSA_FOR.manatee, '35840');
assert.strictEqual(CBSA_FOR.sarasota, '35840');
assert.strictEqual(CBSA_FOR.venice, '35840');
assert.strictEqual(CBSA_FOR['north-port'], '35840');
assert.strictEqual(CBSA_FOR.hillsborough, '45300');
assert.strictEqual(CBSA_FOR.pinellas, '45300');
const swapped = clone(doc);
const manatee = swapped.areas.find(function (area) { return area.id === 'manatee'; });
manatee.cbsa = '45300';
swapped.figures.forEach(function (figure) {
  if (figure.areaId === 'manatee') figure.areaCodes.cbsa = '45300';
});
throws(function () { check(swapped); }, /CBSA for manatee/);

// B2. ZIP, county, metro, state, then Not available. A null value still matches.
const chain = {
  crosswalk: doc.crosswalk,
  nationalTables: {
    fallback: ['zip', 'county', 'cbsa', 'state'],
    rows: [
      { geoLevel: 'zip', geoId: '00000', categoryId: 'groceries', componentId: null, value: 1 },
      { geoLevel: 'county', geoId: '99000', categoryId: 'groceries', componentId: null, value: 2 },
      { geoLevel: 'cbsa', geoId: '99999', categoryId: 'groceries', componentId: null, value: 3 },
      { geoLevel: 'state', geoId: 'XX', categoryId: 'groceries', componentId: null, value: 4 }
    ]
  }
};
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').level, 'ZIP value');
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').figure.value, 1);
chain.nationalTables.rows = chain.nationalTables.rows.filter(function (row) { return row.geoLevel !== 'zip'; });
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').level, 'county value');
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').figure.value, 2);
chain.nationalTables.rows = [{ geoLevel: 'county', geoId: '99000', categoryId: 'groceries', componentId: null, value: null, display: 'PLACEHOLDER' }];
const countyOnly = lookup.lookup(chain, '00000', 'groceries');
assert.strictEqual(countyOnly.level, 'county value');
assert.strictEqual(countyOnly.figure.value, null);
chain.nationalTables.rows = [{ geoLevel: 'cbsa', geoId: '99999', categoryId: 'groceries', componentId: null, value: 3 }];
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').level, 'metro value');
chain.nationalTables.rows = [{ geoLevel: 'state', geoId: 'XX', categoryId: 'groceries', componentId: null, value: 4 }];
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').level, 'state value');
chain.nationalTables.rows = [];
assert.strictEqual(lookup.lookup(chain, '00000', 'groceries').level, 'Not available');
assert.strictEqual(lookup.lookup(chain, '11111', 'groceries').level, 'Not available');
assert.strictEqual(lookup.resolveKeys(doc.crosswalk, '00000').sample, true);
assert.strictEqual(lookup.resolveKeys(doc.crosswalk, '34285').county, '');
assert.ok(doc.crosswalk.zips.every(function (row) { return row.label === 'SAMPLE'; }));

// B3. DESIGN_PREVIEW keeps its rules. SOURCED accepts a complete measured figure.
check(doc);
check(doc, 'DESIGN_PREVIEW');
const numbered = clone(doc);
numbered.figures[0].value = 100.89;
numbered.figures[0].source = 'Example agency';
throws(function () { check(numbered); }, /numeric value in design preview/);
throws(function () { check(numbered, 'DESIGN_PREVIEW'); }, /numeric value in design preview/);
const priced = clone(doc);
const grocery = priced.figures.find(function (figure) { return figure.areaId === 'manatee' && figure.categoryId === 'groceries'; });
Object.assign(grocery, sourcedFigure(grocery));
check(priced, 'SOURCED');
const unnamed = clone(priced);
unnamed.figures.find(function (figure) { return figure.areaId === 'manatee' && figure.categoryId === 'groceries'; }).source = 'SOURCE NOT CHOSEN';
throws(function () { check(unnamed, 'SOURCED'); }, /SOURCE NOT CHOSEN/);
throws(function () { check(unnamed, 'DESIGN_PREVIEW'); }, /SOURCE NOT CHOSEN/);
['url', 'license', 'asOf', 'retrieved', 'evidence'].forEach(function (key) {
  const broken = clone(priced);
  const figure = broken.figures.find(function (item) { return item.areaId === 'manatee' && item.categoryId === 'groceries'; });
  if (key === 'url') figure.url = 'http://example.com/source';
  if (key === 'license') figure.license = 'LICENSE NOT CHOSEN';
  if (key === 'asOf') figure.asOf = null;
  if (key === 'retrieved') figure.retrieved = null;
  if (key === 'evidence') figure.evidence = 'INFERENCE';
  throws(function () { check(broken, 'SOURCED'); }, new RegExp('sourced ' + (key === 'evidence' ? 'evidence' : key)));
});

// M1. Annual dollars become monthly before the sum. An index is not an amount.
assert.strictEqual(lookup.monthlyAmount({ value: 120, unit: 'USD/year' }), 10);
assert.strictEqual(lookup.monthlyAmount({ value: 5, unit: 'USD/month' }), 5);
assert.strictEqual(lookup.sumMonthly([{ value: 120, unit: 'USD/year' }, { value: 5, unit: 'USD/month' }]), 15);
assert.strictEqual(lookup.sumMonthly([{ value: null, unit: 'USD/year' }]), null);
assert.strictEqual(lookup.monthlyAmount({ value: 100, unit: 'index' }), null);
assert.strictEqual(lookup.sumMonthly([{ value: 120, unit: 'USD/year' }, { value: null, unit: 'USD/month' }]), null);

// M2. A skipped tenure shows both housing lines and does not default to rent.
assert.deepStrictEqual(lookup.housingTenures(''), ['rent', 'own']);
assert.deepStrictEqual(lookup.housingTenures('skip'), ['rent', 'own']);
assert.deepStrictEqual(lookup.housingTenures('rent'), ['rent']);
assert.deepStrictEqual(lookup.housingTenures('own'), ['own']);
assert.strictEqual(lookup.rowLabel({ id: 'housing', label: 'Housing' }, 'rent'), 'Gross rent');
assert.strictEqual(lookup.rowLabel({ id: 'housing', label: 'Housing' }, 'own'), 'Principal and interest');
assert.strictEqual(lookup.rowLabel({ id: 'utilities', label: 'Utilities', hiddenFor: 'rent' }, '').indexOf('If you buy'), 0);
assert.strictEqual(lookup.rowLabel({ id: 'property-tax', label: 'Property tax', hiddenFor: 'rent' }, 'skip').indexOf('If you buy'), 0);
const housingRows = [{ tenure: 'rent', display: 'Gross rent' }, { tenure: 'own', display: 'Principal and interest' }];
assert.strictEqual(lookup.figureMatch(housingRows, ''), null);
assert.strictEqual(lookup.figureMatch(housingRows, 'skip'), null);
assert.strictEqual(lookup.figureMatch(housingRows, 'rent').tenure, 'rent');
assert.strictEqual(lookup.figureMatch(housingRows, 'own').tenure, 'own');
assert.strictEqual(lookup.figureMatch([{ tenure: 'own', display: 'Utilities' }], '').tenure, 'own');

// M3. Each link uses its own label.
const flood = doc.figures.filter(function (figure) { return figure.url; });
assert.ok(flood.length > 0);
flood.forEach(function (figure) {
  assert.strictEqual(lookup.linkText(figure), figure.linkLabel);
  assert.notStrictEqual(figure.linkLabel, 'FEMA flood map');
});
assert.strictEqual(lookup.linkText({ url: 'https://example.com/a', linkLabel: 'BEA regional price parities', source: 'BEA' }), 'BEA regional price parities');
assert.strictEqual(lookup.linkText({ url: 'https://example.com/b', source: 'HUD fair market rents' }), 'HUD fair market rents');
assert.strictEqual(lookup.linkText({ url: '', linkLabel: 'FEMA flood map', source: 'FEMA' }), '');

// L1. Venice and North Port place codes stay flagged unverified.
['venice', 'north-port'].forEach(function (id) {
  const rows = doc.figures.filter(function (figure) { return figure.areaId === id; });
  assert.ok(rows.length > 0);
  rows.forEach(function (figure) {
    assert.match(figure.caveat, /UNVERIFIED/);
  });
});

// L2 and L3. Area and category entries, including unit and period.
const missingFips = clone(doc);
delete missingFips.areas.find(function (area) { return area.id === 'manatee'; }).fips;
throws(function () { check(missingFips); }, /area fips manatee/);
const badCbsa = clone(doc);
badCbsa.areas.find(function (area) { return area.id === 'pinellas'; }).cbsa = '4530';
badCbsa.figures.forEach(function (figure) {
  if (figure.areaId === 'pinellas') figure.areaCodes.cbsa = '4530';
});
throws(function () { check(badCbsa); }, /area cbsa pinellas/);
const thinCategory = clone(doc);
delete thinCategory.categories[0].definition;
throws(function () { check(thinCategory); }, /category entry/);
const week = clone(doc);
week.categories.find(function (category) { return category.id === 'groceries'; }).period = 'year';
week.figures.forEach(function (figure) {
  if (figure.categoryId === 'groceries') figure.period = 'year';
});
throws(function () { check(week); }, /unit\/period/);
const badDate = clone(doc);
badDate.figures[0].asOf = 'Oct 2026';
throws(function () { check(badDate); }, /asOf date/);
doc.categories.forEach(function (category) {
  if (category.unit === 'USD/month') assert.strictEqual(category.period, 'month');
  if (category.unit === 'USD/year') assert.strictEqual(category.period, 'year');
  if (category.unit === 'index') assert.strictEqual(category.period, 'year');
});

console.log('cost-of-living checks passed');
