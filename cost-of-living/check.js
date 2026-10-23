const fs = require('fs');
const doc = JSON.parse(fs.readFileSync(__dirname + '/cost-of-living.json', 'utf8'));
const areas = new Set(doc.areas.map(a => a.id));
const cats = new Set(doc.categories.map(c => c.id));
if (doc.status !== 'DESIGN_PREVIEW') throw new Error('status');
if (!/placeholder/i.test(doc.banner)) throw new Error('banner');
for (const f of doc.figures) {
  for (const key of ['source', 'url', 'asOf', 'display', 'value']) {
    if (!(key in f)) throw new Error('missing ' + key);
  }
  if (f.value !== null) throw new Error('value set ' + f.areaId + ' ' + f.categoryId);
  if (/\d/.test(f.display)) throw new Error('digit in display ' + f.display);
  if (!areas.has(f.areaId) || !cats.has(f.categoryId)) throw new Error('unknown id');
  if (f.source !== 'SOURCE NOT CHOSEN') throw new Error('source filled in');
  if (f.url !== '') throw new Error('url filled in');
  if (f.asOf !== 'DATE NOT CHOSEN') throw new Error('asOf filled in');
}
const expected = doc.areas.length * doc.categories.length;
if (doc.figures.length !== expected) throw new Error('figure count ' + doc.figures.length);
const gulf = ['manatee', 'hillsborough', 'pinellas', 'sarasota', 'venice'];
for (const id of gulf) {
  const tax = doc.figures.find(f => f.areaId === id && f.categoryId === 'state-income-tax');
  if (tax.display !== 'No state income tax') throw new Error('florida tax label ' + id);
}
console.log('Preview bundle ok:', doc.figures.length, 'placeholder figures,', doc.openQuestions.length, 'open questions');
