'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var zlib = require('zlib');
var readline = require('readline');
var childProcess = require('child_process');
var stream = require('stream');
var estimate = require('./estimate.js');

var UA = 'FloridaGulfCoastGuide/1.0 (cost-of-living data refresh)';
var POSTAL = Object.keys(estimate.STATE_NAME);
var NAME_TO_CODE = (function () {
  var map = {};
  POSTAL.forEach(function (code) {
    map[estimate.STATE_NAME[code].toLowerCase()] = code;
  });
  map['washington dc'] = 'DC';
  map['district of columbia'] = 'DC';
  map.dc = 'DC';
  return map;
})();

var BEA_COMPONENT = {
  'RPPs: All items': null,
  'RPPs: Goods': 'goods',
  'RPPs: Services: Housing': 'housing',
  'RPPs: Services: Utilities': 'utilities',
  'RPPs: Services: Other': 'other-services'
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function percentToRate(text) {
  var match = String(text || '').match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 1000) / 100000;
}

function tableRows(html, marker) {
  var tables = String(html || '').match(/<table[\s\S]*?<\/table>/gi) || [];
  var table = tables.filter(function (item) { return item.indexOf(marker) >= 0; })[0];
  if (!table) throw new Error('missing table ' + marker);
  var rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  return rows.map(function (row) {
    var cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    return cells.map(decodeHtml);
  });
}

function stateCodeFromLabel(label) {
  var base = String(label || '').replace(/^-\s+/, '').replace(/\s*\([^)]*\)\s*/g, '').replace(/\./g, '').trim().toLowerCase();
  if (!base) return '';
  if (!NAME_TO_CODE[base]) throw new Error('unknown state "' + base + '"');
  return NAME_TO_CODE[base];
}

function parseIncomeTaxHtml(html) {
  var rows = tableRows(html, 'Single Filer (Rates)');
  var current = '';
  var found = {};
  rows.forEach(function (cells) {
    if (!cells.length || /^state$/i.test(cells[0])) return;
    var code = stateCodeFromLabel(cells[0]);
    if (!code) return;
    var continuation = /^-\s+/.test(cells[0]);
    if (!continuation) {
      current = code;
      found[code] = found[code] || { wage: true, rates: [] };
    } else if (current !== code) {
      throw new Error('income tax row broke at ' + code);
    }
    if (!found[code].wage) return;
    var rateCell = cells[1] || '';
    if (/none|capital gains|no (state )?tax/i.test(rateCell)) {
      found[code].wage = false;
      found[code].rates = [];
      return;
    }
    if (!rateCell) return;
    var rate = percentToRate(rateCell);
    if (rate == null) throw new Error('income tax rate for ' + code + ' is "' + rateCell + '"');
    found[code].rates.push(rate);
  });
  var states = {};
  POSTAL.forEach(function (code) {
    var row = found[code];
    if (!row) throw new Error('income tax table is missing ' + code);
    if (!row.wage || !row.rates.length) {
      states[code] = { kind: 'none' };
      return;
    }
    var unique = [];
    row.rates.forEach(function (rate) {
      if (rate === 0) return;
      if (unique.indexOf(rate) < 0) unique.push(rate);
    });
    if (!unique.length) {
      states[code] = { kind: 'none' };
      return;
    }
    if (unique.some(function (rate) { return rate < 0 || rate > 0.2; })) throw new Error('income tax rate out of range for ' + code);
    if (unique.length === 1) states[code] = { kind: 'flat', rate: unique[0] };
    else states[code] = { kind: 'graduated', min: Math.min.apply(null, unique), max: Math.max.apply(null, unique) };
  });
  var year = (String(html).match(/<title>[^<]*(20\d{2})/i) || [])[1];
  if (!year) throw new Error('income tax page has no year');
  return { states: states, asOf: year + '-01-01' };
}

function parseSalesTaxHtml(html) {
  var rows = tableRows(html, 'Combined Tax Rate');
  var states = {};
  rows.forEach(function (cells) {
    if (!cells.length || /^state$/i.test(cells[0])) return;
    var code = stateCodeFromLabel(cells[0]);
    if (!code) return;
    var state = percentToRate(cells[1]);
    var avgLocal = percentToRate(cells[3]);
    var combined = percentToRate(cells[5]);
    if (state == null || avgLocal == null || combined == null) throw new Error('sales tax row ' + code);
    if (combined < 0 || combined > 0.15 || Math.abs((state + avgLocal) - combined) > 0.0015) throw new Error('sales tax rate ' + code);
    states[code] = { state: state, avgLocal: avgLocal, combined: combined };
  });
  POSTAL.forEach(function (code) {
    if (!states[code]) throw new Error('sales tax table is missing ' + code);
  });
  var dated = String(html).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})/i);
  if (!dated) throw new Error('sales tax page has no as-of date');
  var months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  var asOf = dated[3] + '-' + months[dated[1].toLowerCase()] + '-' + String(dated[2]).padStart(2, '0');
  return { states: states, asOf: asOf };
}

function parseFredCsv(text) {
  var lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('water series is empty');
  var last = lines[lines.length - 1].split(',');
  var year = /^(\d{4})-\d{2}-\d{2}$/.exec(last[0] || '');
  var annual = Number(last[1]);
  if (!year || !(annual > 0)) throw new Error('water series is unreadable');
  var monthly = Math.round(annual / 12 * 100) / 100;
  if (monthly < 20 || monthly > 200) throw new Error('water bill out of range');
  return { asOf: year[1], national: monthly };
}

function parseCensusTable(text) {
  var map = {};
  String(text || '').split(/\n/).forEach(function (line) {
    if (line.indexOf('0500000US') !== 0) return;
    var parts = line.split('|');
    var fips = parts[0].slice('0500000US'.length);
    var value = Number(parts[1]);
    if (/^\d{5}$/.test(fips) && value > 0) map[fips] = value;
  });
  if (Object.keys(map).length < 2000) throw new Error('census county table is incomplete');
  return map;
}

function censusRates(taxes, values) {
  var rates = {};
  Object.keys(taxes).forEach(function (fips) {
    var value = values[fips];
    var tax = taxes[fips];
    if (!(value > 0) || !(tax > 0)) return;
    var rate = Math.round(tax / value * 100000) / 100000;
    if (rate > 0 && rate < 0.1) rates[fips] = rate;
  });
  if (Object.keys(rates).length < 2000) throw new Error('census property-tax rates are incomplete');
  return rates;
}

function parseCsv(text) {
  var rows = [];
  var row = [];
  var cur = '';
  var quoted = false;
  var i;
  for (i = 0; i < text.length; i++) {
    var ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}

function parseBeaCsv(text, level) {
  var rows = parseCsv(String(text || '').replace(/^\uFEFF/, ''));
  var header = rows[0] || [];
  var yearCol = -1;
  var year = '';
  header.forEach(function (name, index) {
    if (/^20\d{2}$/.test(name) && name >= year) { year = name; yearCol = index; }
  });
  if (yearCol < 0) throw new Error('BEA file has no year');
  var descCol = header.indexOf('Description');
  var nameCol = header.indexOf('GeoName');
  if (descCol < 0 || nameCol < 0) throw new Error('BEA columns');
  var table = {};
  rows.slice(1).forEach(function (row) {
    if (!/^\d+$/.test(row[0] || '')) return;
    var description = (row[descCol] || '').trim();
    if (!Object.prototype.hasOwnProperty.call(BEA_COMPONENT, description)) return;
    var component = BEA_COMPONENT[description];
    var key = '';
    if (level === 'cbsa') {
      if (row[0].length !== 5 || row[0] === '00000' || row[0] === '00999') return;
      key = row[0];
    } else {
      key = NAME_TO_CODE[(row[nameCol] || '').toLowerCase()] || '';
      if (!key) return;
    }
    var value = Number(row[yearCol]);
    if (!(value >= 30) || value > 300) throw new Error('BEA index ' + key + ' ' + value);
    if (!table[key]) table[key] = {};
    table[key][component === null ? 'all' : component] = value;
  });
  if (Object.keys(table).length < (level === 'cbsa' ? 300 : 51)) throw new Error('BEA ' + level + ' table is incomplete');
  return { asOf: year, areas: table };
}

function normPlace(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function loadCountyNameMap(dir) {
  var map = {};
  var dupes = {};
  fs.readdirSync(dir).forEach(function (name) {
    if (!name.endsWith('.json')) return;
    var shard = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    (shard.zips || []).forEach(function (row) {
      if (!row.countyName || !row.state || !/^\d{5}$/.test(row.countyFips || '')) return;
      var key = normPlace(row.countyName) + '|' + String(row.state).toLowerCase();
      if (map[key] && map[key] !== row.countyFips) dupes[key] = true;
      else map[key] = row.countyFips;
    });
  });
  Object.keys(dupes).forEach(function (key) { delete map[key]; });
  return map;
}

function cleanField(value) {
  return String(value || '').trim().replace(/^"|"$/g, '').trim();
}

function parseRedfin(text, nameToFips) {
  var lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('redfin file is empty');
  var header = lines[0].split('\t').map(cleanField);
  var col = {};
  header.forEach(function (name, index) { col[name] = index; });
  ['PERIOD_END', 'REGION', 'STATE_CODE', 'PROPERTY_TYPE', 'MEDIAN_SALE_PRICE', 'REGION_TYPE'].forEach(function (name) {
    if (col[name] == null) throw new Error('redfin column ' + name);
  });
  var latest = {};
  var asOf = '';
  lines.slice(1).forEach(function (line) {
    var cells = line.split('\t').map(cleanField);
    if (cells[col.REGION_TYPE] !== 'county') return;
    if (cells[col.PROPERTY_TYPE] !== 'All Residential') return;
    var price = Number(cells[col.MEDIAN_SALE_PRICE]);
    if (!(price >= 10000) || price > 10000000) return;
    var end = cells[col.PERIOD_END];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
    var key = normPlace(cells[col.REGION].replace(/,\s*[A-Z]{2}$/, '')) + '|' + cells[col.STATE_CODE].toLowerCase();
    var fips = nameToFips[key];
    if (!fips) return;
    var prev = latest[fips];
    if (prev && prev.end >= end) return;
    latest[fips] = { end: end, price: Math.round(price) };
    if (end > asOf) asOf = end;
  });
  var counties = {};
  Object.keys(latest).forEach(function (fips) { counties[fips] = latest[fips].price; });
  if (Object.keys(counties).length < 500) throw new Error('redfin county prices are incomplete');
  return { asOf: asOf.slice(0, 7), counties: counties };
}

function parseSharedStrings(xml) {
  var out = [];
  var blocks = String(xml || '').match(/<si>[\s\S]*?<\/si>/g) || [];
  blocks.forEach(function (block) {
    var texts = [];
    var match = /<t[^>]*>([\s\S]*?)<\/t>/g;
    var found;
    while ((found = match.exec(block))) texts.push(decodeHtml(found[1]));
    out.push(texts.join(''));
  });
  return out;
}

function parseSheetRows(xml, strings) {
  var rows = [];
  var match = /<row[^>]*>([\s\S]*?)<\/row>/g;
  var row;
  while ((row = match.exec(String(xml || '')))) {
    var cells = [];
    var found = /<c r="([A-Z]+)\d+"([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?/g;
    var cell;
    while ((cell = found.exec(row[1]))) {
      var col = 0;
      var letters = cell[1];
      var n;
      for (n = 0; n < letters.length; n++) col = col * 26 + letters.charCodeAt(n) - 64;
      while (cells.length < col - 1) cells.push('');
      var raw = cell[3] || '';
      cells.push(/t="s"/.test(cell[2]) ? (strings[Number(raw)] || '') : raw);
    }
    rows.push(cells);
  }
  return rows;
}

function parseElectricityGrid(rows) {
  var year = '';
  var states = {};
  var kwh = {};
  rows.forEach(function (row) {
    var label = row[0] || '';
    var dated = String(label).match(/\b(20\d{2})\b/);
    if (dated && !year) year = dated[1];
    var code = NAME_TO_CODE[String(label).toLowerCase()];
    if (!code) return;
    var use = Number(row[2]);
    var cents = Number(row[3]);
    if (!(use > 0) || !(cents > 0)) throw new Error('electricity row ' + code);
    var price = Math.round(cents * 100) / 10000;
    var month = Math.round(use * 10) / 10;
    if (price < 0.05 || price > 0.7 || month < 200 || month > 2000) throw new Error('electricity out of range ' + code);
    states[code] = price;
    kwh[code] = month;
  });
  POSTAL.forEach(function (code) {
    if (states[code] == null || kwh[code] == null) throw new Error('electricity table is missing ' + code);
  });
  if (!year) throw new Error('electricity table has no year');
  return { asOf: year, states: states, kwhMonth: kwh };
}

function numbersMatch(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.0000001;
}

function coverage(previous, next) {
  var keys = Object.keys(previous || {});
  if (!keys.length) return 1;
  var hit = keys.filter(function (key) { return next[key] != null; }).length;
  return hit / keys.length;
}

function changedMap(previous, next) {
  var keys = Object.keys(next);
  var i;
  for (i = 0; i < keys.length; i++) {
    if (!numbersMatch(previous[keys[i]], next[keys[i]])) return true;
  }
  return keys.length !== Object.keys(previous).length;
}

function mergeNumbers(previous, next) {
  var merged = Object.assign({}, previous);
  Object.keys(next).forEach(function (key) { merged[key] = next[key]; });
  return merged;
}

function todayStamp(today) {
  return today || new Date().toISOString().slice(0, 10);
}

function applyIncomeTax(factors, _bundle, next, today) {
  var same = JSON.stringify(factors.incomeTax.states) === JSON.stringify(next.states) && factors.incomeTax.asOf === next.asOf;
  if (same) return false;
  factors.incomeTax.states = next.states;
  factors.incomeTax.asOf = next.asOf;
  factors.incomeTax.retrieved = todayStamp(today);
  return true;
}

function applySalesTax(factors, _bundle, next, today) {
  var changed = false;
  var states = {};
  POSTAL.forEach(function (code) {
    var prev = factors.salesTax.states[code];
    if (!prev || !prev.grocery) throw new Error('saved grocery treatment is missing for ' + code);
    var row = {
      state: next.states[code].state,
      avgLocal: next.states[code].avgLocal,
      combined: next.states[code].combined,
      grocery: prev.grocery
    };
    if (prev.groceryRate != null) row.groceryRate = prev.groceryRate;
    if (!numbersMatch(prev.state, row.state) || !numbersMatch(prev.avgLocal, row.avgLocal) || !numbersMatch(prev.combined, row.combined)) changed = true;
    states[code] = row;
  });
  if (!changed && factors.salesTax.asOf === next.asOf) return false;
  factors.salesTax.states = states;
  factors.salesTax.asOf = next.asOf;
  factors.salesTax.retrieved = todayStamp(today);
  return true;
}

function applyWater(factors, _bundle, next, today) {
  if (numbersMatch(factors.water.national, next.national) && factors.water.asOf === next.asOf) return false;
  factors.water.national = next.national;
  factors.water.asOf = next.asOf;
  factors.water.retrieved = todayStamp(today);
  return true;
}

function applyElectricity(factors, _bundle, next, today) {
  if (!changedMap(factors.electricity.states, next.states) && !changedMap(factors.electricity.kwhMonth, next.kwhMonth) && factors.electricity.asOf === next.asOf) return false;
  factors.electricity.states = next.states;
  factors.electricity.kwhMonth = next.kwhMonth;
  factors.electricity.asOf = next.asOf;
  factors.electricity.retrieved = todayStamp(today);
  return true;
}

function applyCountyRates(factors, _bundle, next, today) {
  if (coverage(factors.originPropertyTax.counties, next.counties) < 0.95) throw new Error('census file is missing saved counties');
  var merged = mergeNumbers(factors.originPropertyTax.counties, next.counties);
  if (!changedMap(factors.originPropertyTax.counties, merged) && String(factors.originPropertyTax.asOf) === next.asOf) return false;
  factors.originPropertyTax.counties = merged;
  factors.originPropertyTax.asOf = next.asOf;
  factors.originPropertyTax.retrieved = todayStamp(today);
  var start = Number(next.asOf) - 4;
  factors.originPropertyTax.source = 'U.S. Census Bureau, American Community Survey 5-year ' + start + '-' + next.asOf + ', B25103 median real estate taxes / B25077 median value';
  factors.originPropertyTax.url = 'https://www2.census.gov/programs-surveys/acs/summary_file/' + next.asOf + '/table-based-SF/data/5YRData/';
  return true;
}

function applyRedfin(factors, _bundle, next, today) {
  if (coverage(factors.originMedianPrice.counties, next.counties) < 0.9) throw new Error('redfin file is missing saved counties');
  var merged = mergeNumbers(factors.originMedianPrice.counties, next.counties);
  if (!changedMap(factors.originMedianPrice.counties, merged) && factors.originMedianPrice.asOf === next.asOf) return false;
  factors.originMedianPrice.counties = merged;
  factors.originMedianPrice.asOf = next.asOf;
  factors.originMedianPrice.retrieved = todayStamp(today);
  var month = next.asOf;
  factors.originMedianPrice.source = 'Redfin Data Center, county market tracker, all residential, median sale price, ' + month;
  return true;
}

function componentKey(componentId) {
  return componentId == null ? 'all' : componentId;
}

function oneDecimal(value) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function applyPriceIndexes(factors, bundle, next, today) {
  var lookups = { cbsa: next.cbsa.areas, state: next.state.areas };
  var missing = [];
  var changed = false;
  function visit(row) {
    if (!row || row.categoryId !== 'price-index') return;
    if (row.geoLevel !== 'cbsa' && row.geoLevel !== 'state') return;
    var area = lookups[row.geoLevel][row.geoId];
    var key = componentKey(row.componentId);
    if (!area || area[key] == null) {
      missing.push(row.geoLevel + ' ' + row.geoId + ' ' + key);
      return;
    }
    var value = area[key];
    if (!numbersMatch(row.value, value) || row.asOf !== next.cbsa.asOf) {
      row.value = value;
      row.display = oneDecimal(value);
      row.asOf = next.cbsa.asOf;
      row.retrieved = todayStamp(today);
      if (row.caveat) row.caveat = row.caveat.replace(/^\d{4}/, next.cbsa.asOf);
      if (row.linkLabel) row.linkLabel = row.linkLabel.replace(/20\d{2}/, next.cbsa.asOf);
      changed = true;
    }
  }
  (bundle.nationalTables.rows || []).forEach(visit);
  (bundle.figures || []).forEach(visit);
  if (missing.length) throw new Error('BEA file is missing ' + missing.slice(0, 5).join(', '));
  if (next.cbsa.asOf !== next.state.asOf) throw new Error('BEA metro and state vintages differ');
  return changed;
}

function skipSpace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function endOfValue(text, index) {
  index = skipSpace(text, index);
  if (text[index] === '"') {
    index++;
    while (index < text.length) {
      if (text[index] === '\\') { index += 2; continue; }
      if (text[index] === '"') return index + 1;
      index++;
    }
    throw new Error('unterminated string');
  }
  if (text[index] === '{' || text[index] === '[') {
    var open = text[index];
    var close = open === '{' ? '}' : ']';
    var depth = 0;
    var quoted = false;
    for (; index < text.length; index++) {
      var ch = text[index];
      if (quoted) {
        if (ch === '\\') { index++; continue; }
        if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return index + 1;
      }
    }
    throw new Error('unterminated value');
  }
  while (index < text.length && ',}]\n'.indexOf(text[index]) < 0) index++;
  return index;
}

function findKey(text, key, from, until) {
  var needle = '"' + key + '"';
  var index = from;
  while (index < until) {
    var at = text.indexOf(needle, index);
    if (at < 0 || at >= until) return -1;
    var after = skipSpace(text, at + needle.length);
    if (text[after] === ':') {
      var before = at - 1;
      while (before >= from && /\s/.test(text[before])) before--;
      if (before < from || text[before] === '{' || text[before] === ',') return at;
    }
    index = at + needle.length;
  }
  return -1;
}

function spanForPath(text, path) {
  var from = 0;
  var until = text.length;
  var span = null;
  path.forEach(function (key) {
    var at = findKey(text, key, from, until);
    if (at < 0) throw new Error('missing ' + path.join('.'));
    var colon = text.indexOf(':', at);
    var start = skipSpace(text, colon + 1);
    var end = endOfValue(text, start);
    span = { keyAt: at, start: start, end: end };
    from = start;
    until = end;
  });
  return span;
}

function prettyValue(value, keyIndent) {
  var json = JSON.stringify(value, null, 2);
  var pad = new Array(keyIndent + 1).join(' ');
  return json.split('\n').map(function (line, index) {
    return index === 0 ? line : pad + line;
  }).join('\n');
}

function keyIndent(text, index) {
  var line = text.lastIndexOf('\n', index) + 1;
  return (text.slice(line, index).match(/^ */) || [''])[0].length;
}

function setJsonPath(text, path, value) {
  var span = spanForPath(text, path);
  return text.slice(0, span.start) + prettyValue(value, keyIndent(text, span.keyAt)) + text.slice(span.end);
}

function deleteJsonPath(text, path) {
  var span = spanForPath(text, path);
  var start = span.keyAt;
  var end = span.end;
  if (text[end] === ',') {
    end += 1;
    if (text[end] === '\n') end += 1;
    return text.slice(0, start) + text.slice(end);
  }
  var before = start - 1;
  while (before >= 0 && /\s/.test(text[before])) before--;
  if (text[before] === ',') return text.slice(0, before) + text.slice(end);
  throw new Error('cannot delete ' + path.join('.'));
}

function writeJsonPath(file, pathKeys, value) {
  var text = fs.readFileSync(file, 'utf8');
  var next = setJsonPath(text, pathKeys, value);
  if (next !== text) fs.writeFileSync(file, next);
  return next !== text;
}

async function getText(url, ms) {
  var response = await fetch(url, {
    signal: AbortSignal.timeout(ms || 120000),
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json,text/plain,text/csv,*/*' }
  });
  if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
  return response.text();
}

async function downloadFile(url, file) {
  var response = await fetch(url, { signal: AbortSignal.timeout(180000), headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
  var bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, bytes);
}

function unzipText(zipFile, inner) {
  return childProcess.execFileSync('unzip', ['-p', zipFile, inner], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function unzipMatch(zipFile, pattern) {
  var names = childProcess.execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf8' }).trim().split(/\n/);
  var name = names.filter(function (item) { return pattern.test(item); })[0];
  if (!name) throw new Error('zip has no ' + pattern);
  return unzipText(zipFile, name);
}

function defaultJobs(options) {
  var root = options.root || __dirname;
  return [
    {
      id: 'incomeTax',
      fetch: async function () {
        return parseIncomeTaxHtml(await getText(options.factors.incomeTax.url));
      },
      validate: function (next) {
        if (!next || !next.states || Object.keys(next.states).length !== 51) throw new Error('income tax states');
      },
      apply: applyIncomeTax
    },
    {
      id: 'salesTax',
      fetch: async function () {
        return parseSalesTaxHtml(await getText(options.factors.salesTax.url));
      },
      validate: function (next) {
        if (!next || Object.keys(next.states).length !== 51) throw new Error('sales tax states');
      },
      apply: applySalesTax
    },
    {
      id: 'water',
      fetch: async function () {
        return parseFredCsv(await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CXUWATERLB0101M'));
      },
      validate: function (next) {
        if (!(next.national > 0)) throw new Error('water');
      },
      apply: applyWater
    },
    {
      id: 'electricity',
      fetch: async function () {
        var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-'));
        var file = path.join(dir, 'table5a.xlsx');
        await downloadFile(options.factors.electricity.url, file);
        var strings = parseSharedStrings(unzipText(file, 'xl/sharedStrings.xml'));
        return parseElectricityGrid(parseSheetRows(unzipText(file, 'xl/worksheets/sheet1.xml'), strings));
      },
      validate: function (next) {
        if (Object.keys(next.states).length !== 51) throw new Error('electricity states');
      },
      apply: applyElectricity
    },
    {
      id: 'originPropertyTax',
      fetch: async function () {
        var years = [Number(options.factors.originPropertyTax.asOf) + 1, Number(options.factors.originPropertyTax.asOf)];
        var errors = [];
        var y;
        for (y = 0; y < years.length; y++) {
          var year = years[y];
          var base = 'https://www2.census.gov/programs-surveys/acs/summary_file/' + year + '/table-based-SF/data/5YRData/acsdt5y' + year + '-';
          try {
            var taxes = parseCensusTable(await getText(base + 'b25103.dat', 180000));
            var values = parseCensusTable(await getText(base + 'b25077.dat', 180000));
            return { asOf: String(year), counties: censusRates(taxes, values) };
          } catch (error) {
            errors.push(year + ': ' + error.message);
          }
        }
        throw new Error(errors.join('; '));
      },
      validate: function (next, factors) {
        if (coverage(factors.originPropertyTax.counties, next.counties) < 0.95) throw new Error('census coverage');
      },
      apply: applyCountyRates
    },
    {
      id: 'originMedianPrice',
      fetch: async function () {
        var response = await fetch('https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/county_market_tracker.tsv000.gz', {
          signal: AbortSignal.timeout(600000),
          headers: { 'User-Agent': UA }
        });
        if (!response.ok) throw new Error('redfin HTTP ' + response.status);
        var gunzip = zlib.createGunzip();
        stream.Readable.fromWeb(response.body).pipe(gunzip);
        var lines = readline.createInterface({ input: gunzip });
        var chunks = [];
        for await (const line of lines) chunks.push(line);
        return parseRedfin(chunks.join('\n'), loadCountyNameMap(path.join(root, 'zips')));
      },
      validate: function (next, factors) {
        if (coverage(factors.originMedianPrice.counties, next.counties) < 0.9) throw new Error('redfin coverage');
      },
      apply: applyRedfin
    },
    {
      id: 'priceIndex',
      fetch: async function () {
        var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bea-'));
        var metroZip = path.join(dir, 'marpp.zip');
        var stateZip = path.join(dir, 'sarpp.zip');
        await downloadFile('https://apps.bea.gov/regional/zip/MARPP.zip', metroZip);
        await downloadFile('https://apps.bea.gov/regional/zip/SARPP.zip', stateZip);
        return {
          cbsa: parseBeaCsv(unzipMatch(metroZip, /^MARPP_MSA_.*\.csv$/), 'cbsa'),
          state: parseBeaCsv(unzipMatch(stateZip, /^SARPP_STATE_.*\.csv$/), 'state')
        };
      },
      validate: function (next) {
        if (!next.cbsa || !next.state) throw new Error('BEA');
      },
      apply: applyPriceIndexes
    }
  ];
}

async function refreshAll(options) {
  var jobs = options.jobs || defaultJobs(options);
  var failures = [];
  var changed = [];
  var i;
  for (i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    try {
      var next = await job.fetch();
      if (job.validate) job.validate(next, options.factors, options.bundle);
      if (job.apply(options.factors, options.bundle, next, options.today)) changed.push(job.id);
      console.log('ok ' + job.id);
    } catch (error) {
      var message = error && error.message ? error.message : String(error);
      failures.push({ id: job.id, message: message });
      console.error('FAILED ' + job.id + ': ' + message);
    }
  }
  return { failures: failures, changed: changed };
}

function writeChangedFactors(file, factors, original, paths) {
  var text = original;
  paths.forEach(function (pathKeys) {
    var value = pathKeys.reduce(function (node, key) { return node[key]; }, factors);
    text = setJsonPath(text, pathKeys, value);
  });
  if (text !== original) fs.writeFileSync(file, text);
  return text !== original;
}

async function main() {
  var factorsFile = path.join(__dirname, 'factors.json');
  var bundleFile = path.join(__dirname, 'cost-of-living.json');
  var factorsText = fs.readFileSync(factorsFile, 'utf8');
  var bundleText = fs.readFileSync(bundleFile, 'utf8');
  var factors = JSON.parse(factorsText);
  var bundle = JSON.parse(bundleText);
  var result = await refreshAll({ factors: factors, bundle: bundle, root: __dirname });
  var factorPaths = [];
  if (result.changed.indexOf('incomeTax') >= 0) factorPaths.push(['incomeTax', 'states'], ['incomeTax', 'asOf'], ['incomeTax', 'retrieved']);
  if (result.changed.indexOf('salesTax') >= 0) factorPaths.push(['salesTax', 'states'], ['salesTax', 'asOf'], ['salesTax', 'retrieved']);
  if (result.changed.indexOf('water') >= 0) factorPaths.push(['water', 'national'], ['water', 'asOf'], ['water', 'retrieved']);
  if (result.changed.indexOf('electricity') >= 0) factorPaths.push(['electricity', 'states'], ['electricity', 'kwhMonth'], ['electricity', 'asOf'], ['electricity', 'retrieved']);
  if (result.changed.indexOf('originPropertyTax') >= 0) factorPaths.push(['originPropertyTax', 'counties'], ['originPropertyTax', 'asOf'], ['originPropertyTax', 'retrieved'], ['originPropertyTax', 'source'], ['originPropertyTax', 'url']);
  if (result.changed.indexOf('originMedianPrice') >= 0) factorPaths.push(['originMedianPrice', 'counties'], ['originMedianPrice', 'asOf'], ['originMedianPrice', 'retrieved'], ['originMedianPrice', 'source']);
  if (factorPaths.length) writeChangedFactors(factorsFile, factors, factorsText, factorPaths);
  if (result.changed.indexOf('priceIndex') >= 0) fs.writeFileSync(bundleFile, JSON.stringify(bundle, null, 2) + '\n');
  if (result.failures.length) {
    console.error(JSON.stringify(result.failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('refresh complete: ' + (result.changed.join(', ') || 'no value changes'));
  }
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = {
  parseIncomeTaxHtml: parseIncomeTaxHtml,
  parseSalesTaxHtml: parseSalesTaxHtml,
  parseFredCsv: parseFredCsv,
  parseCensusTable: parseCensusTable,
  censusRates: censusRates,
  parseBeaCsv: parseBeaCsv,
  parseRedfin: parseRedfin,
  parseSharedStrings: parseSharedStrings,
  parseSheetRows: parseSheetRows,
  parseElectricityGrid: parseElectricityGrid,
  loadCountyNameMap: loadCountyNameMap,
  refreshAll: refreshAll,
  setJsonPath: setJsonPath,
  deleteJsonPath: deleteJsonPath,
  applyIncomeTax: applyIncomeTax,
  applySalesTax: applySalesTax,
  coverage: coverage
};
