const fs = require('fs');
const path = require('path');

const ASOF = /^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}|FY\d{4})$/;
const RETRIEVED = /^\d{4}-\d{2}-\d{2}$/;
const TENURE = new Set(['rent', 'own', 'both', null]);
const FIPS5 = /^\d{5}$/;
const FIPS7 = /^\d{7}$/;
const CBSA_FOR = {
  manatee: '35840',
  sarasota: '35840',
  venice: '35840',
  'north-port': '35840',
  hillsborough: '45300',
  pinellas: '45300'
};
const FIGURE_KEYS = ['unit', 'period', 'geoLevel', 'geoId', 'areaCodes', 'retrieved', 'license', 'caveat', 'asOf', 'source', 'url', 'display', 'value', 'tenure'];

function fail(message) {
  throw new Error(message);
}

function periodMatchesUnit(unit, period) {
  if (unit === 'USD/month') return period === 'month';
  if (unit === 'USD/year') return period === 'year';
  if (unit === 'index') return period === 'year';
  return false;
}

function checkAreas(doc) {
  if (!Array.isArray(doc.areas) || !doc.areas.length) fail('areas');
  const ids = new Set();
  doc.areas.forEach(function (area) {
    if (!area.id || !area.name || !area.kind) fail('area entry ' + (area && area.id));
    if (ids.has(area.id)) fail('duplicate area ' + area.id);
    ids.add(area.id);
    if (area.kind !== 'county' && area.kind !== 'place') fail('area kind ' + area.id);
    if (!FIPS5.test(area.fips || '')) fail('area fips ' + area.id);
    if (!FIPS5.test(area.cbsa || '')) fail('area cbsa ' + area.id);
    if (area.placeFips != null && !FIPS7.test(area.placeFips)) fail('place FIPS ' + area.id);
    if (area.kind === 'place' && !FIPS7.test(area.placeFips || '')) fail('place missing place FIPS ' + area.id);
    if (!Array.isArray(area.zips)) fail('area zips ' + area.id);
    if (CBSA_FOR[area.id] && area.cbsa !== CBSA_FOR[area.id]) fail('CBSA for ' + area.id + ' is ' + area.cbsa + ', expected ' + CBSA_FOR[area.id]);
  });
  Object.keys(CBSA_FOR).forEach(function (id) {
    if (!doc.areas.some(function (area) { return area.id === id; })) fail('missing area ' + id);
  });
}

function checkCategories(doc) {
  if (!Array.isArray(doc.categories) || !doc.categories.length) fail('categories');
  const ids = new Set();
  doc.categories.forEach(function (category) {
    if (!category.id || !category.label || !category.definition) fail('category entry ' + (category && category.id));
    if (ids.has(category.id)) fail('duplicate category ' + category.id);
    ids.add(category.id);
    if (typeof category.inMonthlySum !== 'boolean') fail('category inMonthlySum ' + category.id);
    if (!periodMatchesUnit(category.unit, category.period)) fail('category unit/period ' + category.id);
    if (category.components && !Array.isArray(category.components)) fail('category components ' + category.id);
  });
}

function checkCrosswalk(doc) {
  if (!doc.crosswalk || !Array.isArray(doc.crosswalk.zips)) fail('crosswalk');
  doc.crosswalk.zips.forEach(function (row) {
    if (!FIPS5.test(row.zip || '')) fail('crosswalk zip');
    if (!FIPS5.test(row.countyFips || '')) fail('crosswalk county');
    if (!FIPS5.test(row.cbsa || '')) fail('crosswalk cbsa');
    if (!row.state) fail('crosswalk state');
    if (doc.status === 'DESIGN_PREVIEW' && row.label !== 'SAMPLE') fail('crosswalk row is not labeled SAMPLE');
  });
}

function sourcedFigure(figure) {
  if (typeof figure.value !== 'number' || Number.isNaN(figure.value)) fail('sourced value ' + figure.areaId + ' ' + figure.categoryId);
  if (!figure.url || !/^https:\/\//.test(figure.url)) fail('sourced url ' + figure.areaId + ' ' + figure.categoryId);
  if (!figure.license || figure.license === 'LICENSE NOT CHOSEN') fail('sourced license ' + figure.areaId + ' ' + figure.categoryId);
  if (figure.asOf == null || !ASOF.test(figure.asOf)) fail('sourced asOf ' + figure.areaId + ' ' + figure.categoryId);
  if (figure.retrieved == null || !RETRIEVED.test(figure.retrieved)) fail('sourced retrieved ' + figure.areaId + ' ' + figure.categoryId);
  if (!figure.source || figure.source === 'SOURCE NOT CHOSEN') fail('sourced source ' + figure.areaId + ' ' + figure.categoryId);
  if (figure.evidence !== 'MEASURED') fail('sourced evidence ' + figure.areaId + ' ' + figure.categoryId);
  if (!figure.geoLevel) fail('sourced geography ' + figure.areaId + ' ' + figure.categoryId);
}

function check(doc, mode) {
  if (!doc || (doc.status !== 'DESIGN_PREVIEW' && doc.status !== 'SOURCED' && !mode)) fail('status');
  const use = mode || doc.status;
  if (!/placeholder/i.test(doc.banner || '') && use === 'DESIGN_PREVIEW') fail('banner');
  if (!doc.areas.some(function (area) { return area.id === 'north-port' && area.kind === 'place'; })) fail('North Port column');
  if (!doc.nationalTables || !Array.isArray(doc.nationalTables.rows)) fail('national tables');
  if (!doc.nationalTables.fallback || doc.nationalTables.fallback.join(',') !== 'zip,county,cbsa,state') fail('fallback order');
  checkAreas(doc);
  checkCategories(doc);
  checkCrosswalk(doc);
  const areaIds = new Set(doc.areas.map(function (area) { return area.id; }));
  const categoryIds = new Set(doc.categories.map(function (category) { return category.id; }));
  doc.figures.forEach(function (figure) {
    FIGURE_KEYS.forEach(function (key) {
      if (!(key in figure)) fail('missing ' + key + ' on ' + figure.areaId + ' ' + figure.categoryId);
    });
    ['fips', 'cbsa', 'placeFips', 'zips'].forEach(function (key) {
      if (!(key in figure.areaCodes)) fail('missing area code ' + key);
    });
    if (!TENURE.has(figure.tenure)) fail('tenure ' + figure.tenure);
    if (!periodMatchesUnit(figure.unit, figure.period)) fail('figure unit/period ' + figure.areaId + ' ' + figure.categoryId);
    if (figure.asOf !== null && !ASOF.test(figure.asOf)) fail('asOf date ' + figure.asOf);
    if (figure.retrieved !== null && !RETRIEVED.test(figure.retrieved)) fail('retrieved date ' + figure.retrieved);
    if (figure.areaId === 'reader') fail('reader figures are looked up, not stored');
    if (!areaIds.has(figure.areaId)) fail('figure area ' + figure.areaId);
    if (!categoryIds.has(figure.categoryId)) fail('figure category ' + figure.categoryId);
    const area = doc.areas.find(function (item) { return item.id === figure.areaId; });
    if (figure.areaCodes.cbsa !== area.cbsa) fail('figure CBSA ' + figure.areaId + ' ' + figure.categoryId);
    if (figure.value != null && figure.source === 'SOURCE NOT CHOSEN') fail('SOURCE NOT CHOSEN with a value');
    if (figure.url && !figure.linkLabel) fail('link without its own label');
  });
  ['venice', 'north-port'].forEach(function (id) {
    doc.figures.filter(function (figure) { return figure.areaId === id; }).forEach(function (figure) {
      if (!/UNVERIFIED/.test(figure.caveat || '')) fail('place code caveat ' + id);
    });
  });
  const gulf = ['manatee', 'hillsborough', 'pinellas', 'sarasota', 'venice', 'north-port'];
  gulf.forEach(function (id) {
    const tax = doc.figures.find(function (figure) { return figure.areaId === id && figure.categoryId === 'state-income-tax'; });
    if (!tax || tax.display !== 'No state income tax') fail('florida tax label ' + id);
    const flood = doc.figures.find(function (figure) { return figure.areaId === id && figure.categoryId === 'insurance-flood'; });
    if (!flood || flood.display !== 'Not estimated: depends on the address') fail('flood label ' + id);
  });
  if (use === 'DESIGN_PREVIEW') {
    doc.figures.forEach(function (figure) {
      if (figure.value !== null) fail('numeric value in design preview');
      if (/\d/.test(figure.display)) fail('digit in display ' + figure.display);
      if (String(figure.display).includes('$')) fail('dollar amount in display ' + figure.display);
    });
  }
  if (use === 'SOURCED') {
    doc.figures.forEach(function (figure) {
      if (figure.value != null) sourcedFigure(figure);
    });
  }
  return doc;
}

function load(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

if (require.main === module) {
  const doc = load(path.join(__dirname, 'cost-of-living.json'));
  check(doc);
  console.log('Preview bundle ok:', doc.figures.length, 'placeholder figures,', doc.areas.length, 'Gulf columns');
}

module.exports = { check: check, load: load, CBSA_FOR: CBSA_FOR };
