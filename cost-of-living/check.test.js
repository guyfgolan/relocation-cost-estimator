const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { check, load, loadShards, CBSA_FOR } = require('./check.js');
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
  crosswalk: {
    zips: [
      { zip: '00000', label: 'SAMPLE', countyFips: '99000', countyName: 'Sample County', cbsa: '99999', cbsaName: 'Sample Metro', state: 'XX' }
    ]
  },
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
assert.strictEqual(lookup.resolveKeys(chain.crosswalk, '00000').sample, true);
assert.strictEqual(lookup.resolveKeys(chain.crosswalk, '34285').county, '');
assert.ok(chain.crosswalk.zips.every(function (row) { return row.label === 'SAMPLE'; }));

// B3. DESIGN_PREVIEW keeps its rules. SOURCED accepts a complete measured figure.
check(doc);
check(doc, 'SOURCED');
throws(function () { check(doc, 'DESIGN_PREVIEW'); }, /numeric value in design preview/);
const numbered = clone(doc);
numbered.status = 'DESIGN_PREVIEW';
numbered.figures.forEach(function (figure) {
  if (figure.categoryId !== 'price-index') return;
  figure.value = null;
  figure.display = 'PLACEHOLDER';
  figure.status = 'placeholder';
  figure.evidence = null;
  figure.url = '';
  figure.source = 'SOURCE NOT CHOSEN';
  figure.asOf = null;
  figure.retrieved = null;
});
numbered.nationalTables.rows = [];
const groceryPreview = numbered.figures.find(function (figure) { return figure.areaId === 'manatee' && figure.categoryId === 'groceries'; });
groceryPreview.value = 12;
groceryPreview.source = 'Example agency';
throws(function () { check(numbered, 'DESIGN_PREVIEW'); }, /numeric value in design preview/);
const priced = clone(doc);
priced.figures.forEach(function (figure) {
  if (figure.categoryId === 'groceries' && (figure.componentId || null) === null) Object.assign(figure, sourcedFigure(figure));
});
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

// Place codes Dexter verified against the Census 2020 Florida place file.
['venice', 'north-port'].forEach(function (id) {
  const area = doc.areas.find(function (item) { return item.id === id; });
  assert.match(area.note, /verified/i);
  assert.doesNotMatch(area.note, /unverified/i);
  doc.figures.filter(function (figure) { return figure.areaId === id; }).forEach(function (figure) {
    assert.doesNotMatch(figure.caveat || '', /UNVERIFIED/);
  });
});
assert.strictEqual(doc.areas.find(function (area) { return area.id === 'venice'; }).placeFips, '1273900');
assert.strictEqual(doc.areas.find(function (area) { return area.id === 'north-port'; }).placeFips, '1249675');

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

// BEA Regional Price Parities 2024. Values are the shipped figures, unchanged.
assert.strictEqual(doc.status, 'SOURCED');
const metroRows = doc.nationalTables.rows.filter(function (row) { return row.geoLevel === 'cbsa'; });
const stateRows = doc.nationalTables.rows.filter(function (row) { return row.geoLevel === 'state'; });
assert.strictEqual(metroRows.length, 1935);
assert.strictEqual(stateRows.length, 255);
assert.strictEqual(doc.nationalTables.rows.length, 2190);
metroRows.concat(stateRows).forEach(function (row) {
  assert.strictEqual(row.categoryId, 'price-index');
  assert.strictEqual(row.evidence, 'MEASURED');
  assert.strictEqual(row.status, 'sourced');
  assert.strictEqual(row.asOf, '2024');
  assert.strictEqual(row.source, 'U.S. Bureau of Economic Analysis, Regional Price Parities');
});
const measured = doc.figures.filter(function (figure) { return figure.evidence === 'MEASURED'; });
assert.strictEqual(measured.length, 30);
measured.forEach(function (figure) {
  assert.strictEqual(figure.categoryId, 'price-index');
  assert.strictEqual(figure.status, 'sourced');
});
function gulf(areaId, componentId) {
  return doc.figures.find(function (figure) {
    return figure.areaId === areaId && figure.categoryId === 'price-index' && figure.componentId === componentId;
  });
}
['manatee', 'sarasota', 'venice', 'north-port'].forEach(function (areaId) {
  assert.strictEqual(gulf(areaId, null).value, 102.417);
  assert.strictEqual(gulf(areaId, null).display, '102.4');
  assert.strictEqual(gulf(areaId, 'goods').value, 96.24);
  assert.strictEqual(gulf(areaId, 'goods').display, '96.2');
  assert.strictEqual(gulf(areaId, 'housing').value, 127.95);
  assert.strictEqual(gulf(areaId, 'housing').display, '128.0');
  assert.strictEqual(gulf(areaId, 'utilities').value, 88.171);
  assert.strictEqual(gulf(areaId, 'utilities').display, '88.2');
  assert.strictEqual(gulf(areaId, 'other-services').value, 98.864);
  assert.strictEqual(gulf(areaId, 'other-services').display, '98.9');
});
['hillsborough', 'pinellas'].forEach(function (areaId) {
  assert.strictEqual(gulf(areaId, null).value, 100.89);
  assert.strictEqual(gulf(areaId, null).display, '100.9');
  assert.strictEqual(gulf(areaId, 'goods').value, 95.47);
  assert.strictEqual(gulf(areaId, 'goods').display, '95.5');
  assert.strictEqual(gulf(areaId, 'housing').value, 125.839);
  assert.strictEqual(gulf(areaId, 'housing').display, '125.8');
  assert.strictEqual(gulf(areaId, 'utilities').value, 88.525);
  assert.strictEqual(gulf(areaId, 'utilities').display, '88.5');
  assert.strictEqual(gulf(areaId, 'other-services').value, 97.565);
  assert.strictEqual(gulf(areaId, 'other-services').display, '97.6');
});
function national(level, geoId, componentId) {
  return doc.nationalTables.rows.find(function (row) {
    return row.geoLevel === level && row.geoId === geoId && row.componentId === componentId;
  });
}
assert.strictEqual(national('cbsa', '35840', null).value, 102.417);
assert.strictEqual(national('cbsa', '45300', null).value, 100.89);
assert.strictEqual(national('cbsa', '18140', null).value, 95.469);
assert.strictEqual(national('cbsa', '18140', 'housing').value, 87.945);
assert.strictEqual(national('cbsa', '11260', null).value, 105.42);
assert.strictEqual(national('state', 'MT', null).value, 94.645);
const indexCategory = doc.categories.find(function (category) { return category.id === 'price-index'; });
assert.deepStrictEqual(indexCategory.components.map(function (component) { return component.id; }), ['goods', 'housing', 'utilities', 'other-services']);
doc.figures.filter(function (figure) { return figure.categoryId !== 'price-index'; }).forEach(function (figure) {
  assert.strictEqual(figure.value, null);
  assert.notStrictEqual(figure.status, 'sourced');
});
assert.strictEqual(doc.crosswalk.zipCount, 33791);
assert.strictEqual(doc.crosswalk.shards.length, 896);
assert.strictEqual(doc.crosswalk.evidence, 'MEASURED');
assert.ok(!doc.crosswalk.zips);
const withZips = {
  crosswalk: {
    zips: [
      { zip: '43215', countyFips: '39049', cbsa: '18140', state: 'OH', label: 'TEST' },
      { zip: '99501', countyFips: '02020', cbsa: '11260', state: 'AK', label: 'TEST' },
      { zip: '59001', countyFips: '30003', cbsa: '', state: 'MT', label: 'TEST' }
    ]
  },
  nationalTables: doc.nationalTables
};
assert.strictEqual(lookup.lookup(withZips, '43215', 'price-index', null).level, 'metro value');
assert.strictEqual(lookup.lookup(withZips, '43215', 'price-index', null).figure.value, 95.469);
assert.strictEqual(lookup.lookup(withZips, '43215', 'price-index', 'housing').figure.value, 87.945);
assert.strictEqual(lookup.lookup(withZips, '99501', 'price-index', null).figure.value, 105.42);
assert.strictEqual(lookup.lookup(withZips, '59001', 'price-index', null).level, 'state value');
assert.strictEqual(lookup.lookup(withZips, '59001', 'price-index', null).figure.value, 94.645);
assert.strictEqual(lookup.lookup(withZips, '12345', 'price-index', null).level, 'Not available');

const emptySourced = clone(doc);
const emptyFigure = emptySourced.figures.find(function (figure) { return figure.areaId === 'manatee' && figure.categoryId === 'groceries'; });
emptyFigure.status = 'sourced';
emptyFigure.value = null;
throws(function () { check(emptySourced, 'SOURCED'); }, /sourced record has no value/);
const emptyRow = clone(doc);
emptyRow.nationalTables.rows[0].value = null;
throws(function () { check(emptyRow, 'SOURCED'); }, /sourced record has no value/);
const mixed = clone(doc);
mixed.figures.find(function (figure) { return figure.areaId === 'venice' && figure.categoryId === 'price-index' && figure.componentId === null; }).asOf = '2023';
throws(function () { check(mixed, 'SOURCED'); }, /mixed source or vintage/);
const bareLookup = clone(doc);
bareLookup.nationalTables.rows[0].url = 'http://example.com/not-https';
throws(function () { check(bareLookup, 'SOURCED'); }, /sourced url/);

function lookupZip(zip) {
  const file = path.join(__dirname, 'zips', zip.slice(0, 3) + '.json');
  const shard = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { zips: [] };
  return lookup.lookup({ crosswalk: shard, nationalTables: doc.nationalTables }, zip, 'price-index', null);
}
const tampa = lookupZip('33602');
assert.strictEqual(tampa.keys.cbsa, '45300');
assert.strictEqual(tampa.level, 'metro value');
assert.strictEqual(tampa.figure.value, 100.89);
['34285', '34293'].forEach(function (zip) {
  const found = lookupZip(zip);
  assert.strictEqual(found.keys.cbsa, '35840');
  assert.strictEqual(found.keys.county, '12115');
  assert.strictEqual(found.level, 'metro value');
  assert.strictEqual(found.figure.value, 102.417);
});
const columbus = lookupZip('43215');
assert.strictEqual(columbus.keys.cbsa, '18140');
assert.strictEqual(columbus.keys.cbsaName, 'Columbus, OH');
assert.strictEqual(columbus.level, 'metro value');
assert.strictEqual(columbus.figure.value, 95.469);
assert.strictEqual(columbus.figure.display, '95.5');
const newYork = lookupZip('10001');
assert.strictEqual(newYork.keys.cbsa, '35620');
assert.strictEqual(newYork.keys.state, 'NY');
assert.strictEqual(newYork.level, 'metro value');
assert.strictEqual(newYork.figure.value, 112.563);
const puertoRico = lookupZip('00601');
assert.strictEqual(puertoRico.keys.cbsa, '');
assert.strictEqual(puertoRico.keys.state, 'PR');
assert.strictEqual(puertoRico.level, 'Not available');
const missing = lookupZip('12345');
assert.strictEqual(missing.keys.county, '');
assert.strictEqual(missing.level, 'Not available');
const rural = lookupZip('01054');
assert.strictEqual(rural.keys.cbsa, '');
assert.strictEqual(rural.keys.state, 'MA');
assert.strictEqual(rural.level, 'state value');
assert.strictEqual(rural.figure.value, 105.757);

const shardRows = loadShards(path.join(__dirname, 'zips'), doc.crosswalk.shards);
let zipTotal = 0;
let nullMetro = 0;
shardRows.forEach(function (shard) {
  shard.zips.forEach(function (row) {
    zipTotal += 1;
    if (row.cbsa == null) nullMetro += 1;
    assert.notStrictEqual(row.cbsa, '47930');
  });
});
assert.strictEqual(zipTotal, 33791);
assert.strictEqual(nullMetro, 15068);
const nullOk = clone(doc);
nullOk.crosswalk.shards = ['010'];
nullOk.crosswalk.zipCount = 1;
check(nullOk, 'SOURCED', [{ prefix: '010', zips: [{ zip: '01054', countyFips: '25011', cbsa: null, state: 'MA' }] }]);
const badMetro = clone(doc);
badMetro.crosswalk.shards = ['010'];
badMetro.crosswalk.zipCount = 1;
throws(function () {
  check(badMetro, 'SOURCED', [{ prefix: '010', zips: [{ zip: '01054', countyFips: '25011', cbsa: '12', state: 'MA' }] }]);
}, /crosswalk cbsa/);

console.log('cost-of-living checks passed');
