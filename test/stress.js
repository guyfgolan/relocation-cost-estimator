const fs = require('fs');
const path = require('path');
const { estimateMove, classifyZip, formatMoney, priceCore } = require('../estimate.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
const Z = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'zips.json'), 'utf8'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  }
}
function near(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b})`);
}

function originZip(zip) {
  const found = classifyZip(zip, Z);
  assert(found.ok, `zip ${zip} should resolve`);
  return { lat: found.lat, lon: found.lon, state: found.state, label: `ZIP ${zip}, ${found.state}`, via: 'zip' };
}
function area(id) {
  return D.areas.find(a => a.id === id);
}
function atMiles(road, state) {
  const origin = { lat: 27, lon: -82, state: state || 'Georgia', label: 'Test origin', via: 'city' };
  const gc = road / D.distance.factor;
  const dlat = (gc / 3958.7613) * (180 / Math.PI);
  const dest = { lat: origin.lat + dlat, lon: origin.lon, name: 'Test dest', point: 'Test point.', id: 'test', county: 'Sarasota' };
  return { origin, dest };
}

const base = {
  when: 'March 2027', type: 'Single-story house', size: '3 bedrooms',
  packing: 'None', veh: '1', vehHow: 'Drive them', travel: 'Driving',
  adults: '2', licenses: '1', storage: 'No'
};

// Destination list
const names = D.areas.map(a => a.name);
for (const gone of ['Port Charlotte', 'Punta Gorda', 'Fort Myers', 'Cape Coral', 'Wesley Chapel']) {
  assert(!names.includes(gone), `removed destination still present: ${gone}`);
}
for (const stay of ['North Port', 'Wellen Park', 'Sarasota', 'Venice', 'Parrish', 'Lakewood Ranch']) {
  assert(names.includes(stay), `missing kept destination ${stay}`);
}
for (const added of ['Tampa', 'Brandon', 'Riverview', 'Apollo Beach', 'Plant City', 'Pebble Creek', 'St. Petersburg', 'Clearwater', 'Largo', 'Dunedin', 'Palm Harbor', 'Tarpon Springs']) {
  assert(names.includes(added), `missing new destination ${added}`);
}
assert(D.areas.every(a => ['Hillsborough', 'Pinellas', 'Manatee', 'Sarasota', 'Manatee/Sarasota'].includes(a.county)), 'a destination is outside the county list');
assert(!D.areas.some(a => a.county === 'Pasco' || a.county === 'Charlotte' || a.county === 'Lee'), 'Pasco, Charlotte, or Lee slipped in');
const gaz = {
  tampa: [27.970086, -82.479673],
  brandon: [27.935985, -82.299255],
  riverview: [27.824275, -82.304486],
  apollobeach: [27.76302, -82.403313],
  plantcity: [28.015355, -82.117805],
  pebblecreek: [28.160204, -82.342436],
  stpetersburg: [27.762727, -82.644131],
  clearwater: [27.979419, -82.771256],
  largo: [27.908685, -82.774174],
  dunedin: [28.038054, -82.794776],
  palmharbor: [28.08477, -82.757569],
  tarponsprings: [28.149054, -82.779371]
};
for (const [id, [lat, lon]] of Object.entries(gaz)) {
  const a = area(id);
  near(a.lat, lat, 1e-6, `${id} lat`);
  near(a.lon, lon, 1e-6, `${id} lon`);
  assert(a.point.includes('Census 2024 Gazetteer'), `${id} point source`);
}
assert(area('pebblecreek').county === 'Hillsborough', 'Pebble Creek county');
assert(area('pebblecreek').point.includes('Pasco'), 'Pebble Creek note names Pasco');
assert(area('northport').county === 'Sarasota' && area('wellenpark').county === 'Sarasota', 'North Port and Wellen Park counties');
near(area('wellenpark').lat, area('northport').lat, 1e-9, 'Wellen Park uses North Port latitude');
near(area('wellenpark').lon, area('northport').lon, 1e-9, 'Wellen Park uses North Port longitude');
assert(/North Port/.test(area('wellenpark').point), 'Wellen Park point names North Port');

// ZIP classification
const zipCases = [
  ['A1B2C3', 'international', "International moves aren't supported."],
  ['SW1A 1AA', 'international', "International moves aren't supported."],
  ['12345678', 'format', 'Enter a 5-digit US ZIP code.'],
  ['1234', 'format', 'Enter a 5-digit US ZIP code.'],
  ['00501', 'pobox', 'PO-box-only ZIP: enter your home ZIP.'],
  ['09012', 'military', 'military'],
  ['34001', 'military', 'military'],
  ['96201', 'military', 'military'],
  ['00601', 'territory', "US territories aren't supported."],
  ['96910', 'territory', "US territories aren't supported."],
  ['00000', 'unknown', 'Census ZCTA'],
  ['99999', 'unknown', 'Census ZCTA'],
  ['20500', 'unknown', 'Census ZCTA']
];
for (const [raw, code, snippet] of zipCases) {
  const found = classifyZip(raw, Z);
  assert(!found.ok && found.code === code && found.message.includes(snippet), `ZIP ${raw} => ${found.code} ${found.message}`);
  assert(found.zip !== '123' && found.zip !== '12345' && found.zip !== '11', `ZIP ${raw} was rewritten`);
}
const plus4 = classifyZip('30303-1234', Z);
assert(plus4.ok && plus4.zip === '30303' && plus4.state === 'Georgia', 'ZIP+4 uses the first five');
assert(classifyZip('99501', Z).overseas && classifyZip('96813', Z).overseas, 'AK and HI zips are overseas');
assert(!classifyZip('30303', Z).overseas && classifyZip('30303', Z).state === 'Georgia', 'Atlanta zip');

// Distance scaling for truck and container
function rental(help, zip, destId) {
  return estimateMove(Object.assign({}, base, {
    origin: originZip(zip), dest: area(destId), help, licenses: '0', veh: '0', vehHow: null, travel: 'Flying', adults: '1'
  }), D);
}
const atl = rental('DIY rental truck', '30303', 'venice');
const nyc = rental('DIY rental truck', '10001', 'venice');
const anc = rental('DIY rental truck', '99501', 'venice');
const hon = rental('DIY rental truck', '96813', 'venice');
assert(atl.mode === 'estimate' && nyc.mode === 'estimate', 'CONUS truck moves estimate');
assert(atl.lines.find(l => l.id === 'moving').typ < nyc.lines.find(l => l.id === 'moving').typ, 'Atlanta truck typical is below New York');
assert(anc.mode === 'quote' && hon.mode === 'quote', 'AK and HI truck moves are quotes');
assert(!anc.lines.some(l => l.display === 'money') && anc.total == null, 'Anchorage quote has no dollars');
assert(!hon.lines.some(l => l.display === 'money') && hon.total == null, 'Honolulu quote has no dollars');
const atlC = rental('Moving container', '30303', 'venice');
const nycC = rental('Moving container', '10001', 'venice');
assert(atlC.lines.find(l => l.id === 'moving').typ < nycC.lines.find(l => l.id === 'moving').typ, 'Atlanta container typical is below New York');
assert(rental('Moving container', '99501', 'venice').mode === 'quote', 'Anchorage container is a quote');
assert(rental('Full-service movers', '99501', 'venice').mode === 'quote', 'Anchorage full-service is a quote');

// Full-service distance: local, bridge, CMR, no cliff
function fullAt(road) {
  return priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'March 2027' }, road).line;
}
near(fullAt(30).typ, 1625, 1e-6, '30 mile typical is the local table');
near(fullAt(30).lo, 1625 * 0.75, 1e-6, '30 mile low');
near(fullAt(49).typ, 1625, 1e-6, '49 mile typical stays on the local table');
near(fullAt(50).typ, 1625, 1e-6, '50 mile typical matches local');
assert(Math.abs(fullAt(75).typ - 1625) > 100, '75 miles is not the under-50 price');
assert(fullAt(75).typ > 1625 && fullAt(75).typ < 4920, '75 mile typical sits between local and CMR');
near(fullAt(100).lo, 4330, 1e-6, '100 mile low is CMR');
near(fullAt(100).typ, 4920, 1e-6, '100 mile typical is CMR median');
near(fullAt(100).hi, 5540, 1e-6, '100 mile high is CMR');
assert(Math.abs(fullAt(100).typ - fullAt(99).typ) < 80, 'no cliff between 99 and 100 miles');
assert(Math.abs(fullAt(100).typ - fullAt(50).typ) > 2000, 'price still rises from 50 to 100');
near(fullAt(120).typ, 4920, 1e-6, '120 miles stays on the CMR 100-499 band');

// Truck scale anchors
function truckAt(road) {
  return priceCore(D, { help: 'DIY rental truck', type: 'Single-story house', size: '3 bedrooms' }, road).line;
}
near(truckAt(0).typ, 589.6, 1e-6, 'truck at 0 miles is the local price');
near(truckAt(1200).typ, 2279.75, 1e-4, 'truck at 1,200 miles is the long-distance price');
near(truckAt(2400).typ, 2279.75, 1e-2, 'truck past 1,200 miles stays at the 1,200-mile price');
assert(truckAt(200).typ < truckAt(600).typ && truckAt(600).typ < truckAt(1200).typ, 'truck typical rises up to 1,200 miles');
assert(truckAt(2000).typ <= truckAt(1200).typ, 'truck typical does not rise past 1,200 miles');
const boxAt = road => priceCore(D, { help: 'Moving container', type: 'Single-story house', size: '3 bedrooms' }, road).line;
const fullHouse = road => priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'March 2027' }, road).line;
assert(boxAt(200).typ < boxAt(600).typ && boxAt(600).typ < boxAt(1200).typ, 'container typical rises up to 1,200 miles');
assert(boxAt(1600).typ <= boxAt(1200).typ && boxAt(1600).typ <= fullHouse(1600).typ, 'container past 1,200 miles does not exceed full-service');
for (const road of [1300, 1872, 3082]) {
  for (const help of ['DIY rental truck', 'Moving container']) {
    const diy = priceCore(D, { help, type: 'Single-story house', size: '3 bedrooms' }, road).line;
    const full = fullHouse(road);
    assert(diy.lo <= full.lo + 1e-6 && diy.typ <= full.typ + 1e-6 && diy.hi <= full.hi + 1e-6, `${help} at ${road} miles stays at or under full-service`);
  }
}
assert(/held flat/.test(boxAt(1872).note) && /cap/.test(boxAt(1872).sources.map(s => s.caveat).join(' ')), 'long DIY source note explains the flat cap');

// Not enough info
const unsureDest = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: null, help: 'Full-service movers', veh: '6'
}), D);
assert(unsureDest.mode === 'insufficient' && unsureDest.total == null, 'destination Not sure has no total');
assert(unsureDest.headline === 'Not enough info to estimate', 'destination Not sure headline');
const noOrigin = estimateMove(Object.assign({}, base, { origin: null, dest: area('tampa'), help: 'DIY rental truck' }), D);
assert(noOrigin.total == null, 'missing origin has no total');

// Help Not sure is not full-service alone
const fullLine = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'January 2027' }, 800).line;
const mixLine = priceCore(D, { help: 'Not sure', type: 'Single-story house', size: '3 bedrooms', when: 'January 2027' }, 800).line;
assert(!(fullLine.lo === mixLine.lo && fullLine.typ === mixLine.typ && fullLine.hi === mixLine.hi), 'Not sure help matches full-service exactly');
assert(mixLine.lo < fullLine.lo && mixLine.hi >= fullLine.hi, 'Not sure help spans below full-service');
assert(/not the full-service price alone/.test(mixLine.note), 'Not sure note');

// Studio contradiction
const studio = priceCore(D, { help: 'DIY rental truck', type: 'Studio apartment', size: '5+ bedrooms' }, 500);
assert(!studio.ok && studio.line.display !== 'money', 'studio plus 5 bedrooms is not priced');
assert(!/2719/.test(JSON.stringify(studio.line)), 'studio contradiction does not use the 4-bed row');
const studioOk = priceCore(D, { help: 'DIY rental truck', type: 'Studio apartment', size: '1 bedroom' }, 0);
near(studioOk.line.typ, 402.5, 1e-6, 'studio uses the smallest row');

// Vehicles and fees
function feesFor(veh) {
  const est = estimateMove(Object.assign({}, base, {
    origin: originZip('30303'), dest: area('tampa'), help: 'Full-service movers', veh: String(veh), licenses: '0', travel: 'Flying', vehHow: 'Ship them'
  }), D);
  return est.lines.find(l => l.id === 'fees');
}
const fee1 = feesFor(1), fee3 = feesFor(3), fee6 = feesFor(6);
near(fee1.typ, 360.75, 1e-6, 'one vehicle typical fee');
near(fee1.lo, 352.75, 1e-6, 'one vehicle low fee');
near(fee1.hi, 370.75, 1e-6, 'one vehicle high fee');
near(fee6.typ, fee3.typ * 2, 1e-6, 'six vehicles are double three');
const fee7 = feesFor(7), fee8 = feesFor(8), fee12 = feesFor(12);
near(fee7.typ, fee1.typ * 7, 1e-6, 'seven vehicles are priced as seven');
near(fee8.typ, fee7.typ, 1e-6, 'eight vehicles are priced as seven');
near(fee12.typ, fee7.typ, 1e-6, 'twelve vehicles are priced as seven');
const CAVEAT = 'It seems you have selected to transport more than seven vehicles. Please contact a relocation company directly for a better estimate.';
function moved(veh) {
  return estimateMove(Object.assign({}, base, {
    origin: originZip('30303'), dest: area('tampa'), help: 'Full-service movers', veh: String(veh), licenses: '0', travel: 'Flying', vehHow: 'Ship them'
  }), D);
}
assert(moved(6).vehicleCaveat === '', 'six vehicles have no many-vehicle caveat');
assert(moved(7).vehicleCaveat === CAVEAT, 'seven vehicles show the exact caveat');
assert(moved('7+').vehicleCaveat === CAVEAT && moved('7+').lines.find(l => l.id === 'fees').typ === fee7.typ, '7+ button prices as seven and shows the caveat');
assert(moved(12).vehicleCaveat === CAVEAT, 'twelve vehicles show the caveat');
assert(fee1.note.includes('85.25') && fee1.note.includes('22.50'), 'cents stay visible');
assert(formatMoney(fee1.typ) === '$360.75', 'formatter keeps cents');
assert(formatMoney(48) === '$48', 'whole dollars have no cents');
const unsureVeh = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('tampa'), help: 'Full-service movers', veh: 'Not sure', licenses: '0', travel: 'Flying'
}), D);
assert(unsureVeh.lines.find(l => l.id === 'fees').display === 'not-included', 'unknown vehicle count is not priced as 3');

// Driver license
const dl = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', licenses: '1', veh: '0', travel: 'Flying'
}), D).lines.find(l => l.id === 'dl');
near(dl.lo, 48, 1e-6, 'license low');
near(dl.typ, 48, 1e-6, 'license typical');
near(dl.hi, 54.25, 1e-6, 'license high');
assert(D.lodging.value === 113 && D.meals.value === 68, 'FY2027 rates stored');
const noneLic = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', licenses: '0', veh: '0', travel: 'Flying'
}), D).lines.find(l => l.id === 'dl');
assert(noneLic.display === 'not-selected' && noneLic.lo == null, 'zero licenses is not a $0 line');
const flMove = estimateMove(Object.assign({}, base, {
  origin: originZip('33602'), dest: area('parrish'), help: 'Full-service movers', veh: '1', licenses: '2'
}), D);
assert(flMove.inFL && flMove.lines.find(l => l.id === 'fees').display === 'not-applicable', 'Florida origin skips new-resident fees');
assert(flMove.lines.find(l => l.id === 'dl').display === 'not-applicable', 'Florida origin skips the license fee');

// Unsourced items are never $0
function showsZero(line) { return line.lo === 0 || line.typ === 0 || line.hi === 0; }
for (const packing of ['None', 'Partial', 'Full', 'Not sure']) {
  const est = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', packing }), D);
  const line = est.lines.find(l => l.label.startsWith('Packing'));
  assert(!showsZero(line), `packing ${packing} is $0`);
  assert(line.display === (packing === 'None' ? 'not-selected' : 'not-included'), `packing ${packing} display ${line.display}`);
}
for (const storage of ['No', 'Yes', 'Not sure']) {
  const est = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', storage }), D);
  const line = est.lines.find(l => l.label === 'Temporary storage');
  assert(!showsZero(line), `storage ${storage} is $0`);
  assert(line.display === (storage === 'No' ? 'not-selected' : 'not-included'), `storage ${storage} display`);
}
const shipped = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', vehHow: 'Ship them'
}), D);
const shipLine = shipped.lines.find(l => l.label === 'Vehicle shipping');
assert(shipLine.display === 'not-included' && !showsZero(shipLine), 'shipping is not $0');
assert(shipped.notIncluded.includes('Full-value protection'), 'full-value protection listed');
assert(!shipped.lines.some(l => /60¢|60 cents/.test(l.label)), 'no $0 valuation line');

// GSA lodging and meals are on a real drive
const drive = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers'
}), D);
const lodging = drive.lines.find(l => l.id === 'lodging');
const meals = drive.lines.find(l => l.id === 'meals');
assert(lodging.display === 'money' && lodging.note.includes('113'), 'lodging uses $113');
assert(meals.display === 'money' && meals.note.includes('68'), 'meals use $68');
assert(meals.lo === 0 && meals.typ > 0, 'Atlanta low column is a one-day drive, so those meals are not added');
const samePlace = estimateMove(Object.assign({}, base, {
  origin: originZip('34285'), dest: area('venice'), help: 'Full-service movers'
}), D);
const sameMeals = samePlace.lines.find(l => l.id === 'meals');
assert(samePlace.dist.road < 50, `Venice ZIP to Venice should be a short drive (${samePlace.dist.road})`);
assert(sameMeals.display === 'money' && sameMeals.lo === 0 && sameMeals.typ === 0 && sameMeals.hi === 0, 'a same-day local drive does not add meals');
assert(drive.lines.find(l => l.id === 'carFuel').note.includes('4.057'), 'Florida gas price cited');
assert(lodging.sources.some(s => s.asOf && s.asOf.includes('FY2027')), 'lodging source date');

// Travel Not sure does not invent a drive
const travelUnsure = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', travel: 'Not sure'
}), D);
assert(travelUnsure.lines.find(l => l.id === 'lodging').display === 'not-included', 'unsure travel has no lodging');
assert(travelUnsure.lines.find(l => l.id === 'carFuel').display === 'not-included', 'unsure travel has no car fuel');

// Tampa ZIP to Parrish is a short full-service move
const parrish = estimateMove(Object.assign({}, base, {
  origin: originZip('33602'), dest: area('parrish'), help: 'Full-service movers', veh: '0', licenses: '0', travel: 'Flying'
}), D);
assert(parrish.dist.road < 50, `Tampa to Parrish should be under 50 miles (${parrish.dist.road})`);
near(parrish.lines.find(l => l.id === 'moving').typ, 1625, 1e-6, 'Tampa to Parrish typical');

// Summer note does not change dollars
const summer = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'July 2027' }, 120);
const winter = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'January 2027' }, 120);
near(summer.line.typ, winter.line.typ, 1e-6, 'July does not change the price');
assert(/not applied/.test(summer.line.note), 'July note');

// 4+ bedroom long cell keeps the longer period
const oldCell = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '4 bedrooms', when: 'March 2027' }, 1600);
assert(oldCell.line.sources.some(s => s.asOf === 'Dec 2022-Sep 2026'), '1500-1999 / 4+BR period');

function show(label, est) {
  const m = est.lines.find(l => l.id === 'moving');
  const tot = est.total;
  const fmt = est.mode === 'quote' ? 'Get a quote' : est.total == null ? 'Not enough info' : `${formatMoney(tot.lo)} / ${formatMoney(tot.typ)} / ${formatMoney(tot.hi)}`;
  const move = m && m.display === 'money' ? `${formatMoney(m.lo)} / ${formatMoney(m.typ)} / ${formatMoney(m.hi)}` : est.mode;
  console.log(`${label}\t${est.dist ? Math.round(est.dist.road) : '—'}\t${move}\t${fmt}`);
}
console.log('\nSCENARIO\tMILES\tMOVING L/T/H\tTOTAL L/T/H');
show('Truck Atlanta 30303 → Venice, fly, 0 cars', atl);
show('Truck New York 10001 → Venice, fly, 0 cars', nyc);
show('Truck Anchorage 99501 → Venice', anc);
show('Truck Honolulu 96813 → Venice', hon);
show('Container Atlanta → Venice', atlC);
show('Container New York → Venice', nycC);
const ancC = rental('Moving container', '99501', 'venice');
show('Container Anchorage → Venice', ancC);
show('Dest Not sure, Atlanta, 6 vehicles, full-service', unsureDest);
show('Tampa 33602 → Parrish, full-service, fly', parrish);
const house = { type: 'Single-story house', size: '3 bedrooms', when: 'March 2027' };
console.log(`Full-service 30 mi\t30\t${formatMoney(fullAt(30).lo)} / ${formatMoney(fullAt(30).typ)} / ${formatMoney(fullAt(30).hi)}`);
console.log(`Full-service 75 mi\t75\t${formatMoney(fullAt(75).lo)} / ${formatMoney(fullAt(75).typ)} / ${formatMoney(fullAt(75).hi)}`);
console.log(`Full-service 100 mi\t100\t${formatMoney(fullAt(100).lo)} / ${formatMoney(fullAt(100).typ)} / ${formatMoney(fullAt(100).hi)}`);
console.log(`Full-service 120 mi\t120\t${formatMoney(fullAt(120).lo)} / ${formatMoney(fullAt(120).typ)} / ${formatMoney(fullAt(120).hi)}`);
const helpMix = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Not sure' }), D);
const helpFull = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers' }), D);
show('Help Not sure, Atlanta → Venice, drive', helpMix);
show('Help full-service, Atlanta → Venice, drive', helpFull);
console.log(`Fees 3 vehicles typical\t${formatMoney(fee3.typ)}\tFees 6 vehicles typical\t${formatMoney(fee6.typ)}`);
console.log(`DL 1 person\t${formatMoney(dl.lo)} / ${formatMoney(dl.typ)} / ${formatMoney(dl.hi)}`);
console.log(`Drive Atlanta lodging\t${formatMoney(lodging.lo)} / ${formatMoney(lodging.typ)} / ${formatMoney(lodging.hi)}`);
console.log(`Drive Atlanta meals\t${formatMoney(meals.lo)} / ${formatMoney(meals.typ)} / ${formatMoney(meals.hi)}`);
console.log(failed ? `\n${failed} failed` : '\nAll stress checks passed');
process.exit(failed ? 1 : 0);
