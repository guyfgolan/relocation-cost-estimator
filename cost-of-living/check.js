const fs = require('fs');
const doc = JSON.parse(fs.readFileSync(__dirname + '/cost-of-living.json', 'utf8'));
const ASOF = /^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}|FY\d{4})$/;
const RETRIEVED = /^\d{4}-\d{2}-\d{2}$/;
const TENURE = new Set(['rent', 'own', 'both', null]);
const keys = ['unit', 'period', 'geoLevel', 'geoId', 'areaCodes', 'retrieved', 'license', 'caveat', 'asOf', 'source', 'url', 'display', 'value', 'tenure'];
if (doc.status !== 'DESIGN_PREVIEW') throw new Error('status');
if (!/placeholder/i.test(doc.banner)) throw new Error('banner');
if (!doc.areas.some(a => a.id === 'north-port' && a.kind === 'place')) throw new Error('North Port column');
if (!Array.isArray(doc.nationalTables.rows)) throw new Error('national tables');
for (const f of doc.figures) {
  for (const key of keys) {
    if (!(key in f)) throw new Error('missing ' + key + ' on ' + f.areaId + ' ' + f.categoryId);
  }
  for (const key of ['fips', 'cbsa', 'placeFips', 'zips']) {
    if (!(key in f.areaCodes)) throw new Error('missing area code ' + key);
  }
  if (!TENURE.has(f.tenure)) throw new Error('tenure ' + f.tenure);
  if (f.asOf !== null && !ASOF.test(f.asOf)) throw new Error('asOf date ' + f.asOf);
  if (f.retrieved !== null && !RETRIEVED.test(f.retrieved)) throw new Error('retrieved date ' + f.retrieved);
  if (f.areaId === 'reader') throw new Error('reader figures are looked up, not stored');
}
if (doc.status === 'DESIGN_PREVIEW') {
  for (const f of doc.figures) {
    if (f.value !== null) throw new Error('numeric value in design preview');
    if (/\d/.test(f.display)) throw new Error('digit in display ' + f.display);
    if (f.display.includes('$')) throw new Error('dollar amount in display ' + f.display);
  }
}
const gulf = ['manatee', 'hillsborough', 'pinellas', 'sarasota', 'venice', 'north-port'];
for (const id of gulf) {
  const tax = doc.figures.find(f => f.areaId === id && f.categoryId === 'state-income-tax');
  if (!tax || tax.display !== 'No state income tax') throw new Error('florida tax label ' + id);
  const flood = doc.figures.find(f => f.areaId === id && f.categoryId === 'insurance-flood');
  if (!flood || flood.display !== 'Not estimated: depends on the address') throw new Error('flood label ' + id);
}
console.log('Preview bundle ok:', doc.figures.length, 'placeholder figures,', doc.areas.length, 'Gulf columns');
