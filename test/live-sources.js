const fs = require('fs');
const path = require('path');
const Live = require('../live-sources');
const Estimator = require('../estimate');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL', msg);
  }
}

function sample() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  return data;
}

(async () => {
  const parsed = Live.parseGsa('<p>The standard lodging rate increased from $110 to $113. The standard M&amp;IE rate remains at $68. Fiscal Year (FY) 2027.</p>');
  check(parsed.lodging === 113 && parsed.meals === 68 && parsed.fy === '2027', 'parses the GSA bulletin rates');

  const keptLabel = sample();
  Live.applyGsaLive(keptLabel, parsed, '2026-10-23');
  check(keptLabel.lodging.value === 113 && keptLabel.lodging.freshness === 'live', 'a live read replaces the lodging rate');
  check(keptLabel.lodging.asOf.includes('FY2027') && keptLabel.lodging.asOf.includes('Oct 1, 2026'), 'a known fiscal year keeps its stored label');
  check(keptLabel.meals.value === 68 && keptLabel.meals.freshness === 'live' && keptLabel.meals.checked === '2026-10-23', 'meals are read from the same bulletin');

  const nextYear = sample();
  Live.applyGsaLive(nextYear, { lodging: 120, meals: 70, fy: '2028' }, '2026-10-23');
  check(nextYear.lodging.value === 120 && nextYear.lodging.asOf === 'FY2028', 'a new fiscal year replaces the label');
  check(nextYear.meals.asOf === 'FY2028' && nextYear.meals.value === 70, 'meals follow the new fiscal year');

  let rangeThrew = false;
  try { Live.applyGsaLive(sample(), { lodging: 10, meals: 68, fy: '2027' }, '2026-10-23'); } catch (err) { rangeThrew = true; }
  check(rangeThrew, 'a rate outside the expected range is rejected');

  const failedRead = sample();
  const beforeLodging = failedRead.lodging.value;
  const beforeGas = failedRead.gas.value;
  const bad = await Live.readGsa(failedRead, async () => 'Attention Required');
  check(bad.ok === false && failedRead.lodging.value === beforeLodging && failedRead.lodging.freshness === 'fallback', 'a challenged page keeps the last lodging rate');
  check(failedRead.meals.freshness === 'fallback' && failedRead.gas.value === beforeGas && !failedRead.gas.freshness, 'a failed lodging read does not touch gasoline');

  const ranged = sample();
  const rangedBefore = ranged.lodging.value;
  const out = await Live.readGsa(ranged, async () => 'standard lodging rate $10. standard M&IE rate is $68. FY 2027');
  check(out.ok === false && ranged.lodging.value === rangedBefore && ranged.lodging.freshness === 'fallback', 'an out-of-range bulletin keeps the last rate');

  const live = sample();
  const ok = await Live.readGsa(live, async () => '<p>The standard lodging rate increased from $110 to $113. The standard M&IE rate remains at $68. FY 2027.</p>');
  check(ok.ok === true && live.lodging.freshness === 'live' && live.meals.freshness === 'live', 'a readable bulletin is marked live');

  const drive = Estimator.estimateMove({
    origin: { lat: 33.75, lon: -84.39, state: 'Georgia', label: 'Atlanta' },
    dest: live.areas.find(a => a.id === 'venice'),
    help: 'Full-service movers',
    type: 'Single-story house',
    size: '3 bedrooms',
    veh: '1',
    vehHow: 'Drive them',
    travel: 'Driving',
    adults: '2',
    licenses: '1',
    packing: 'None',
    storage: 'No',
    when: 'March 2027'
  }, live);
  const lodging = drive.lines.find(l => l.id === 'lodging');
  const fuel = drive.lines.find(l => l.id === 'carFuel');
  check(lodging.note.includes('Read live on'), 'the lodging note says the rate was read live');
  check(lodging.sources.some(s => s.freshness === 'live' && /FY2027/.test(s.asOf)), 'the lodging source stays cited as live');
  const captions = Live.lineCaptions(lodging);
  check(captions.includes('Live from') && captions.includes('GSA') && captions.includes('Assumption, not a live price'), 'lodging shows a live source and the mileage assumption');
  const fuelCaption = Live.lineCaptions(fuel);
  check(fuelCaption.includes('Stored figure, not live') && fuelCaption.includes('AAA') && !/Live from/.test(fuelCaption), 'gasoline stays labeled stored');
  check(!/api_key|DEMO_KEY|ghp_|SECRET|PASSWORD/.test(fs.readFileSync(path.join(__dirname, '..', 'live-sources.js'), 'utf8')), 'the live reader has no key');

  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check(page.includes('LiveSources.readGsa'), 'the page reads GSA while the visitor is here');
  check(page.includes("stack[stack.length-1]!=='result'"), 'a late read does not cover a question the visitor went back to');
  check(page.indexOf('ASSUMPTION') === -1 && page.indexOf('UNSOURCED') === -1 && page.indexOf('checked ') === -1, 'internal status words stay off the page');
  check(!/api_key|DEMO_KEY|ghp_/.test(page), 'the page has no API key');

  if (failed) {
    console.error(failed + ' live-source checks failed');
    process.exit(1);
  }
  console.log('Live source checks passed');
})();
