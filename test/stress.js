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
assert(Math.abs(area('wellenpark').lat - area('northport').lat) > 0.01, 'Wellen Park is not the North Port point');
near(area('wellenpark').lat, 27.0450289, 1e-6, 'Wellen Park latitude');
near(area('wellenpark').lon, -82.3241085, 1e-6, 'Wellen Park longitude');
assert(/North Port/.test(area('wellenpark').point), 'Wellen Park point names North Port');
assert(/Nominatim/.test(area('wellenpark').point), 'Wellen Park point names Nominatim');

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
assert(!classifyZip('99501', Z).overseas && classifyZip('99501', Z).state === 'Alaska', 'Alaska zip is drivable');
assert(classifyZip('96813', Z).overseas, 'Hawaii zip is ocean-only');
const spaced = classifyZip('20850 1234', Z);
assert(spaced.ok && spaced.zip === '20850', 'ZIP+4 with a space uses the first five');
const dashed = classifyZip('20850-1234', Z);
assert(dashed.ok && dashed.zip === '20850', 'ZIP+4 with a dash uses the first five');
const typo = classifyZip('2085O', Z);
assert(!typo.ok && typo.code === 'typo' && typo.message === 'Check your ZIP. US ZIP codes are 5 digits.', 'one-letter ZIP typo');
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
assert(anc.mode === 'estimate' && anc.total, 'Anchorage truck move is a long-distance estimate');
assert(/Alaska Highway/.test(anc.lines.find(l => l.id === 'moving').note), 'Anchorage estimate names the unmeasured highway');
assert(hon.mode === 'quote' && !hon.lines.some(l => l.display === 'money') && hon.total == null, 'Honolulu quote has no dollars');
const atlC = rental('Moving container', '30303', 'venice');
const nycC = rental('Moving container', '10001', 'venice');
assert(atlC.lines.find(l => l.id === 'moving').typ < nycC.lines.find(l => l.id === 'moving').typ, 'Atlanta container typical is below New York');
assert(rental('Moving container', '99501', 'venice').mode === 'estimate', 'Anchorage container is an estimate');
assert(rental('Full-service movers', '99501', 'venice').mode === 'estimate', 'Anchorage full-service is an estimate');

// Full-service distance: local, bridge, CMR, no cliff
function fullAt(road) {
  return priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'March 2027' }, road).line;
}
near(fullAt(30).typ, 1625, 1e-6, '30 mile typical is the local table');
near(fullAt(30).lo, 1625 * 0.75, 1e-6, '30 mile low');
near(fullAt(49).typ, 1625, 1e-6, '49 mile typical stays on the local table');
near(fullAt(50).typ, 1625, 1e-6, '50 mile typical matches local');
assert(fullAt(75).typ > 1625 && fullAt(75).typ < fullAt(300).typ, '75 mile typical sits between local and the 300-mile knot');
assert(Math.abs(fullAt(100).typ - fullAt(99).typ) < 80, 'no cliff between 99 and 100 miles');
const rise50 = fullAt(100).typ - fullAt(50).typ;
assert(rise50 > 400 && rise50 < 1200, `50 to 100 mile rise is a ramp, not the old band cliff (${rise50})`);
assert(fullAt(120).typ > fullAt(100).typ && fullAt(120).typ < fullAt(300).typ, '120 miles is still on the ramp');

// Truck scale anchors
function truckAt(road) {
  return priceCore(D, { help: 'DIY rental truck', type: 'Single-story house', size: '3 bedrooms' }, road).line;
}
near(truckAt(0).typ, 589.6, 1e-6, 'truck at 0 miles is the local price');
assert(truckAt(200).typ < truckAt(600).typ && truckAt(600).typ < truckAt(1200).typ, 'truck typical rises up to 1,200 miles');
assert(truckAt(2000).typ > truckAt(1200).typ, 'truck typical keeps rising past 1,200 miles');
const boxAt = road => priceCore(D, { help: 'Moving container', type: 'Single-story house', size: '3 bedrooms' }, road).line;
const fullHouse = road => priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'March 2027' }, road).line;
assert(boxAt(200).typ < boxAt(600).typ && boxAt(600).typ < boxAt(1200).typ, 'container typical rises up to 1,200 miles');
assert(boxAt(1600).typ > boxAt(1200).typ && boxAt(1600).typ <= fullHouse(1600).typ + 1e-6, 'container past 1,200 miles rises and stays under full-service');
for (const road of [1300, 1872, 3082]) {
  for (const help of ['DIY rental truck', 'Moving container']) {
    const diy = priceCore(D, { help, type: 'Single-story house', size: '3 bedrooms' }, road).line;
    const full = fullHouse(road);
    assert(diy.lo <= full.lo + 1e-6 && diy.typ <= full.typ + 1e-6 && diy.hi <= full.hi + 1e-6, `${help} at ${road} miles stays at or under full-service`);
  }
}
assert(/949/.test(boxAt(1872).note) && /full-service/.test(boxAt(1872).note), 'long DIY note explains the 949-mile guide and the cap');
const oneBed = priceCore(D, { help: 'Moving container', type: 'Single-story house', size: '1 bedroom' }, 1200).line;
const oneBedFull = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '1 bedroom', when: 'March 2027' }, 1200).line;
assert(oneBed.typ <= oneBedFull.typ + 1e-6 && oneBed.hi <= oneBedFull.hi + 1e-6, '1-bedroom house container at 1,200 miles does not exceed full-service');
assert(/1-bedroom apartment row/.test(oneBed.note), '1-bedroom house uses the matching apartment row');
const homeTypes = ['Studio apartment', 'Apartment', 'Townhome', 'Single-story house', 'Multi-story house', 'Not sure'];
const homeSizes = ['1 bedroom', '2 bedrooms', '3 bedrooms', '4 bedrooms', '5+ bedrooms', 'Not sure'];
let sweepChecked = 0;
for (let road = 0; road <= 4000; road += 5) {
  for (const type of homeTypes) {
    for (const size of homeSizes) {
      const full = priceCore(D, { help: 'Full-service movers', type, size, when: 'March 2027' }, road);
      for (const help of ['DIY rental truck', 'Moving container']) {
        let diy;
        try { diy = priceCore(D, { help, type, size, when: 'March 2027' }, road); }
        catch (err) { assert(false, `DIY sweep threw ${type} ${size} ${road}: ${err.message}`); continue; }
        if (diy.line.display !== 'money' || full.line.display !== 'money') continue;
        sweepChecked += 1;
        const finite = [diy.line.lo, diy.line.typ, diy.line.hi, full.line.lo, full.line.typ, full.line.hi].every(n => Number.isFinite(n));
        assert(finite, `sweep numbers are finite for ${help} ${type} ${size} at ${road}`);
        assert(diy.line.lo <= full.line.lo + 1e-6 && diy.line.typ <= full.line.typ + 1e-6 && diy.line.hi <= full.line.hi + 1e-6, `${help} ${type} ${size} at ${road} mi exceeds full-service`);
      }
    }
  }
}
assert(sweepChecked > 1000, 'DIY sweep compared prices across homes and distances');
for (const road of [0, 10, 25, 40, 49]) {
  for (const type of homeTypes) {
    for (const size of homeSizes) {
      let line;
      try { line = priceCore(D, { help: 'Full-service movers', type, size, when: 'March 2027' }, road).line; }
      catch (err) { assert(false, `short full-service threw ${type} ${size} at ${road}: ${err.message}`); continue; }
      if (line.display === 'money') {
        assert([line.lo, line.typ, line.hi].every(n => Number.isFinite(n)), `short full-service NaN ${type} ${size} at ${road}`);
      }
    }
  }
}

// Not enough info
const unsureDest = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: null, help: 'Full-service movers', veh: '6'
}), D);
assert(unsureDest.mode === 'estimate' && unsureDest.total, 'destination Not sure still returns an estimate');
assert(unsureDest.destSpread && unsureDest.destSpread.minName && unsureDest.destSpread.maxName, 'destination Not sure names the closest and farthest areas');
assert(/average point/.test(unsureDest.lines.find(l => l.id === 'moving').note), 'destination Not sure explains the average point');
const noOrigin = estimateMove(Object.assign({}, base, { origin: null, dest: area('tampa'), help: 'DIY rental truck' }), D);
assert(noOrigin.total == null && /starting state/.test(noOrigin.lines.find(l => l.id === 'moving').note), 'missing origin has no total and asks for a state');

// Help Not sure is not full-service alone
const fullLine = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '3 bedrooms', when: 'January 2027' }, 800).line;
const mixLine = priceCore(D, { help: 'Not sure', type: 'Single-story house', size: '3 bedrooms', when: 'January 2027' }, 800).line;
near(mixLine.typ, fullLine.typ, 1e-6, 'Not sure help typical is the full-service price');
assert(mixLine.lo < fullLine.lo && mixLine.hi >= fullLine.hi - 1e-6, 'Not sure help spans below full-service');
assert(/Typical is the full-service price/.test(mixLine.note), 'Not sure note');

// Studio contradiction
const studio = priceCore(D, { help: 'DIY rental truck', type: 'Studio apartment', size: '5+ bedrooms' }, 500);
assert(studio.ok && studio.line.display === 'money', 'studio plus 5 bedrooms is still priced as a studio');
assert(/priced as a studio/.test(studio.line.note), 'studio contradiction says the bedroom count was not used');
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
const CAVEAT = 'It seems you have selected to transport seven or more vehicles. Please contact a relocation company directly for a better estimate.';
function moved(veh) {
  return estimateMove(Object.assign({}, base, {
    origin: originZip('30303'), dest: area('tampa'), help: 'Full-service movers', veh: String(veh), licenses: '0', travel: 'Flying', vehHow: 'Ship them'
  }), D);
}
assert(moved(6).vehicleCaveat === '', 'six vehicles have no many-vehicle caveat');
assert(moved(7).vehicleCaveat === CAVEAT, 'exactly seven vehicles show the caveat');
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
  const line = est.lines.find(l => l.id === 'packing');
  if (packing === 'None') assert(line.display === 'not-selected' && !showsZero(line), 'packing None is not a $0 line');
  else assert(line.display === 'money' && line.typ > 0, `packing ${packing} is priced`);
}
const partialPack = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', packing: 'Partial' }), D);
const fullPack = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', packing: 'Full' }), D);
assert(fullPack.lines.find(l => l.id === 'packing').typ > partialPack.lines.find(l => l.id === 'packing').typ, 'full packing labor is above partial');
for (const storage of ['No', 'Yes', 'Not sure']) {
  const est = estimateMove(Object.assign({}, base, { origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', storage }), D);
  const line = est.lines.find(l => l.id === 'storage');
  if (storage === 'Yes') assert(line.display === 'money' && line.typ > 0 && /1 month/.test(line.label), 'storage Yes without months uses 1 month');
  else assert(line.display === (storage === 'No' ? 'not-selected' : 'not-included') && !showsZero(line), `storage ${storage} display`);
}
const shipped = estimateMove(Object.assign({}, base, {
  origin: originZip('30303'), dest: area('venice'), help: 'Full-service movers', vehHow: 'Ship them'
}), D);
const shipLine = shipped.lines.find(l => l.id === 'ship');
assert(shipLine.display === 'money' && shipLine.typ > 0, 'shipping is priced per vehicle');
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
assert(drive.lines.find(l => l.id === 'carFuel').note.includes('4.1084'), 'Florida gas price cited');
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
assert(summer.line.typ > winter.line.typ, 'July prices low and typical above January');
assert(/July/.test(summer.line.note) && /\$3,412/.test(summer.line.note) && /\$2,728/.test(summer.line.note), 'July note cites the CMR medians');

// 4+ bedroom long cell keeps the longer period
const oldCell = priceCore(D, { help: 'Full-service movers', type: 'Single-story house', size: '4 bedrooms', when: 'March 2027' }, 1600);
assert(oldCell.line.sources.some(s => s.asOf === 'Dec 2022-Sep 2026'), '1500-1999 / 4+BR period');

function shippedMove(zip, destId, extra) {
  return estimateMove(Object.assign({
    origin: originZip(zip), dest: area(destId), when: 'November 2026',
    type: 'Apartment', size: '2 bedrooms', help: 'Full-service movers', packing: 'Partial',
    veh: '1', vehHow: 'Ship them', travel: 'Flying', licenses: '2', storage: 'No'
  }, extra || {}), D);
}
const rock = shippedMove('20850', 'parrish');
const rockShip = rock.lines.find(l => l.id === 'ship');
const rockAir = rock.lines.find(l => l.id === 'airfare');
near(rock.total.lo, 4209.18, 0.001, 'Rockville partial low');
near(rock.total.typ, 5593.71, 0.001, 'Rockville partial typical');
near(rock.total.hi, 8610.89, 0.001, 'Rockville partial high');
near(rockShip.lo, 545, 0.001, 'Rockville shipping low is the smoothed fit');
near(rockShip.typ, 757.30, 0.001, 'Rockville shipping typical');
near(rockShip.hi, 1248.74, 0.001, 'Rockville shipping high');
assert(rockShip.note.includes('28%') && rockShip.note.includes('not added') && !rockShip.note.includes('publishes no percent'), 'November quotes the 28% spike and does not apply it');
near(rockAir.lo, 278.90, 0.001, 'Rockville airfare low');
near(rockAir.typ, 512.04, 0.001, 'Rockville airfare typical');
near(rockAir.hi, 620.12, 0.001, 'Rockville airfare high');
assert(rockAir.sources[0].status === 'SOURCED' && /IAD/.test(rockAir.note), 'Rockville uses the Washington blend because IAD is nearest');
const marchShip = shippedMove('20850', 'parrish', { when: 'March 2027' }).lines.find(l => l.id === 'ship');
near(marchShip.lo, rockShip.lo, 0.001, 'March shipping low matches November');
near(marchShip.typ, rockShip.typ, 0.001, 'March shipping typical matches November');
near(marchShip.hi, rockShip.hi, 0.001, 'March shipping high matches November');
assert(!marchShip.note.includes('28%'), 'March does not quote the October-November spike');
const decShip = shippedMove('20850', 'parrish', { when: 'December 2026' }).lines.find(l => l.id === 'ship');
near(decShip.typ, rockShip.typ, 0.001, 'December does not multiply shipping by 1.28');
assert(decShip.note.includes('September through December') && !decShip.note.includes('publishes no percent'), 'December quotes the season without a fake missing percent');

const sea = shippedMove('98101', 'tampa');
const seaShip = sea.lines.find(l => l.id === 'ship');
const seaAir = sea.lines.find(l => l.id === 'airfare');
near(seaShip.lo, 1100, 0.001, 'Seattle shipping low');
near(seaShip.typ, 1215, 0.001, 'Seattle shipping typical');
near(seaShip.hi, 1600, 0.001, 'Seattle shipping high');
near(seaAir.typ, 640.50, 0.001, 'Seattle airfare is Sea-Tac times 2');
assert(seaAir.sources[0].status === 'SOURCED' && /SEA/.test(seaAir.note) && !/BFI/.test(seaAir.note), 'Seattle uses Sea-Tac without an Estimate label');
assert(/same figure|market average/.test(seaAir.note), 'Seattle notes the flat single-market fare');
const den = shippedMove('80202', 'tampa');
const denAir = den.lines.find(l => l.id === 'airfare');
assert(denAir.sources[0].status === 'SOURCED' && /DEN/.test(denAir.note) && !/APA|Centennial/.test(denAir.note), 'Denver uses DEN, not Centennial');
near(denAir.lo, 314.90, 0.001, 'Denver airfare low');
near(denAir.typ, 510.60, 0.001, 'Denver airfare typical');
near(denAir.hi, 683.32, 0.001, 'Denver airfare high');

const localShip = shippedMove('33602', 'sarasota');
const localAir = localShip.lines.find(l => l.id === 'airfare');
const localCar = localShip.lines.find(l => l.id === 'ship');
assert(localAir.display === 'not-applicable' && localAir.lo == null, 'Florida origin skips airfare');
near(localCar.lo, 300, 0.001, 'short-haul shipping low');
near(localCar.typ, 400, 0.001, 'short-haul shipping typical');
near(localCar.hi, 500, 0.001, 'short-haul shipping high');
assert(!/28%/.test(localCar.note), 'an in-Florida move is not given the southbound spike note');

const oneTruck = priceCore(D, { help: 'DIY rental truck', type: 'Apartment', size: '1 bedroom' }, 2000).line;
const twoTruck = priceCore(D, { help: 'DIY rental truck', type: 'Apartment', size: '2 bedrooms' }, 2000).line;
near(twoTruck.typ, oneTruck.typ, 1e-6, '2-bedroom truck is not a dollar above the 1-bedroom');
near(twoTruck.lo, oneTruck.lo, 1e-6, '2-bedroom truck low matches');
near(twoTruck.hi, oneTruck.hi, 1e-6, '2-bedroom truck high matches');
assert(/held equal/.test(twoTruck.note) && /No extra dollar/.test(twoTruck.note), 'truck note says the source prices those sizes the same');
for (const miles of [0, 200, 750, 969, 2000]) {
  const smaller = priceCore(D, { help: 'DIY rental truck', type: 'Apartment', size: '1 bedroom' }, miles).line;
  const bigger = priceCore(D, { help: 'DIY rental truck', type: 'Apartment', size: '2 bedrooms' }, miles).line;
  assert(bigger.lo + 1e-6 >= smaller.lo && bigger.typ + 1e-6 >= smaller.typ && bigger.hi + 1e-6 >= smaller.hi, `2-bedroom truck is not cheaper at ${miles} miles`);
}

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
