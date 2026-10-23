#!/usr/bin/env node
// Daily refresh for the moving estimator only. Writes /data.json.
// Cost-of-living files are left alone. Assumptions and unsourced lines have
// no published feed, so they are not fetched. A failed source keeps its
// previous value and makes this process exit non-zero.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

function todayISO(date) {
  const d = date || new Date();
  return d.toISOString().slice(0, 10);
}

function decode(html) {
  return String(html)
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#8217;|&rsquo;|\u2019/g, "'")
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&#8212;|&mdash;/g, '-');
}

function parseMoney(raw) {
  const text = String(raw).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('not a number: ' + raw);
  return Number(text);
}

function dollars(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some(part => part !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some(part => part !== '')) rows.push(row);
  }
  return rows;
}

function bandIndex(label) {
  const s = String(label).replace(/,/g, '').toLowerCase().trim();
  if (s.startsWith('100 to 499')) return 0;
  if (s.startsWith('500 to 999')) return 1;
  if (s.startsWith('1000 to 1499')) return 2;
  if (s.startsWith('1500 to 1999')) return 3;
  if (s.startsWith('2000')) return 4;
  throw new Error('unknown distance band: ' + label);
}

function sizeIndex(label) {
  const s = String(label).replace(/,/g, '').toLowerCase();
  if (s.includes('under 400')) return 0;
  if (s.includes('400 to 800')) return 1;
  if (s.includes('800 to 1200')) return 2;
  if (s.includes('1200')) return 3;
  throw new Error('unknown home size: ' + label);
}

function periodText(raw) {
  return String(raw || '').replace(/\s+to\s+/i, '-').trim();
}

function blankGrid() {
  return Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => null));
}

function parseMovers(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error('CMR CSV was empty');
  const header = rows[0].map(cell => cell.trim().toLowerCase());
  const col = name => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error('CMR CSV missing ' + name);
    return i;
  };
  const iBand = col('distance_band_miles');
  const iSize = col('home_size');
  const iPeriod = col('period');
  const iLow = col('typical_low_usd');
  const iMedian = col('median_usd');
  const iHigh = col('typical_high_usd');
  const iNote = header.indexOf('sample_note');
  const low = blankGrid();
  const median = blankGrid();
  const high = blankGrid();
  const sample = blankGrid();
  const periods = blankGrid();
  let filled = 0;
  for (const row of rows.slice(1)) {
    if (!row[iBand] || !row[iSize]) continue;
    const b = bandIndex(row[iBand]);
    const s = sizeIndex(row[iSize]);
    if (low[b][s] != null) throw new Error('duplicate CMR cell ' + row[iBand] + ' / ' + row[iSize]);
    low[b][s] = parseMoney(row[iLow]);
    median[b][s] = parseMoney(row[iMedian]);
    high[b][s] = parseMoney(row[iHigh]);
    const note = iNote >= 0 ? String(row[iNote] || '').trim().toLowerCase() : '';
    sample[b][s] = note.includes('limited') ? 'limited sample' : null;
    periods[b][s] = periodText(row[iPeriod]);
    filled++;
  }
  if (filled !== 20) throw new Error('CMR CSV had ' + filled + ' cells, expected 20');
  for (let b = 0; b < 5; b++) {
    for (let s = 0; s < 4; s++) {
      if (!(low[b][s] > 0) || !(median[b][s] >= low[b][s]) || !(high[b][s] >= median[b][s])) {
        throw new Error('CMR cell out of order at ' + b + ',' + s);
      }
    }
  }
  return { low, median, high, sample, periods, asOf: periods[0][0], specialPeriod: periods[3][3] };
}

function htmlTables(html) {
  const chunks = String(html).match(/<table[\s\S]*?<\/table>/gi) || [];
  return chunks.map(chunk => {
    const trs = chunk.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    return trs.map(tr => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => {
      return decode(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    }));
  });
}

function plainDollars(cell) {
  const text = String(cell || '').trim();
  if (!/^\$[\d,]+(\.\d+)?$/.test(text)) return null;
  return parseMoney(text);
}

function parseHah(html) {
  let local = null;
  let ld = null;
  for (const table of htmlTables(html)) {
    const data = table.filter(row => row.length >= 4);
    const nums = [];
    for (const row of data) {
      const triple = row.slice(1, 4).map(plainDollars);
      if (triple.some(n => n == null)) continue;
      nums.push(triple);
    }
    if (nums.length < 6) continue;
    const six = nums.slice(0, 6);
    if (!(six[0][0] > 0)) continue;
    if (six[0][0] > 1000) {
      if (!ld) ld = six;
    } else if (six[0][2] < 5000) {
      if (!local) local = six;
    }
  }
  if (!local || !ld) throw new Error('HireAHelper local or 1,200-mile table missing');
  if (!(ld[0][0] > local[0][0])) throw new Error('HireAHelper long-distance table is not above the local table');
  function pack(rows) {
    return {
      truck: rows.map(row => row[0]),
      container: rows.map(row => row[1]),
      full: rows.map(row => row[2])
    };
  }
  return { local: pack(local), ld1200: pack(ld) };
}

function feeAfter(text, label) {
  const at = text.indexOf(label);
  if (at < 0) throw new Error('FLHSMV missing ' + label);
  const money = text.slice(at, at + 600).match(/\$([0-9,]+(?:\.\d+)?)/);
  if (!money) throw new Error('FLHSMV amount missing for ' + label);
  return parseMoney(money[1]);
}

function parseFl(html) {
  const text = decode(String(html)).replace(/\u2019/g, "'");
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const service = plain.match(/additional \$([0-9]+(?:\.[0-9]+)?) service fee/i);
  if (!service) throw new Error('FLHSMV service fee missing');
  return {
    initReg: feeAfter(text, 'Initial Registration Fee'),
    title: feeAfter(text, 'Original Used'),
    plate: feeAfter(text, 'Original/Replacement License Plate Fee'),
    low: feeAfter(text, 'Automobiles (Net weight up to 2,499 pounds)'),
    typical: feeAfter(text, 'Automobiles (2,500 - 3,499 pounds)'),
    high: feeAfter(text, 'Automobiles (3,500 or more pounds)'),
    dl: feeAfter(text, "Original Class E (includes Learner's license)*"),
    serviceFee: parseMoney(service[1])
  };
}

function parseGsa(html) {
  const text = decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const lodging = text.match(/standard lodging rate(?: increased from \$[0-9,]+(?:\.\d+)? to)? \$([0-9,]+(?:\.\d+)?)/i);
  const meals = text.match(/standard M&IE rate (?:remains at|is) \$([0-9,]+(?:\.\d+)?)/i);
  if (!lodging || !meals) throw new Error('GSA standard lodging or M&IE rate missing');
  const fy = text.match(/FY\)?\s*(20\d\d)/i) || text.match(/Fiscal Year \(FY\) (20\d\d)/i);
  return {
    lodging: parseMoney(lodging[1]),
    meals: parseMoney(meals[1]),
    fy: fy ? fy[1] : ''
  };
}

function parseSeason(html) {
  const text = decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const match = text.match(/\$([0-9,]+(?:\.\d+)?) in July and \$([0-9,]+(?:\.\d+)?) in January/i);
  if (!match) throw new Error('CMR July and January medians missing');
  return { jul: parseMoney(match[1]), jan: parseMoney(match[2]) };
}

function parseAaaFlorida(html) {
  const text = decode(String(html).replace(/<[^>]+>/g, '\n'));
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  const at = lines.findIndex(line => /^Florida$/i.test(line));
  if (at < 0 || at + 1 >= lines.length) throw new Error('AAA Florida average missing');
  const value = parseMoney(lines[at + 1]);
  if (!(value > 1 && value < 15)) throw new Error('AAA Florida average out of range');
  const dated = text.match(/as of\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  let asOf = '';
  if (dated) {
    const year = dated[3].length === 2 ? 2000 + Number(dated[3]) : Number(dated[3]);
    asOf = year + '-' + String(dated[1]).padStart(2, '0') + '-' + String(dated[2]).padStart(2, '0');
  }
  return { value, asOf };
}

function challenged(text) {
  return /sgcaptcha|Attention Required|cf-error-details|Just a moment/i.test(String(text).slice(0, 4000));
}

async function defaultFetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
    headers: {
      'User-Agent': 'relocation-cost-estimator/1.0 (moving data refresh)',
      'Accept': 'text/html,text/csv,application/xhtml+xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  const text = await response.text();
  if (challenged(text)) throw new Error('host challenged the fetch for ' + url);
  return text;
}

function refreshableBlocks(data) {
  const fl = data.fl || {};
  return [data.movers, data.hah, data.cmrSeason, data.gas, data.lodging, data.meals, fl.initReg, fl.title, fl.plate, fl.regTax, fl.dl].filter(Boolean);
}

function stampMeta(data, failures, today) {
  data.meta = data.meta || {};
  const dates = refreshableBlocks(data).map(block => block.checked).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''));
  if (!failures.length) {
    data.meta.built = today;
    data.meta.asOf = today;
    return;
  }
  dates.sort();
  data.meta.asOf = dates[0] || data.meta.asOf || data.meta.built || today;
}

function applyMovers(data, parsed, today) {
  data.movers.value.low = parsed.low;
  data.movers.value.median = parsed.median;
  data.movers.value.high = parsed.high;
  data.movers.value.sample = parsed.sample;
  data.movers.asOf = parsed.asOf;
  data.movers.specialPeriod = parsed.specialPeriod;
  data.movers.checked = today;
  data.movers.caveat = 'Cells marked limited sample are flagged that way by CMR. The 1,500-1,999 miles / 4+ bedroom cell covers ' + parsed.specialPeriod + '. The other cells cover ' + parsed.asOf + '. The 2,000+ miles / 4+ bedroom median in this CSV is $' + dollars(parsed.median[4][3]) + '.';
}

function applyHah(data, parsed, today) {
  data.hah.value.local = parsed.local;
  data.hah.value.ld1200 = parsed.ld1200;
  data.hah.checked = today;
}

function applyFl(data, parsed, today) {
  data.fl.initReg.value = parsed.initReg;
  data.fl.initReg.checked = today;
  data.fl.title.value = parsed.title;
  data.fl.title.checked = today;
  data.fl.plate.value = parsed.plate;
  data.fl.plate.checked = today;
  data.fl.regTax.low = parsed.low;
  data.fl.regTax.typical = parsed.typical;
  data.fl.regTax.high = parsed.high;
  data.fl.regTax.checked = today;
  data.fl.dl.value = parsed.dl;
  data.fl.dl.serviceFee = parsed.serviceFee;
  data.fl.dl.checked = today;
}

function applyGsa(data, parsed, today) {
  data.lodging.value = parsed.lodging;
  data.lodging.checked = today;
  data.meals.value = parsed.meals;
  data.meals.checked = today;
  if (parsed.fy && data.lodging.asOf && !String(data.lodging.asOf).includes(parsed.fy)) {
    data.lodging.asOf = 'FY' + parsed.fy;
    data.meals.asOf = 'FY' + parsed.fy;
  }
}

function applySeason(data, parsed, today) {
  data.cmrSeason.value = { jul: parsed.jul, jan: parsed.jan };
  data.cmrSeason.checked = today;
}

function applyGas(data, parsed, today) {
  data.gas.value = parsed.value;
  data.gas.checked = today;
  if (parsed.asOf) data.gas.asOf = parsed.asOf;
  else data.gas.asOf = today;
}

async function refreshMovingData(data, options) {
  const opts = options || {};
  const fetchText = opts.fetchText || defaultFetchText;
  const today = opts.today || todayISO();
  const failures = [];
  const jobs = [
    ['CMR price bands', data.movers, parseMovers, parsed => applyMovers(data, parsed, today)],
    ['CMR July and January', data.cmrSeason, parseSeason, parsed => applySeason(data, parsed, today)],
    ['HireAHelper tables', data.hah, parseHah, parsed => applyHah(data, parsed, today)],
    ['FLHSMV fees', data.fl && data.fl.initReg, parseFl, parsed => applyFl(data, parsed, today)],
    ['AAA Florida regular', data.gas, parseAaaFlorida, parsed => applyGas(data, parsed, today)],
    ['GSA per diem', data.lodging, parseGsa, parsed => applyGsa(data, parsed, today)]
  ];
  for (const [name, block, parse, apply] of jobs) {
    const url = block && block.url;
    if (!url) {
      failures.push(name + ': missing url');
      continue;
    }
    try {
      const text = await fetchText(url);
      apply(parse(text));
      console.log('Updated ' + name);
    } catch (err) {
      failures.push(name + ': ' + (err && err.message ? err.message : String(err)));
      console.error('Kept last value for ' + name);
    }
  }
  stampMeta(data, failures, today);
  return failures;
}

async function main() {
  const requested = path.resolve(process.argv[2] || DATA_FILE);
  if (requested !== path.resolve(DATA_FILE)) {
    console.error('This refresh only writes the moving estimator data.json');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(requested, 'utf8'));
  const failures = await refreshMovingData(data);
  fs.writeFileSync(requested, JSON.stringify(data, null, 1) + '\n');
  if (failures.length) {
    console.error('Kept the last good value for failed sources:');
    failures.forEach(line => console.error(' - ' + line));
    process.exit(1);
  }
  console.log('Refreshed moving estimator data as of ' + data.meta.asOf);
}

module.exports = {
  parseMovers,
  parseHah,
  parseFl,
  parseGsa,
  parseSeason,
  parseAaaFlorida,
  refreshMovingData,
  todayISO
};

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
