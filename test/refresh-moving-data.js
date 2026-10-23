const fs = require('fs');
const path = require('path');
const assert = require('assert');
const refresh = require('../scripts/refresh-moving-data.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  }
}

const csv = [
  'distance_band_miles,home_size,bookings,period,typical_low_usd,median_usd,typical_high_usd,sample_note',
  '100 to 499,Under 400 cu ft (studio or 1 bedroom),1,Jan 2025 to Sep 2026,1780,1980,2150,',
  '100 to 499,400 to 800 cu ft (about 2 bedrooms),1,Jan 2025 to Sep 2026,2460,2990,3420,',
  '"100 to 499","800 to 1,200 cu ft (about 3 bedrooms)",1,Jan 2025 to Sep 2026,4330,4920,5540,',
  '"100 to 499","1,200+ cu ft (4+ bedrooms)",1,Jan 2025 to Sep 2026,6390,7220,8580,limited sample',
  '500 to 999,Under 400 cu ft (studio or 1 bedroom),1,Jan 2025 to Sep 2026,10,20,30,',
  '500 to 999,400 to 800 cu ft (about 2 bedrooms),1,Jan 2025 to Sep 2026,10,20,30,',
  '"500 to 999","800 to 1,200 cu ft (about 3 bedrooms)",1,Jan 2025 to Sep 2026,10,20,30,',
  '"500 to 999","1,200+ cu ft (4+ bedrooms)",1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,000 to 1,499",Under 400 cu ft (studio or 1 bedroom),1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,000 to 1,499",400 to 800 cu ft (about 2 bedrooms),1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,000 to 1,499","800 to 1,200 cu ft (about 3 bedrooms)",1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,000 to 1,499","1,200+ cu ft (4+ bedrooms)",1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,500 to 1,999",Under 400 cu ft (studio or 1 bedroom),1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,500 to 1,999",400 to 800 cu ft (about 2 bedrooms),1,Jan 2025 to Sep 2026,10,20,30,',
  '"1,500 to 1,999","800 to 1,200 cu ft (about 3 bedrooms)",1,Jan 2025 to Sep 2026,10,20,30,limited sample',
  '"1,500 to 1,999","1,200+ cu ft (4+ bedrooms)",1,Dec 2022 to Sep 2026,10,20,30,',
  '"2,000+",Under 400 cu ft (studio or 1 bedroom),1,Jan 2025 to Sep 2026,10,20,30,',
  '"2,000+",400 to 800 cu ft (about 2 bedrooms),1,Jan 2025 to Sep 2026,10,20,30,',
  '"2,000+","800 to 1,200 cu ft (about 3 bedrooms)",1,Jan 2025 to Sep 2026,10,20,30,',
  '"2,000+","1,200+ cu ft (4+ bedrooms)",1,Jan 2025 to Sep 2026,9320,10000,11180,limited sample'
].join('\n');

const movers = refresh.parseMovers(csv);
check(movers.low[0][0] === 1780 && movers.median[0][3] === 7220 && movers.high[0][2] === 5540, 'CMR first band');
check(movers.sample[0][3] === 'limited sample' && movers.sample[0][0] == null, 'CMR sample flag');
check(movers.asOf === 'Jan 2025-Sep 2026' && movers.specialPeriod === 'Dec 2022-Sep 2026', 'CMR periods');
check(movers.median[4][3] === 10000, 'CMR long median');

const hahHtml = `
<table><tr><th></th><th>Labor + Truck</th><th>Labor + Container</th><th>Full Service</th></tr>
<tr><td>1-bed apt/small 2-bed apt</td><td>$402.50</td><td>$765.92</td><td>$879.00</td></tr>
<tr><td>Large 1-bed</td><td>$488.40</td><td>$916.30</td><td>$1,158.00</td></tr>
<tr><td>3-bed apt</td><td>$577.50</td><td>$1,045.50</td><td>$1,480.00</td></tr>
<tr><td>3-bed house</td><td>$589.60</td><td>$1,076.35</td><td>$1,625.00</td></tr>
<tr><td>4-bed house</td><td>$636.00</td><td>$1,176.19</td><td>$2,012.50</td></tr>
<tr><td>5-bed house</td><td>$773.50</td><td>$1,405.38</td><td>$2,300.00</td></tr></table>
<table><tr><th></th><th>Labor + Truck</th><th>Labor + Container</th><th>Full Service</th></tr>
<tr><td>1-bed apt/small 2-bed apt</td><td>$1,397.22</td><td>$2,397.77</td><td>$5,077.86</td></tr>
<tr><td>Large 1-bed</td><td>$1,818.30</td><td>$3,036.09</td><td>$5,666.43</td></tr>
<tr><td>3-bed apt</td><td>$2,132.48</td><td>$3,250.96</td><td>$6,261.43</td></tr>
<tr><td>3-bed house</td><td>$2,279.75</td><td>$3,935.15</td><td>$6,728.57</td></tr>
<tr><td>4-bed house</td><td>$2,719.31</td><td>$4,328.99</td><td>$7,392.50</td></tr>
<tr><td>5-bed house</td><td>$3,453.53</td><td>$4,962.53</td><td>$7,975.00</td></tr></table>`;
const hah = refresh.parseHah(hahHtml);
check(hah.local.truck[3] === 589.6 && hah.local.full[3] === 1625, 'HireAHelper local row');
check(hah.ld1200.truck[0] === 1397.22 && hah.ld1200.full[5] === 7975, 'HireAHelper long-distance row');

const flHtml = `
<p>An additional $6.25 service fee may apply to any credential issued in a tax collector office.</p>
<table><tr><td>Original Class E (includes Learner’s license)*</td><td>$48.00</td></tr>
<tr><td>Renewal Class E*</td><td>$48.00</td></tr></table>
<table><tr><td>Automobiles (Net weight up to 2,499 pounds)</td><td>$14.50</td></tr>
<tr><td>Automobiles (2,500 - 3,499 pounds)</td><td>$22.50</td></tr>
<tr><td>Automobiles (3,500 or more pounds)</td><td>$32.50</td></tr>
<tr><td>Original/Replacement License Plate Fee</td><td>$28.00</td></tr>
<tr><td>Initial Registration Fee</td><td>$225.00</td></tr></table>
<table><tr><td>Original New</td><td>$77.25</td></tr>
<tr><td>Original Used</td><td>$85.25</td></tr></table>`;
const fl = refresh.parseFl(flHtml);
check(fl.initReg === 225 && fl.title === 85.25 && fl.plate === 28 && fl.dl === 48, 'FLHSMV fixed fees');
check(fl.low === 14.5 && fl.typical === 22.5 && fl.high === 32.5 && fl.serviceFee === 6.25, 'FLHSMV weight and service fee');

const gsa = refresh.parseGsa('<p>Fiscal Year (FY) 2027 Continental United States. The standard lodging rate increased from $110 to $113. The standard M&amp;IE rate remains at $68.</p>');
check(gsa.lodging === 113 && gsa.meals === 68 && gsa.fy === '2027', 'GSA standard rates');

const season = refresh.parseSeason('<p>The median 2 bedroom move cost $3,412 in July and $2,728 in January.</p>');
check(season.jul === 3412 && season.jan === 2728, 'CMR season medians');

const gas = refresh.parseAaaFlorida('<table><tr><td>Florida</td><td>$4.1272</td><td>$4.60</td></tr></table><p>Price as of 10/23/26</p>');
check(gas.value === 4.1272 && gas.asOf === '2026-10-23', 'AAA Florida regular and as-of date');

function block(url, value) {
  return { url, value, checked: '2026-10-22', asOf: '2026-10-22' };
}

async function runCases() {
  const kept = {
    meta: { built: '2026-10-22' },
    movers: block('https://example.test/cmr.csv', { low: [[1]] }),
    cmrSeason: block('https://example.test/season', { jul: 1, jan: 2 }),
    hah: block('https://example.test/hah', { local: { truck: [1] }, ld1200: { truck: [2] } }),
    fl: { initReg: block('https://example.test/fl', 225), title: { value: 1 }, plate: { value: 1 }, regTax: { low: 1 }, dl: { value: 1, serviceFee: 1 } },
    gas: block('https://example.test/gas', 4.057),
    lodging: block('https://example.test/gsa', 113),
    meals: { value: 68, asOf: 'FY2027' }
  };
  const failures = await refresh.refreshMovingData(kept, {
    today: '2026-10-23',
    fetchText: async () => { throw new Error('down'); }
  });
  check(failures.length === 6, 'every source failure is reported (' + failures.length + ')');
  check(kept.gas.value === 4.057 && kept.lodging.value === 113 && kept.movers.value.low[0][0] === 1, 'failed sources keep the last value');
  check(kept.meta.asOf === '2026-10-22' && kept.meta.built === '2026-10-22', 'a failed run does not claim a new as-of date');

  const fresh = {
    meta: { built: '2026-10-22' },
    movers: block('https://example.test/cmr.csv', { low: blank(), median: blank(), high: blank(), sample: blank() }),
    cmrSeason: block('https://example.test/season', { jul: 1, jan: 2 }),
    hah: block('https://example.test/hah', { rows: ['keep'], local: {}, ld1200: {} }),
    fl: {
      initReg: block('https://example.test/fl', 1),
      title: { value: 1, checked: '2026-10-22' },
      plate: { value: 1, checked: '2026-10-22' },
      regTax: { low: 1, typical: 1, high: 1, checked: '2026-10-22' },
      dl: { value: 1, serviceFee: 1, checked: '2026-10-22' }
    },
    gas: block('https://example.test/gas', 4.057),
    lodging: Object.assign(block('https://example.test/gsa', 110), { asOf: 'FY2027 (Oct 1, 2026-Sep 30, 2027)' }),
    meals: { value: 60, asOf: 'FY2027 (Oct 1, 2026-Sep 30, 2027)', checked: '2026-10-22' }
  };
  function blank() { return Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => 0)); }
  const bodies = {
    'https://example.test/cmr.csv': csv,
    'https://example.test/season': '<p>The median 2 bedroom move cost $3,412 in July and $2,728 in January.</p>',
    'https://example.test/hah': hahHtml,
    'https://example.test/fl': flHtml,
    'https://example.test/gas': '<table><tr><td>Delaware</td><td>$3.00</td></tr><tr><td>Florida</td><td>$4.1272</td></tr></table><p>Price as of 10/23/26</p>',
    'https://example.test/gsa': '<p>Fiscal Year (FY) 2027. The standard lodging rate increased from $110 to $113. The standard M&amp;IE rate remains at $68.</p>'
  };
  const ok = await refresh.refreshMovingData(fresh, {
    today: '2026-10-23',
    fetchText: async url => {
      if (!bodies[url]) throw new Error('unexpected ' + url);
      return bodies[url];
    }
  });
  check(ok.length === 0, 'fixture sources succeed: ' + ok.join('; '));
  check(fresh.gas.value === 4.1272 && fresh.gas.asOf === '2026-10-23', 'gas value replaced from the source');
  check(fresh.lodging.value === 113 && fresh.meals.value === 68, 'per diem replaced together');
  check(fresh.lodging.asOf.includes('FY2027'), 'known fiscal year label stays');
  check(fresh.fl.dl.value === 48 && fresh.fl.regTax.high === 32.5, 'Florida fees replaced together');
  check(fresh.hah.value.rows[0] === 'keep' && fresh.hah.value.local.truck[0] === 402.5, 'HireAHelper row names stay and prices update');
  check(fresh.movers.specialPeriod === 'Dec 2022-Sep 2026', 'special CMR period stored');
  check(fresh.meta.asOf === '2026-10-23' && fresh.meta.built === '2026-10-23', 'a clean run labels the file as of that day');

  const partial = JSON.parse(JSON.stringify(fresh));
  partial.gas.value = 4.057;
  partial.gas.asOf = '2026-10-22';
  partial.gas.checked = '2026-10-22';
  partial.meta = { built: '2026-10-22' };
  const partialFailures = await refresh.refreshMovingData(partial, {
    today: '2026-10-24',
    fetchText: async url => {
      if (url === 'https://example.test/gas') throw new Error('blocked');
      return bodies[url];
    }
  });
  check(partialFailures.length === 1 && /AAA Florida regular/.test(partialFailures[0]), 'only the failed source is reported');
  check(partial.gas.value === 4.057 && partial.gas.asOf === '2026-10-22', 'failed gas keeps the last price and date');
  check(partial.lodging.checked === '2026-10-24', 'a source that succeeded still updates');
  check(partial.meta.built === '2026-10-22', 'built date stays on the last clean run');
  check(partial.meta.asOf === '2026-10-22', 'page as-of stays at the oldest checked source');
}

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'refresh-moving-data.yml'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'refresh-moving-data.js'), 'utf8');
check(workflow.includes("cron: '15 12 * * *'"), 'workflow runs once a day');
check((workflow.match(/cron:/g) || []).length === 1, 'one schedule');
check(!/cron:\s*['"][^'"]*\s+\S+\s+[0-9]/.test(workflow), 'the schedule is not a monthly day-of-month cron');
check(workflow.includes('git add -- data.json') && !/git add[^\n]*cost-of-living/.test(workflow), 'workflow commits only moving data.json');
check(workflow.includes('does not touch cost-of-living'), 'workflow notes the cost-of-living boundary');
check(!/cost-of-living\/(?:index|factors|estimate)/.test(script), 'refresh script does not read cost-of-living files');
check(!/api[_-]?key|SECRET|PASSWORD|ghp_/i.test(script + workflow), 'no secrets in the refresh');
check(script.includes('process.exit(1)') && script.includes('Kept the last good value'), 'a failed source fails the process after keeping the value');

runCases().then(() => {
  console.log(failed ? failed + ' failed' : 'Refresh checks passed');
  process.exit(failed ? 1 : 0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
