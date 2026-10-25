(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Estimator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const R = 3958.7613;
  const BED_SIZES = ['1 bedroom', '2 bedrooms', '3 bedrooms', '4 bedrooms', '5+ bedrooms'];
  const SIZE_KEYS = ['studio', '1br', '2br', '3br', '4br', '5br'];
  const KNOT_MILES = [300, 750, 1250, 1750, 2250];
  const GUIDE_MILES = 949;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HOUSE_TYPES = { 'Single-story house': 1, 'Multi-story house': 1, 'Townhome': 1 };
  const modelCache = new WeakMap();

  function roadBetween(a, b, factor) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const gc = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    return { gc, road: gc * factor };
  }

  function isOverseasState(state) {
    return state === 'Hawaii';
  }

  function classifyZip(raw, zips) {
    const s = String(raw ?? '').trim();
    if (!s) return { ok: false, code: 'format', message: 'Enter a 5-digit US ZIP code.' };
    const compact = s.replace(/\s+/g, '');
    let zip = null;
    if (/^\d{5}$/.test(compact)) zip = compact;
    else if (/^\d{5}-?\d{4}$/.test(compact)) zip = compact.slice(0, 5);
    else {
      const letters = (s.match(/[A-Za-z]/g) || []).length;
      const digits = (s.match(/\d/g) || []).length;
      if (letters === 1 && digits >= 4 && digits <= 9 && /^[\dA-Za-z\s-]+$/.test(s)) {
        return { ok: false, code: 'typo', message: 'Check your ZIP. US ZIP codes are 5 digits.' };
      }
      if (/[A-Za-z<>]/.test(s)) return { ok: false, code: 'international', message: "International moves aren't supported." };
      return { ok: false, code: 'format', message: 'Enter a 5-digit US ZIP code.' };
    }
    if (zip === '00501') return { ok: false, code: 'pobox', message: 'PO-box-only ZIP: enter your home ZIP.' };
    const prefix = zip.slice(0, 3);
    const n = Number(prefix);
    if ((n >= 90 && n <= 98) || prefix === '340' || (n >= 962 && n <= 966)) {
      return { ok: false, code: 'military', message: 'That looks like a military mail ZIP. Enter your home ZIP.' };
    }
    if (prefix === '006' || prefix === '007' || prefix === '008' || prefix === '009' || prefix === '969') {
      return { ok: false, code: 'territory', message: "US territories aren't supported. Get a quote from a mover who handles that route." };
    }
    const rec = zips && zips.z ? zips.z[zip] : null;
    if (!rec) return { ok: false, code: 'unknown', message: "That ZIP isn't in the Census ZCTA list. If it's a PO Box, enter your home ZIP." };
    const state = zips.usps[rec[2]] || rec[2];
    return { ok: true, zip, state, lat: rec[0], lon: rec[1], overseas: isOverseasState(state) };
  }

  function formatMoney(v) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Math.round(Number(v) * 100) / 100;
    const frac = Math.abs(n - Math.round(n)) >= 0.005;
    return n.toLocaleString('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: frac ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function toCents(n) {
    return Math.round(Number(n) * 100);
  }

  function fromCents(c) {
    const n = c / 100;
    if (Math.round(n * 100) === c) return n;
    const text = (Math.abs(c) / 100).toFixed(2);
    const parsed = (c < 0 ? -1 : 1) * Number(text);
    if (Math.round(parsed * 100) === c) return parsed;
    return n;
  }

  function contradictory(type, size) {
    return type === 'Studio apartment' && BED_SIZES.slice(1).includes(size);
  }

  function hahIndex(type, size) {
    const beds = { '1 bedroom': 1, '2 bedrooms': 2, '3 bedrooms': 3, '4 bedrooms': 4, '5+ bedrooms': 5 }[size];
    const notes = [];
    const house = type === 'Single-story house' || type === 'Multi-story house' || type === 'Townhome';
    if (type === 'Studio apartment') {
      notes.push('Studio is not its own HireAHelper row; the smallest published row is used.');
      return { idx: 0, notes };
    }
    if (house) {
      if (type === 'Single-story house' || type === 'Multi-story house') notes.push('Number of stories is not priced separately in the cited table.');
      if (beds <= 1) {
        notes.push('A 1-bedroom house is not its own HireAHelper row. The 1-bedroom apartment row is used, the same size class as the full-service Studio/1BR cell. No cited table prices a 1-bedroom house separately from a 1-bedroom apartment.');
        return { idx: 0, notes };
      }
      if (beds === 2) return { idx: 2, notes };
      if (beds === 3) return { idx: 3, notes };
      if (beds === 4) return { idx: 4, notes };
      return { idx: 5, notes };
    }
    if (beds <= 1) return { idx: 0, notes };
    if (beds === 2) return { idx: 1, notes };
    if (beds === 3) return { idx: 2, notes };
    if (beds === 4) {
      notes.push('A 4-bedroom apartment is not its own row; the 3-bedroom house / large townhome row is used.');
      return { idx: 3, notes };
    }
    notes.push('A 5+ bedroom apartment is not its own row; the 4-bedroom house row is used.');
    return { idx: 4, notes };
  }

  function guideKey(type, size) {
    if (type === 'Studio apartment') return 'studio';
    if (size === '1 bedroom') return '1br';
    if (size === '3 bedrooms') return '3br';
    if (size === '4 bedrooms') return '4br';
    if (size === '5+ bedrooms') return '5br';
    return '2br';
  }

  function columnFor(key) {
    if (key === 'studio' || key === '1br') return 0;
    if (key === '2br') return 1;
    if (key === '3br') return 2;
    return 3;
  }

  function cmrIndex(type, size) {
    const key = guideKey(type, size);
    const notes = [];
    if (key === '5br') notes.push('5+ bedrooms is the 4+ bedroom cell times the Freightwaves 5-bedroom to 4-bedroom ratio.');
    if (key === 'studio') notes.push('Studio is the Studio/1BR cell times the Freightwaves studio to 1-bedroom ratio.');
    return { i: columnFor(key), notes, key };
  }

  function specsFor(type, size) {
    if (type === 'Studio apartment') {
      const cmr = cmrIndex(type, '1 bedroom');
      if (contradictory(type, size)) cmr.notes.push('Bedroom count was not used because a studio is priced as a studio.');
      const spec = { type, size: '1 bedroom', hah: hahIndex(type, '1 bedroom'), cmr, key: 'studio' };
      return { specs: [spec], ref: spec, typeUnsure: false, sizeUnsure: false };
    }
    const typeUnsure = !type || type === 'Not sure';
    const sizeUnsure = !size || size === 'Not sure';
    const types = typeUnsure ? ['Apartment', 'Single-story house'] : [type];
    const sizes = sizeUnsure ? BED_SIZES : [size];
    const specs = [];
    for (const t of types) {
      for (const s of sizes) {
        if (contradictory(t, s)) continue;
        const cmr = cmrIndex(t, s);
        specs.push({ type: t, size: s, hah: hahIndex(t, s), cmr, key: cmr.key });
      }
    }
    if (!specs.length) {
      const cmr = cmrIndex('Apartment', '2 bedrooms');
      const spec = { type: 'Apartment', size: '2 bedrooms', hah: hahIndex('Apartment', '2 bedrooms'), cmr, key: '2br' };
      return { specs: [spec], ref: spec, typeUnsure: true, sizeUnsure: true };
    }
    let ref = null;
    if (!typeUnsure && !sizeUnsure) ref = specs[0];
    else if (sizeUnsure && !typeUnsure) ref = specs.find(s => s.size === '2 bedrooms') || specs[0];
    else if (sizeUnsure && typeUnsure) ref = specs.find(s => s.type === 'Apartment' && s.size === '2 bedrooms') || specs[0];
    return { specs, ref, typeUnsure, sizeUnsure };
  }

  function order3(t) {
    let lo = t.lo, typ = t.typ, hi = t.hi;
    if (lo > typ) lo = typ;
    if (hi < typ) hi = typ;
    if (lo > hi) lo = hi;
    t.lo = lo;
    t.typ = typ;
    t.hi = hi;
    return t;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function monoChain(list) {
    let prev = null;
    return list.map(raw => {
      let lo = raw.lo, typ = raw.typ, hi = raw.hi;
      if (lo > typ) lo = typ;
      if (hi < typ) hi = typ;
      let heldTo = null;
      let heldEqual = false;
      if (prev) {
        const below = lo < prev.lo || typ < prev.typ || hi < prev.hi;
        if (lo < prev.lo) lo = prev.lo;
        if (typ < prev.typ) typ = prev.typ;
        if (hi < prev.hi) hi = prev.hi;
        if (lo > typ) typ = lo;
        if (hi < typ) hi = typ;
        if (below) {
          heldTo = prev.key;
          heldEqual = lo === prev.lo && typ === prev.typ && hi === prev.hi;
        }
      }
      prev = { key: raw.key, lo, typ, hi, heldTo, heldEqual };
      return prev;
    });
  }

  function buildModel(D) {
    const mv = D.movers.value;
    const lim = D.assumptions.limitedSample;
    const cols = [];
    for (let s = 0; s < 4; s++) {
      const bands = [];
      for (let b = 0; b < 5; b++) {
        let lo = mv.low[b][s], md = mv.median[b][s], hi = mv.high[b][s];
        const limited = mv.sample[b][s] === 'limited sample';
        if (limited) {
          lo *= lim.lowFactor;
          hi *= lim.highFactor;
        }
        if (bands.length) {
          const p = bands[bands.length - 1];
          if (lo < p.lo) lo = p.lo;
          if (md < p.md) md = p.md;
          if (hi < p.hi) hi = p.hi;
        }
        if (lo > md) lo = md;
        if (hi < md) hi = md;
        bands.push({
          lo, md, hi, limited,
          period: (b === 3 && s === 3) ? 'Dec 2022-Sep 2026' : D.movers.asOf,
          band: mv.bands[b]
        });
      }
      cols.push(bands);
    }
    const fr = D.routeGuide.full.ranges;
    const studioLoR = fr.studio[0] / fr['1br'][0];
    const studioTypR = ((fr.studio[0] + fr.studio[1]) / 2) / ((fr['1br'][0] + fr['1br'][1]) / 2);
    const fiveLoR = fr['5br'][0] / fr['4br'][0];
    const fiveTypR = ((fr['5br'][0] + fr['5br'][1]) / 2) / ((fr['4br'][0] + fr['4br'][1]) / 2);
    const fiveHiR = fr['5br'][1] / fr['4br'][1];
    const ratios = { studioLoR, studioTypR, fiveLoR, fiveTypR, fiveHiR };
    function baseHigh(key) {
      const at = interpColumn(cols[columnFor(key)], GUIDE_MILES);
      let hi = at.hi;
      if (key === '5br') hi *= fiveHiR;
      return hi;
    }
    const targets = {
      studio: fr.studio[1],
      '1br': fr['1br'][1],
      '2br': D.routeGuide.full2brHigh.value,
      '3br': fr['3br'][1],
      '4br': fr['4br'][1],
      '5br': fr['5br'][1]
    };
    const highRatio = {};
    SIZE_KEYS.forEach(key => {
      const hi = baseHigh(key);
      highRatio[key] = targets[key] > hi ? targets[key] / hi : 1;
    });
    const ld = D.hah.value.ld1200.full;
    const house = {
      '2br': ld[2] / ld[1],
      '3br': ld[3] / ld[2],
      '4br': ld[4] / ld[3],
      '5br': ld[5] / ld[4]
    };
    const guides = {
      truck: monoGuides('truck'),
      container: monoGuides('container')
    };
    function monoGuides(mode) {
      const table = D.routeGuide[mode].ranges;
      const raw = SIZE_KEYS.map(key => {
        const pair = table[key];
        let typ = (pair[0] + pair[1]) / 2;
        if (mode === 'truck' && key === '2br') typ = D.routeGuide.truck.typical2br.value;
        return { key, lo: pair[0], typ, hi: pair[1] };
      });
      return monoChain(raw);
    }
    return { cols, ratios, highRatio, house, guides, targets };
  }

  function model(D) {
    let m = modelCache.get(D);
    if (!m) {
      m = buildModel(D);
      modelCache.set(D, m);
    }
    return m;
  }

  function interpColumn(bands, road) {
    const knots = bands.map((b, i) => ({ m: KNOT_MILES[i], lo: b.lo, md: b.md, hi: b.hi, period: b.period, limited: b.limited, band: b.band }));
    function pack(a, b, t) {
      let period = a.period;
      if (a.period !== b.period) period = (String(a.period).indexOf('2022') >= 0 || String(b.period).indexOf('2022') >= 0) ? 'Dec 2022-Sep 2026' : a.period;
      return {
        lo: lerp(a.lo, b.lo, t),
        md: lerp(a.md, b.md, t),
        hi: lerp(a.hi, b.hi, t),
        period,
        limited: a.limited || b.limited,
        band: t < 0.5 ? a.band : b.band
      };
    }
    if (road <= knots[0].m) return { lo: knots[0].lo, md: knots[0].md, hi: knots[0].hi, period: knots[0].period, limited: knots[0].limited, band: knots[0].band };
    if (road >= knots[4].m) {
      const a = knots[3], b = knots[4];
      const t = (road - knots[4].m) / (knots[4].m - knots[3].m);
      return {
        lo: b.lo + Math.max(0, b.lo - a.lo) * t,
        md: b.md + Math.max(0, b.md - a.md) * t,
        hi: b.hi + Math.max(0, b.hi - a.hi) * t,
        period: b.period,
        limited: b.limited,
        band: b.band
      };
    }
    for (let i = 0; i < 4; i++) {
      if (road <= knots[i + 1].m) {
        const t = (road - knots[i].m) / (knots[i + 1].m - knots[i].m);
        return pack(knots[i], knots[i + 1], t);
      }
    }
    return pack(knots[3], knots[4], 1);
  }

  function seasonFactor(D, when) {
    if (!when || when === 'Not sure') return { factor: 1, month: '' };
    const name = String(when).split(' ')[0];
    const i = MONTHS.indexOf(name);
    if (i < 0) return { factor: 1, month: '' };
    const jan = D.cmrSeason.value.jan, jul = D.cmrSeason.value.jul, mid = (jan + jul) / 2;
    const level = i <= 6 ? jan + (jul - jan) * (i / 6) : jul - (jul - jan) * ((i - 6) / 6);
    return { factor: level / mid, month: name };
  }

  function houseFactor(D, type, key) {
    if (!HOUSE_TYPES[type]) return 1;
    const h = model(D).house;
    return h[key] || 1;
  }

  function cmrAt(D, key, type, road, when) {
    const m = model(D);
    const col = interpColumn(m.cols[columnFor(key)], road);
    const r = m.ratios;
    let lo = col.lo, typ = col.md, hi = col.hi;
    if (key === 'studio') {
      lo *= r.studioLoR;
      typ *= r.studioTypR;
    } else if (key === '5br') {
      lo *= r.fiveLoR;
      typ *= r.fiveTypR;
      hi *= r.fiveHiR;
    }
    hi *= m.highRatio[key];
    const hf = houseFactor(D, type, key);
    lo *= hf;
    typ *= hf;
    hi *= hf;
    const season = seasonFactor(D, when);
    if (season.factor !== 1) {
      lo *= season.factor;
      typ *= season.factor;
    }
    if (key === '5br') {
      const four = cmrAt(D, '4br', type, road, when);
      const ratio = model(D).ratios;
      if (!(lo > four.lo)) lo = four.lo * ratio.fiveLoR;
      if (!(typ > four.typ)) typ = four.typ * ratio.fiveTypR;
      if (!(hi > four.hi)) hi = four.hi * ratio.fiveHiR;
    }
    const priced = order3({ lo, typ, hi });
    priced.period = col.period;
    priced.limited = col.limited;
    priced.band = col.band;
    priced.season = season;
    priced.highRatio = m.highRatio[key];
    return priced;
  }

  function localTriple(D, spec) {
    const local = D.hah.value.local.full[spec.hah.idx];
    const spread = D.assumptions.fullLocal;
    return order3({ lo: local * spread.lowFactor, typ: local, hi: local * spread.highFactor, row: D.hah.value.rows[spec.hah.idx] });
  }

  function priceFullSpec(D, spec, road, when) {
    const local = localTriple(D, spec);
    if (!(road >= 50)) {
      return { lo: local.lo, typ: local.typ, hi: local.hi, method: 'local', row: local.row, cell: null, season: { factor: 1, month: '' } };
    }
    const end = cmrAt(D, spec.key, spec.type, 300, when);
    let priced;
    let method = 'cmr';
    let meta = end;
    if (road < 300) {
      const t = (road - 50) / 250;
      const target = {
        lo: Math.max(local.lo, end.lo),
        typ: Math.max(local.typ, end.typ),
        hi: Math.max(local.hi, end.hi)
      };
      priced = order3({
        lo: lerp(local.lo, target.lo, t),
        typ: lerp(local.typ, target.typ, t),
        hi: lerp(local.hi, target.hi, t)
      });
      method = 'ramp';
    } else {
      meta = cmrAt(D, spec.key, spec.type, road, when);
      priced = order3({
        lo: Math.max(local.lo, meta.lo),
        typ: Math.max(local.typ, meta.typ),
        hi: Math.max(local.hi, meta.hi)
      });
    }
    return {
      lo: priced.lo, typ: priced.typ, hi: priced.hi, method, row: local.row,
      cell: {
        band: meta.band,
        size: spec.key,
        period: meta.period,
        limited: meta.limited,
        highRatio: meta.highRatio,
        season: meta.season
      },
      season: meta.season
    };
  }

  function sizeForKey(key) {
    if (key === 'studio') return '1 bedroom';
    return BED_SIZES[SIZE_KEYS.indexOf(key) - 1] || '2 bedrooms';
  }

  function diyEndpoints(D, mode, type) {
    const guides = model(D).guides[mode];
    const keys = type === 'Studio apartment' ? ['studio'] : ['1br', '2br', '3br', '4br', '5br'];
    const rows = keys.map((key, i) => {
      const size = sizeForKey(key);
      const idx = hahIndex(type, size).idx;
      const typ = D.hah.value.local[mode][idx];
      const g = guides[SIZE_KEYS.indexOf(key)];
      return { key, lo: typ * D.assumptions.diyScale.lowFactor, typ, hi: typ * D.assumptions.diyScale.highFactor, glo: g.lo, gtyp: g.typ, ghi: g.hi };
    });
    function slopes(localKey, guideKey) {
      let prev = 0;
      return rows.map(row => {
        const natural = Math.max(0, (row[guideKey] - row[localKey]) / GUIDE_MILES);
        const slope = Math.max(natural, prev);
        prev = slope;
        return slope;
      });
    }
    const slo = slopes('lo', 'glo');
    const styp = slopes('typ', 'gtyp');
    const shi = slopes('hi', 'ghi');
    return rows.map((row, i) => ({
      key: row.key,
      rise(road) {
        function one(local, guide, slope) {
          if (road <= GUIDE_MILES) {
            if (guide < local) return local;
            return local + (guide - local) * (road / GUIDE_MILES);
          }
          const base = guide < local ? local : guide;
          return base + slope * (road - GUIDE_MILES);
        }
        return order3({
          lo: one(row.lo, row.glo, slo[i]),
          typ: one(row.typ, row.gtyp, styp[i]),
          hi: one(row.hi, row.ghi, shi[i])
        });
      }
    }));
  }

  function priceDiySpec(D, key, spec, road, when) {
    const chain = diyEndpoints(D, key, spec.type);
    const row = chain.find(r => r.key === spec.key) || chain[chain.length - 1];
    const diy = row.rise(Math.max(0, road));
    const full = priceFullSpec(D, spec, road, when);
    const priced = capDiyToFull(diy, full);
    const guide = model(D).guides[key][SIZE_KEYS.indexOf(spec.key)] || {};
    return {
      lo: priced.lo, typ: priced.typ, hi: priced.hi, capped: priced.capped,
      row: D.hah.value.rows[spec.hah.idx], method: 'guide',
      heldTo: guide.heldTo || null, heldEqual: !!guide.heldEqual
    };
  }

  function sizeWord(key) {
    return { studio: 'studio', '1br': '1-bedroom', '2br': '2-bedroom', '3br': '3-bedroom', '4br': '4-bedroom', '5br': '5-bedroom' }[key] || key;
  }

  function heldSentence(parts) {
    const bits = [];
    const seen = new Set();
    (parts || []).forEach(p => {
      if (!p.heldEqual || !p.heldTo) return;
      const id = `${p.spec && p.spec.key}>${p.heldTo}`;
      if (seen.has(id)) return;
      seen.add(id);
      const bigger = sizeWord(p.spec.key);
      bits.push(`The published long-distance price for a ${bigger} is not higher than a ${sizeWord(p.heldTo)}, so those sizes are held equal. No extra dollar is added.`);
    });
    return bits.join(' ');
  }

  function capDiyToFull(diy, full) {
    let typ = Math.min(diy.typ, full.typ);
    let lo = Math.min(diy.lo, full.lo);
    let hi = Math.min(diy.hi, full.hi);
    if (lo > typ) lo = typ;
    if (hi < typ) hi = typ;
    const capped = diy.typ - typ > 1e-6 || diy.hi - hi > 1e-6 || diy.lo - lo > 1e-6;
    return { lo, typ, hi, capped };
  }

  function median(nums) {
    const s = nums.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function combineParts(parts, refTyp) {
    return order3({
      lo: Math.min(...parts.map(p => p.lo)),
      typ: refTyp == null ? median(parts.map(p => p.typ)) : refTyp,
      hi: Math.max(...parts.map(p => p.hi))
    });
  }

  function uniqueNotes(list) {
    const out = [];
    list.forEach(n => { if (n && !out.includes(n)) out.push(n); });
    return out;
  }

  function source(obj, caveat) {
    return {
      source: obj.source || obj.label || '',
      url: obj.url || null,
      asOf: obj.asOf || null,
      checked: obj.checked || null,
      status: obj.status || '',
      caveat: caveat || obj.caveat || ''
    };
  }

  function line(partial) {
    return Object.assign({
      lo: null, typ: null, hi: null, display: 'not-included', group: 'moving', sources: [], note: ''
    }, partial);
  }

  function checkedDate(D) {
    return (D.meta && D.meta.checked) || '2026-10-25';
  }

  function gasBlend(D, state) {
    const fl = D.gas.states.Florida;
    const origin = state && D.gas.states[state] != null ? D.gas.states[state] : fl;
    if (origin === fl) return { lo: fl, typ: fl, hi: fl, origin: fl, same: true };
    const lo = Math.min(origin, fl), hi = Math.max(origin, fl);
    return { lo, hi, typ: (origin + fl) / 2, origin, same: false };
  }

  function fuelAt(miles, mpg, price) {
    return miles / mpg * price;
  }

  function milesLabel(road) {
    return `${Math.round(road).toLocaleString('en-US')} estimated road miles`;
  }

  function coreForMode(D, mode, built, road, when) {
    const parts = built.specs.map(spec => {
      if (mode === 'full') return Object.assign(priceFullSpec(D, spec, road, when), { spec });
      return Object.assign(priceDiySpec(D, mode, spec, road, when), { spec });
    });
    const refPart = built.ref ? parts.find(p => p.spec === built.ref) : null;
    const combined = combineParts(parts, refPart ? refPart.typ : null);
    return { parts, combined };
  }

  function envelopeNote(built) {
    const notes = [];
    if (built.sizeUnsure && built.typeUnsure) notes.push('Home size and property type were not chosen. Low and high cover the published rows. Typical is the 2-bedroom apartment.');
    else if (built.sizeUnsure) notes.push('Home size was not chosen. Low and high cover the published rows. Typical is the 2-bedroom row.');
    else if (built.typeUnsure) notes.push('Property type was not chosen. Low and high cover an apartment and a house. Typical is the midpoint of those two.');
    built.specs.forEach(spec => {
      spec.hah.notes.forEach(n => notes.push(n));
      spec.cmr.notes.forEach(n => notes.push(n));
    });
    return uniqueNotes(notes);
  }

  function seasonText(D, season, applied) {
    const s = D.cmrSeason.value;
    if (!season || !season.month) return 'Move month was not chosen, so the January and July medians are not applied.';
    if (!applied || season.factor === 1) return `${season.month} sits on the midpoint of CMR's January 2-bedroom median ($${s.jan.toLocaleString('en-US')}) and July median ($${s.jul.toLocaleString('en-US')}), so low and typical are not shifted.`;
    return `${season.month} is priced between CMR's January 2-bedroom median of $${s.jan.toLocaleString('en-US')} and the July median of $${s.jul.toLocaleString('en-US')}. Low and typical follow that month. High stays on the distance range.`;
  }

  function methodNote(D, mode, parts, road) {
    if (mode !== 'full') {
      const hit = parts.some(p => p.capped) ? ' The full-service cap applies on this move.' : '';
      const held = heldSentence(parts);
      return `Rises in a straight line from the HireAHelper local price at 0 miles through the Maryland-to-Florida guide at ${GUIDE_MILES} miles, then keeps that per-mile slope. Kept at or under full-service for the same home. The 0.8 and 1.25 ends at 0 miles are an assumption.${hit}${held ? ' ' + held : ''}`;
    }
    const methods = new Set(parts.map(p => p.method));
    if ([...methods].every(m => m === 'local')) {
      return 'Under 50 miles, priced from HireAHelper\'s local table. Typical is the published figure. Low and high use a 0.75 / 1.25 range, which is an assumption.';
    }
    const cell = (parts.find(p => p.cell) || {}).cell;
    let text = '';
    if (methods.has('ramp')) {
      text = 'From 50 to 300 miles the price moves in a straight line from the local table at 50 miles to the long-distance band at its 300-mile midpoint, so a short trip is not priced as a 100–499 mile move.';
    } else if (cell) {
      text = `Long-distance price interpolated between the published band midpoints at 300, 750, 1,250, 1,750, and 2,250 miles. ${milesLabel(road)}.`;
    }
    if (cell && cell.limited) text += ' A limited-sample cell on this span is widened (low × 0.75, high × 1.25) and then held so a longer move is not cheaper. That width is this estimator\'s allowance.';
    if (cell && cell.period && String(cell.period).indexOf('2022') >= 0) text += ` Dated cell: ${cell.period}. A newer figure for that band was not in the CMR table when it was checked.`;
    else if (cell && cell.period && cell.period !== D.movers.asOf) text += ` A cell on this span still covers ${cell.period}; a newer figure was not in the CMR table when it was checked.`;
    if (cell && cell.highRatio > 1) text += ' High is scaled so the 949-mile anchor matches the higher published route high.';
    if (cell && cell.season) text += ' ' + seasonText(D, cell.season, true);
    return text;
  }

  function priceCore(D, answers, road) {
    const A = answers || {};
    const built = specsFor(A.type, A.size);
    const miles = Math.max(0, Number(road) || 0);
    const help = A.help || 'Not sure';
    const when = A.when;
    const gas = gasBlend(D, 'Florida');
    const truckMpg = D.assumptions.truckMpg.value;
    const fuel = miles / truckMpg * gas.typ;
    const notes = envelopeNote(built);

    if (help === 'Not sure') {
      const full = coreForMode(D, 'full', built, miles, when);
      const truck = coreForMode(D, 'truck', built, miles, when);
      const box = coreForMode(D, 'container', built, miles, when);
      const truckAll = {
        lo: truck.combined.lo + fuel,
        typ: truck.combined.typ + fuel,
        hi: truck.combined.hi + fuel
      };
      const env = order3({
        lo: Math.min(truckAll.lo, box.combined.lo, full.combined.lo),
        typ: full.combined.typ,
        hi: Math.max(truckAll.hi, box.combined.hi, full.combined.hi)
      });
      notes.unshift('Help level was not chosen. Typical is the full-service price. Low is the cheapest of a DIY truck plus truck fuel, a container, and full-service. High is the highest of those. Truck and container prices rise with miles and stay at or under full-service.');
      const held = heldSentence(truck.parts.concat(box.parts));
      if (held) notes.push(held);
      notes.push(seasonText(D, full.parts[0] && full.parts[0].season, miles >= 50));
      const unsureSources = [source(D.hah), source(D.movers), source(D.routeGuide.full), source(D.assumptions.diyScale), source(D.gas), source(D.assumptions.truckMpg), source(D.cmrSeason)];
      if (held && D.routeGuide.truck.sizeHold) unsureSources.push(source(D.routeGuide.truck.sizeHold));
      return {
        ok: true,
        mode: 'full',
        line: line({
          id: 'moving',
          label: 'Moving the belongings',
          display: 'money',
          lo: env.lo, typ: env.typ, hi: env.hi,
          note: uniqueNotes(notes).join(' '),
          sources: unsureSources
        })
      };
    }

    const mode = help === 'DIY rental truck' ? 'truck' : help === 'Moving container' ? 'container' : 'full';
    const result = coreForMode(D, mode, built, miles, when);
    if (mode !== 'full') {
      const full = coreForMode(D, 'full', built, miles, when);
      const capped = capDiyToFull(result.combined, full.combined);
      if (capped.capped) result.parts.forEach(p => { p.capped = true; });
      result.combined.lo = capped.lo;
      result.combined.typ = capped.typ;
      result.combined.hi = capped.hi;
    }
    notes.push(methodNote(D, mode, result.parts, miles));
    const names = { truck: 'DIY rental truck', container: 'Moving container', full: 'Full-service movers' };
    const sources = [source(D.hah)];
    if (mode === 'full' && result.parts.some(p => p.method !== 'local')) {
      const moverSrc = source(D.movers);
      const cell = result.parts[0] && result.parts[0].cell;
      if (result.parts.length === 1 && cell && cell.period) moverSrc.asOf = cell.period;
      sources.push(moverSrc);
      if (cell && cell.limited) sources.push(source(D.assumptions.limitedSample));
      if (cell && cell.highRatio > 1) {
        sources.push(source(D.routeGuide.full));
        if (built.ref && built.ref.key === '2br') sources.push(source(D.routeGuide.full2brHigh));
      }
      if (cell && cell.season && cell.season.month) sources.push(source(D.cmrSeason));
    }
    if (mode !== 'full') {
      sources.push(source(D.routeGuide[mode]));
      sources.push(source(D.assumptions.diyScale));
      if (mode === 'truck' && built.ref && built.ref.key === '2br') sources.push(source(D.routeGuide.truck.typical2br));
      if (mode === 'truck' && result.parts.some(p => p.heldEqual) && D.routeGuide.truck.sizeHold) sources.push(source(D.routeGuide.truck.sizeHold));
    }
    if (mode === 'full' && result.parts.some(p => p.method === 'local' || p.method === 'ramp')) sources.push(source(D.assumptions.fullLocal));
    const rowLabel = result.parts.length === 1 ? ` — ${result.parts[0].row}` : '';
    return {
      ok: true,
      mode,
      line: line({
        id: 'moving',
        label: names[mode] + rowLabel,
        display: 'money',
        lo: result.combined.lo,
        typ: result.combined.typ,
        hi: result.combined.hi,
        note: uniqueNotes(notes).join(' '),
        sources
      })
    };
  }

  const VEHICLE_CAVEAT = 'It seems you have selected to transport seven or more vehicles. Please contact a relocation company directly for a better estimate.';

  function countOf(value, max) {
    if (value == null || value === 'Not sure') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > max) return null;
    return n;
  }

  function vehicleCount(value) {
    if (value == null || value === 'Not sure') return null;
    const raw = String(value).trim();
    const n = raw === '7+' ? 7 : Number(raw);
    if (!Number.isInteger(n) || n < 0) return null;
    return { priced: n >= 7 ? 7 : n, many: n >= 7 };
  }

  function chosen(D, label, note) {
    const day = checkedDate(D);
    return line({
      label, display: 'not-selected', group: 'other', note,
      sources: [{ source: 'Not selected', url: null, asOf: day, checked: day, status: 'CHOSEN', caveat: '' }]
    });
  }

  function missing(label, group, unsourced, note) {
    return line({
      label, display: 'not-included', group, note,
      sources: [source(unsourced)]
    });
  }

  function adultSpread(answers, D) {
    if (!answers.adults || answers.adults === 'Not sure') {
      const a = D.assumptions.adultsUnsure;
      return { lo: a.low, typ: a.typical, hi: a.high, assumed: true };
    }
    const n = countOf(answers.adults, 12);
    if (n == null) return { lo: D.assumptions.adultsUnsure.low, typ: D.assumptions.adultsUnsure.typical, hi: D.assumptions.adultsUnsure.high, assumed: true };
    const used = Math.max(1, n);
    return { lo: used, typ: used, hi: used, assumed: false, clamped: n < 1 };
  }

  function nightsFor(miles, mpd) {
    return Math.max(0, Math.ceil(miles / mpd) - 1);
  }

  function travelDays(miles, mpd) {
    if (!(miles > 0)) return 0;
    return Math.max(1, Math.ceil(miles / mpd));
  }

  function mealDays(nights) {
    if (nights <= 0) return 0;
    return nights + 0.5;
  }

  function staticNotIncluded() {
    return [
      'Utility and rental deposits',
      'Closing costs',
      'Tips'
    ];
  }

  function packKey(spec) {
    return spec ? spec.key : '2br';
  }

  function packingTriple(D, key, kind) {
    const pair = D.packing[kind][key] || D.packing[kind]['2br'];
    const mat = D.packing.materials[key] || D.packing.materials['2br'];
    return {
      labor: order3({ lo: pair[0], typ: (pair[0] + pair[1]) / 2, hi: pair[1] }),
      materials: order3({ lo: mat[0], typ: (mat[0] + mat[1]) / 2, hi: mat[1] })
    };
  }

  function monoKnots(pairs, key) {
    const knots = [];
    let water = -Infinity;
    pairs.forEach((pair, i) => {
      const m = pair.miles;
      const v = pair[key];
      if (!i) {
        water = v;
        knots.push({ m, v: water });
        return;
      }
      const prev = pairs[i - 1];
      const v0 = prev[key];
      if (v0 < water && v > water) {
        const t = (water - v0) / (v - v0);
        knots.push({ m: prev.miles + t * (m - prev.miles), v: water });
        water = v;
        knots.push({ m, v: water });
        return;
      }
      water = Math.max(water, v);
      knots.push({ m, v: water });
    });
    return knots;
  }

  function interpKnots(knots, miles) {
    if (miles <= knots[0].m) return knots[0].v;
    const last = knots[knots.length - 1];
    if (miles >= last.m) return last.v;
    for (let i = 0; i < knots.length - 1; i++) {
      if (miles <= knots[i + 1].m) {
        const span = knots[i + 1].m - knots[i].m;
        const t = span ? (miles - knots[i].m) / span : 0;
        return lerp(knots[i].v, knots[i + 1].v, t);
      }
    }
    return last.v;
  }

  function pavaNonDecreasing(values) {
    const blocks = [];
    values.forEach(v => {
      blocks.push({ sum: v, n: 1 });
      while (blocks.length >= 2) {
        const a = blocks[blocks.length - 2];
        const b = blocks[blocks.length - 1];
        if (a.sum / a.n <= b.sum / b.n) break;
        blocks.pop();
        a.sum += b.sum;
        a.n += b.n;
      }
    });
    const out = [];
    blocks.forEach(b => {
      const avg = b.sum / b.n;
      for (let i = 0; i < b.n; i++) out.push(avg);
    });
    return out;
  }

  function describeLowFit(knots) {
    const groups = [];
    knots.forEach(k => {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last.v - k.v) < 0.001) last.to = k.m;
      else groups.push({ from: k.m, to: k.m, v: k.v });
    });
    const money = v => '$' + Math.round(v).toLocaleString('en-US');
    return groups.map((g, i) => {
      const price = money(g.v);
      const from = g.from.toLocaleString('en-US');
      const to = g.to.toLocaleString('en-US');
      if (!i) return `${price} from ${from} to ${to} miles`;
      const prev = groups[i - 1];
      if (g.from > prev.to) return `then rises to ${price} by ${from} miles and holds through ${to} miles`;
      return `${price} from ${from} to ${to} miles`;
    }).join(', ');
  }

  function shipCurve(D) {
    const cached = model(D);
    if (cached.ship) return cached.ship;
    const pairs = D.ship.pairs.slice().sort((a, b) => a.miles - b.miles);
    const fitted = pavaNonDecreasing(pairs.map(p => p.lo));
    const loK = pairs.map((p, i) => ({ m: p.miles, v: fitted[i] }));
    const hiK = monoKnots(pairs, 'hi');
    const floorM = pairs[0].miles;
    const ceilM = pairs[pairs.length - 1].miles;
    const long = D.ship.longHaul;
    const fw = D.ship.freightwaves;
    const short = D.ship.shortHaul;
    function spanAt(miles) {
      const clamped = Math.max(floorM, Math.min(miles, ceilM));
      const scale = fw.miles ? clamped / fw.miles : 0;
      let lo = Math.min(interpKnots(loK, clamped), fw.lo * scale);
      let hi = Math.max(interpKnots(hiK, clamped), fw.hi * scale);
      let typ = D.ship.corridor.average * (clamped / D.ship.corridor.miles);
      if (miles > ceilM && long) {
        const destLo = Math.max(lo, long.lo);
        const destTyp = Math.max(typ, long.typ);
        const destHi = Math.max(hi, long.hi);
        if (miles >= long.miles) {
          lo = destLo;
          typ = destTyp;
          hi = destHi;
        } else {
          const t = (miles - ceilM) / (long.miles - ceilM);
          lo = lerp(lo, destLo, t);
          typ = lerp(typ, destTyp, t);
          hi = lerp(hi, destHi, t);
        }
      }
      if (lo > typ) typ = lo;
      if (hi < typ) hi = typ;
      return { lo, typ, hi };
    }
    const atFloor = spanAt(floorM);
    function at(miles) {
      if (short && miles <= short.miles) return { lo: short.lo, typ: short.typ, hi: short.hi };
      if (short && miles < floorM) {
        const t = (miles - short.miles) / (floorM - short.miles);
        return {
          lo: lerp(short.lo, atFloor.lo, t),
          typ: lerp(short.typ, atFloor.typ, t),
          hi: lerp(short.hi, atFloor.hi, t)
        };
      }
      return spanAt(miles);
    }
    const N = 4001;
    const lo = new Float64Array(N);
    const typ = new Float64Array(N);
    const hi = new Float64Array(N);
    let prev = null;
    for (let m = 0; m < N; m++) {
      const v = at(m);
      if (prev) {
        v.lo = Math.max(v.lo, prev.lo);
        v.typ = Math.max(v.typ, prev.typ, v.lo);
        v.hi = Math.max(v.hi, prev.hi, v.typ);
      }
      lo[m] = v.lo;
      typ[m] = v.typ;
      hi[m] = v.hi;
      prev = v;
    }
    cached.ship = { lo, typ, hi, max: N - 1, floorM, ceilM, lowKnots: loK, lowFitText: describeLowFit(loK) };
    return cached.ship;
  }

  function snowSentence(D, when, origin) {
    const snow = D.ship.snowbird;
    if (!snow || !origin || !origin.state || origin.state === 'Florida') return '';
    const month = String(when || '').split(' ')[0];
    if (snow.months && snow.months.indexOf(month) >= 0) {
      return ` RoadRunner says: "${snow.quote}" That ${snow.percent}% is not added to this estimate.`;
    }
    if (month === 'December') {
      return ` RoadRunner says rates rise through the fall snowbird season, September through December. The ${snow.percent}% it publishes is for October and November, so it is not added in December.`;
    }
    return '';
  }

  function shipOpen(D, miles) {
    const curve = shipCurve(D);
    const m = Math.max(0, Number(miles) || 0);
    if (m >= curve.max) return { lo: curve.lo[curve.max], typ: curve.typ[curve.max], hi: curve.hi[curve.max] };
    const i = Math.floor(m);
    const t = m - i;
    return order3({
      lo: lerp(curve.lo[i], curve.lo[i + 1], t),
      typ: lerp(curve.typ[i], curve.typ[i + 1], t),
      hi: lerp(curve.hi[i], curve.hi[i + 1], t)
    });
  }

  function nearestAirports(D, origin) {
    const cached = model(D);
    if (!cached.fareCache) cached.fareCache = new Map();
    const key = origin.lat + ',' + origin.lon;
    const hit = cached.fareCache.get(key);
    if (hit) return hit;
    const airports = (D.airfare && D.airfare.airports) || [];
    const by = (D.airfare && D.airfare.byAirport) || {};
    let nearest = null;
    let withFare = null;
    for (let i = 0; i < airports.length; i++) {
      const row = airports[i];
      const hop = roadBetween(origin, { lat: row[1], lon: row[2] }, 1);
      if (!hop) continue;
      const spot = { code: row[0], d: hop.gc, name: row[3] || row[0] };
      if (!nearest || spot.d < nearest.d) nearest = spot;
      if (by[spot.code] && (!withFare || spot.d < withFare.d)) withFare = spot;
    }
    const result = { nearest, withFare };
    cached.fareCache.set(key, result);
    return result;
  }

  function pickAirfare(D, origin) {
    const table = D.airfare;
    const found = nearestAirports(D, origin);
    const nearest = found.nearest;
    const withFare = found.withFare;
    if (!nearest) return null;
    const dc = new Set(table.dcAirports || ['BWI', 'DCA', 'IAD']);
    const far = table.farMiles || 150;
    const minPax = table.minPassengers || 10;
    const about = miles => `about ${Math.round(miles).toLocaleString('en-US')} miles`;
    let used = nearest;
    let fare = null;
    let blend = false;
    let estimate = false;
    const reasons = [];
    if (dc.has(nearest.code)) {
      blend = true;
      fare = { lo: table.lo, typ: table.typ, hi: table.hi };
    } else if (table.byAirport && table.byAirport[nearest.code]) {
      fare = table.byAirport[nearest.code];
    } else if (withFare && table.byAirport[withFare.code]) {
      used = withFare;
      fare = table.byAirport[withFare.code];
      estimate = true;
      reasons.push(`The nearest Table 1a airport is ${nearest.code} (${nearest.name}), ${about(nearest.d)} away, and it has no 2026 Q1 Tampa or Sarasota fare with at least ${minPax} passengers a day.`);
    } else return null;
    if (used.d > far) {
      estimate = true;
      reasons.push(`${used.code} is ${about(used.d)} from the start, past this estimator's ${far}-mile labeling line, so the line is marked as an estimate.`);
    }
    let head;
    if (blend) {
      head = `Each-way fare, 2026 Q1. The nearest airport is ${nearest.code} (${nearest.name}), ${about(nearest.d)} away, so this uses the Washington-area blend of DCA, IAD, and BWI to Tampa and Sarasota. Low $${table.lo} is the BWI–Tampa lowest-carrier average. Typical $${table.typ} is the passenger-weighted average of those six pairs. High $${table.hi} is the BWI–Sarasota average.`;
    } else {
      head = `Each-way fare, 2026 Q1, ${used.code} (${fare.city}), ${about(used.d)} from the start. ${fare.blurb}`;
    }
    const why = reasons.length ? ' ' + reasons.join(' ') : '';
    return { lo: fare.lo, typ: fare.typ, hi: fare.hi, estimate, note: `${head}${why}` };
  }

  function applyShipOptions(D, base, answers) {
    const out = { lo: base.lo, typ: base.typ, hi: base.hi };
    if (answers.shipBody === 'SUV') {
      out.lo += D.ship.suvAdd.lo;
      out.hi += D.ship.suvAdd.hi;
      out.typ += (D.ship.suvAdd.lo + D.ship.suvAdd.hi) / 2;
    }
    if (answers.shipCarrier === 'Enclosed') {
      out.lo *= D.ship.enclosedFactor;
      out.typ *= D.ship.enclosedFactor;
      out.hi *= D.ship.enclosedFactor;
    }
    return order3(out);
  }

  function taxRate(D, dest) {
    if (dest && dest.county && D.lodgingTax.counties[dest.county] != null) return D.lodgingTax.counties[dest.county];
    return null;
  }

  function roundLine(l) {
    if (l.display !== 'money') return l;
    const ordered = order3({ lo: l.lo, typ: l.typ, hi: l.hi });
    l.lo = fromCents(toCents(ordered.lo));
    l.typ = fromCents(toCents(ordered.typ));
    l.hi = fromCents(toCents(ordered.hi));
    const again = order3({ lo: toCents(l.lo), typ: toCents(l.typ), hi: toCents(l.hi) });
    l.lo = fromCents(again.lo);
    l.typ = fromCents(again.typ);
    l.hi = fromCents(again.hi);
    return l;
  }

  function sumCents(lines, group) {
    const priced = lines.filter(l => l.display === 'money' && (!group || l.group === group));
    if (!priced.length) return null;
    const acc = { lo: 0, typ: 0, hi: 0 };
    priced.forEach(l => {
      acc.lo += toCents(l.lo);
      acc.typ += toCents(l.typ);
      acc.hi += toCents(l.hi);
    });
    return { lo: fromCents(acc.lo), typ: fromCents(acc.typ), hi: fromCents(acc.hi) };
  }

  function moneyLine(partial) {
    const ordered = order3({ lo: partial.lo, typ: partial.typ, hi: partial.hi });
    return line(Object.assign({}, partial, ordered, { display: 'money' }));
  }

  function estimateMove(answers, D) {
    const A = answers || {};
    const origin = A.origin || null;
    const vehiclesInfo = vehicleCount(A.veh);
    const vehicles = vehiclesInfo ? vehiclesInfo.priced : null;
    const vehicleCaveat = vehiclesInfo && vehiclesInfo.many ? VEHICLE_CAVEAT : '';
    if (origin && isOverseasState(origin.state)) {
      return {
        mode: 'quote',
        quoteReason: 'ocean',
        dist: null,
        lines: [],
        included: [],
        notIncluded: ['Ocean shipping is not modeled, so no drive price is shown.'].concat(staticNotIncluded()),
        subtotals: { moving: null, fees: null },
        total: null,
        inFL: false,
        headline: 'Get a quote',
        vehicleCaveat
      };
    }

    let dest = A.dest || null;
    let dist = null;
    let destSpread = null;
    if (origin && !dest && D.areas && D.areas.length) {
      const factor = D.distance.factor;
      let minR = null, maxR = null, lat = 0, lon = 0;
      D.areas.forEach(area => {
        const road = roadBetween(origin, area, factor);
        if (!road) return;
        if (!minR || road.road < minR.road) minR = { road: road.road, name: area.name };
        if (!maxR || road.road > maxR.road) maxR = { road: road.road, name: area.name };
        lat += area.lat;
        lon += area.lon;
      });
      const centroid = { lat: lat / D.areas.length, lon: lon / D.areas.length, name: 'the listed Gulf Coast areas' };
      dist = roadBetween(origin, centroid, factor);
      if (dist && minR && maxR) {
        let typRoad = dist.road;
        if (typRoad < minR.road) typRoad = minR.road;
        if (typRoad > maxR.road) typRoad = maxR.road;
        destSpread = { minRoad: minR.road, maxRoad: maxR.road, typRoad, minName: minR.name, maxName: maxR.name, centroidRoad: dist.road };
      }
    } else {
      dist = roadBetween(origin, dest, D.distance.factor);
    }

    const lines = [];
    let coreOk = false;
    const roadOf = which => {
      if (!dist) return 0;
      if (!destSpread) return dist.road;
      if (which === 'lo') return destSpread.minRoad;
      if (which === 'hi') return destSpread.maxRoad;
      return destSpread.typRoad;
    };

    if (!dist) {
      const why = !origin
        ? 'Choose a starting state so the distance can be priced.'
        : origin.lat == null
          ? 'The starting point has no coordinates, so the distance cannot be priced.'
          : 'Destination was not specific enough to price the move.';
      lines.push(line({
        id: 'moving',
        label: 'Moving the belongings',
        display: 'not-included',
        note: why,
        sources: [source({ source: 'A mileage band needs both places', url: null, asOf: checkedDate(D), status: 'UNSOURCED' })]
      }));
    } else if (destSpread) {
      const loCore = priceCore(D, A, destSpread.minRoad);
      const typCore = priceCore(D, A, destSpread.typRoad);
      const hiCore = priceCore(D, A, destSpread.maxRoad);
      const stitched = order3({ lo: loCore.line.lo, typ: typCore.line.typ, hi: hiCore.line.hi });
      const caveat = `Destination was not chosen. Typical uses the average point of the listed Gulf Coast areas (${Math.round(destSpread.centroidRoad).toLocaleString('en-US')} estimated road miles). Low uses the closest listed area (${destSpread.minName}) and high uses the farthest (${destSpread.maxName}).`;
      lines.push(line(Object.assign({}, typCore.line, stitched, {
        note: `${caveat} ${typCore.line.note || ''}`.trim()
      })));
      coreOk = true;
    } else {
      const core = priceCore(D, A, dist.road);
      if (origin && origin.state === 'Alaska') {
        core.line.note = `Alaska is priced on the long-distance road bands with the same 1.14 factor. A separate Alaska Highway route through Canada was not returned when this factor was measured. ${core.line.note || ''}`.trim();
      }
      lines.push(core.line);
      coreOk = core.ok && core.line.display === 'money';
    }

    const gas = gasBlend(D, origin && origin.state);
    const mpg = D.assumptions.carMpg;
    const truckMpg = D.assumptions.truckMpg.value;
    if (A.help === 'DIY rental truck' && coreOk) {
      const cost = which => fuelAt(roadOf(which), truckMpg, gas[which]);
      const same = gas.same ? `Regular gasoline is $${gas.typ}/gal for the whole drive.` : `Low uses the lower of the origin-state price ($${gas.origin}/gal) and Florida ($${D.gas.states.Florida}/gal). High uses the higher. Typical uses the average.`;
      lines.push(moneyLine({
        id: 'truckFuel',
        label: 'Fuel for the rental truck',
        lo: cost('lo'), typ: cost('typ'), hi: cost('hi'),
        note: `10 mpg on every column, from the GoodMigrations truck example. ${same}`,
        sources: [source(D.assumptions.truckMpg), source(D.gas)]
      }));
    }

    const driveCars = A.vehHow === 'Drive them' && vehicles > 0 && dist && A.travel && A.travel !== 'Not sure';
    const diy = A.help === 'DIY rental truck';
    const flying = A.travel === 'Flying';
    const oneDriver = String(A.adults) === '1';
    const towInstead = !!(driveCars && diy && oneDriver);
    const suppressCarFuel = !!(driveCars && diy && flying);
    if (towInstead) {
      const mpd = D.assumptions.milesPerDay;
      const rate = D.tow.daily;
      const days = {
        lo: travelDays(roadOf('lo'), mpd.lowCost),
        typ: travelDays(roadOf('typ'), mpd.typical),
        hi: travelDays(roadOf('hi'), mpd.highCost)
      };
      lines.push(moneyLine({
        id: 'tow',
        label: 'Tow dolly',
        lo: days.lo * rate, typ: days.typ * rate, hi: days.hi * rate,
        note: `One adult cannot drive the rental truck and a car on the same day. One tow dolly is priced at U-Haul's local daily rate of $${rate} times ${days.lo} / ${days.typ} / ${days.hi} travel days. A published one-way national price was not used. One truck tows one dolly; extra vehicles are not given a second dolly price.`,
        sources: [source(D.tow), source(mpd)]
      }));
      lines.push(Object.assign(chosen(D, 'Fuel for a driven car', 'The car is towed, so separate car fuel is not priced.'), { id: 'carFuel' }));
    } else if (suppressCarFuel) {
      lines.push(Object.assign(chosen(D, 'Fuel for a driven car', 'A flying trip with a rental truck does not add car fuel. Driving the cars as well would need lodging, and lodging is not added when the truck driver is flying.'), { id: 'carFuel' }));
    } else if (driveCars) {
      const cost = (which, perGallon) => fuelAt(roadOf(which), perGallon, gas[which]);
      const gasNote = gas.same ? `Regular is $${gas.typ}/gal.` : `Gasoline uses the lower, the average, and the higher of the origin state ($${gas.origin}/gal) and Florida ($${D.gas.states.Florida}/gal).`;
      lines.push(moneyLine({
        id: 'carFuel',
        label: `Fuel for ${vehicles} driven ${vehicles === 1 ? 'car' : 'cars'}`,
        lo: cost('lo', mpg.lowCost) * vehicles,
        typ: cost('typ', mpg.typical) * vehicles,
        hi: cost('hi', mpg.highCost) * vehicles,
        note: `Low cost uses ${mpg.lowCost} mpg, typical ${mpg.typical}, high cost ${mpg.highCost}. Those mpg figures are assumptions, not EPA ratings. ${gasNote}`,
        sources: [source(D.gas), source(mpg)]
      }));
    } else if (A.veh === '0' || A.vehHow === 'Ship them') {
      lines.push(Object.assign(chosen(D, 'Fuel for a driven car', A.veh === '0' ? 'No vehicle is being brought.' : 'The vehicles are being shipped, so drive fuel is not priced.'), { id: 'carFuel' }));
    } else {
      lines.push(Object.assign(missing('Fuel for a driven car', 'moving', D.assumptions.carMpg, 'Drive fuel is not priced until you choose to drive a known number of vehicles. A Not sure answer is not treated as a drive.'), { id: 'carFuel' }));
    }

    if (A.veh === '0') lines.push(Object.assign(chosen(D, 'Vehicle shipping', 'No vehicle is being brought.'), { id: 'ship' }));
    else if (A.vehHow === 'Drive them') lines.push(Object.assign(chosen(D, 'Vehicle shipping', 'You chose to drive the vehicles, so shipping is not included.'), { id: 'ship' }));
    else if (A.vehHow === 'Ship them' && vehicles > 0 && dist) {
      const each = which => applyShipOptions(D, shipOpen(D, roadOf(which)), A);
      const priced = order3({ lo: each('lo').lo * vehicles, typ: each('typ').typ * vehicles, hi: each('hi').hi * vehicles });
      const snow = snowSentence(D, A.when, origin);
      const body = A.shipBody === 'SUV' ? ' SUV adder is the published $100–$200, with the midpoint on typical.' : ' Open-carrier sedan.';
      const carrier = A.shipCarrier === 'Enclosed' ? ' Enclosed is 1.5 times the open price.' : '';
      const curve = shipCurve(D);
      const sh = D.ship.shortHaul;
      const maxRoad = Math.max(roadOf('lo'), roadOf('typ'), roadOf('hi'));
      const minRoad = Math.min(roadOf('lo'), roadOf('typ'), roadOf('hi'));
      const shipSources = [source(D.ship), source({ source: 'Freightwaves Checkpoint, Maryland to Florida car shipping', url: D.ship.freightwavesUrl, asOf: '2026-10-18', checked: D.ship.checked, status: 'SOURCED' })];
      if (sh && minRoad < curve.floorM) shipSources.push(source(sh));
      if (maxRoad > curve.ceilM) shipSources.push(source(D.ship.longHaul));
      if (snow && D.ship.snowbird) shipSources.push(source(D.ship.snowbird));
      lines.push(moneyLine({
        id: 'ship',
        label: `Vehicle shipping × ${vehicles}`,
        lo: priced.lo, typ: priced.typ, hi: priced.hi,
        note: `Open-carrier sedan. Low and high do not fall as miles rise. At ${sh.miles} miles and under, the price is RoadRunner's under-500 open band, $${sh.lo.toLocaleString('en-US')}–$${sh.hi.toLocaleString('en-US')}. Typical $${sh.typ.toLocaleString('en-US')} is the midpoint of that band, not a separate published typical. From there it rises in a straight line to the ${curve.floorM}-mile price. Low through ${curve.ceilM.toLocaleString('en-US')} miles is a smoothed fit of the published city-pair lows (pool-adjacent-violators, equal weight on each pair): ${curve.lowFitText}. High follows those city pairs and does not fall. Past that, the price moves to RoadRunner's 2,000-mile-and-over open band ($${D.ship.longHaul.lo.toLocaleString('en-US')}–$${D.ship.longHaul.hi.toLocaleString('en-US')}) and the $${D.ship.longHaul.typ.toLocaleString('en-US')} national average, then holds. Freightwaves $${D.ship.freightwaves.lo}–$${D.ship.freightwaves.hi} is applied only inside the city-pair span. Typical inside that span follows the $${D.ship.corridor.average} corridor average over ${D.ship.corridor.miles} miles. 7 or more vehicles are priced as 7.${body}${carrier}${snow}`,
        sources: shipSources
      }));
    } else {
      lines.push(Object.assign(missing('Vehicle shipping', 'moving', D.unsourced.ship, vehicles == null ? 'The vehicle count or the shipping choice is not set, so shipping is not priced and is not shown as $0.' : 'Shipping needs a distance, so it is not shown as $0.'), { id: 'ship' }));
    }

    const someoneDriving = driveCars && !(diy && flying);
    const truckOnRoad = diy && A.travel && A.travel !== 'Not sure' && A.travel !== 'Flying';
    const wantRoadLife = !!(dist && (A.travel === 'Driving' || someoneDriving || truckOnRoad));
    if (wantRoadLife) {
      const mpd = D.assumptions.milesPerDay;
      const adults = adultSpread(A, D);
      const miles3 = { lo: roadOf('lo'), typ: roadOf('typ'), hi: roadOf('hi') };
      const nLo = nightsFor(miles3.lo, mpd.lowCost);
      const nTyp = nightsFor(miles3.typ, mpd.typical);
      const nHi = nightsFor(miles3.hi, mpd.highCost);
      const rooms = {
        lo: Math.ceil(adults.lo / 2),
        typ: Math.ceil(adults.typ / 2),
        hi: Math.ceil(adults.hi / 2)
      };
      const rate = D.lodging.value;
      const knownTax = taxRate(D, dest);
      const tax = {
        lo: knownTax == null ? 0.12 : knownTax,
        typ: knownTax == null ? 0.13 : knownTax,
        hi: knownTax == null ? 0.13 : knownTax
      };
      const meal = D.meals.value;
      const who = adults.clamped ? 'Adult count was below 1, so 1 adult is used.' : (adults.assumed ? 'Adults were not chosen: low uses 1, typical 2, and high 4.' : `${adults.typ} adult${adults.typ === 1 ? '' : 's'}.`);
      const why = someoneDriving && flying ? ' Lodging is included because a car is being driven, even though the other travelers fly.' : (truckOnRoad && A.travel !== 'Driving' ? ' Lodging is included because someone drives the rental truck.' : '');
      const taxNote = knownTax == null ? 'Hotel tax uses 12% on low and 13% on typical and high, covering the listed counties.' : `Hotel tax of ${Math.round(knownTax * 100)}% is added for ${dest.county} County.`;
      lines.push(moneyLine({
        id: 'lodging',
        label: 'Lodging on the road',
        lo: nLo * rate * (1 + tax.lo) * rooms.lo,
        typ: nTyp * rate * (1 + tax.typ) * rooms.typ,
        hi: nHi * rate * (1 + tax.hi) * rooms.hi,
        note: `${who} Nights are ${nLo} / ${nTyp} / ${nHi} at ${mpd.lowCost} / ${mpd.typical} / ${mpd.highCost} miles a day (an assumption). Rooms are one per two adults: ${rooms.lo} / ${rooms.typ} / ${rooms.hi}. The $${rate} rate is the FY2027 standard lodging cap. ${taxNote}${why}`,
        sources: [source(D.lodging), source(D.lodgingTax), source(mpd), source(D.assumptions.rooms)].concat(adults.assumed ? [source(D.assumptions.adultsUnsure)] : [])
      }));
      lines.push(moneyLine({
        id: 'meals',
        label: 'Meals on the road',
        lo: mealDays(nLo) * meal * adults.lo,
        typ: mealDays(nTyp) * meal * adults.typ,
        hi: mealDays(nHi) * meal * adults.hi,
        note: `${who} A drive that fits in one day, at that column's miles-per-day pace, does not add M&IE. A trip with nights uses 75% on the first and last day and 100% on the days between, which is nights + 0.5. The $${meal} rate is the FY2027 standard M&IE.`,
        sources: [source(D.meals), source(mpd)].concat(adults.assumed ? [source(D.assumptions.adultsUnsure)] : [])
      }));
    } else if (flying) {
      lines.push(line({
        id: 'lodging', label: 'Lodging on the road', display: 'not-applicable', group: 'moving',
        note: 'Not applicable when everyone is flying and nobody is driving a car or a rental truck.',
        sources: [source(D.lodging, 'Not applicable on a flying trip with no one driving.')]
      }));
      lines.push(line({
        id: 'meals', label: 'Meals on the road', display: 'not-applicable', group: 'moving',
        note: 'Not applicable when lodging is not applicable.',
        sources: [source(D.meals, 'Not applicable on a flying trip with no one driving.')]
      }));
    } else {
      lines.push(Object.assign(missing('Lodging on the road', 'moving', D.lodging, 'Lodging is priced when you drive, when a car is driven, or when a DIY truck is driven. Not sure is not treated as a drive. A flying trip with a DIY truck does not add the truck driver\'s lodging.'), { id: 'lodging' }));
      lines.push(Object.assign(missing('Meals on the road', 'moving', D.meals, 'Meals are priced only when lodging is. Not sure is not treated as a drive.'), { id: 'meals' }));
    }

    if (A.travel === 'Driving') lines.push(Object.assign(chosen(D, 'Airfare', 'You chose to drive, so airfare is not included.'), { id: 'airfare' }));
    else if (flying && origin && origin.state === 'Florida') {
      lines.push(line({
        id: 'airfare',
        label: 'Airfare',
        display: 'not-applicable',
        group: 'moving',
        note: 'Not priced. The trip starts in Florida, and driving is typical.',
        sources: [source(D.airfare, 'In-Florida origins are not given an airfare.')]
      }));
    } else if (flying && (!origin || origin.lat == null)) {
      lines.push(Object.assign(missing('Airfare', 'moving', D.airfare, 'The starting point has no coordinates, so a departure airport cannot be chosen and airfare is not priced.'), { id: 'airfare' }));
    } else if (flying) {
      const picked = pickAirfare(D, origin);
      const chosenAdults = A.adults && A.adults !== 'Not sure' ? countOf(A.adults, 12) : null;
      const licenses = countOf(A.licenses, 4);
      let adults;
      let who;
      if (chosenAdults != null) {
        adults = Math.max(1, chosenAdults);
        who = `${adults} adult${adults === 1 ? '' : 's'} chosen on this trip.`;
      } else if (licenses != null && licenses >= 1) {
        adults = licenses;
        who = `Adults were not asked on a flying trip. The price uses the ${licenses} new Florida license${licenses === 1 ? '' : 's'}.`;
      } else {
        adults = 1;
        who = 'Adults were not asked on a flying trip. The price uses 1 adult.';
      }
      if (!picked) {
        lines.push(Object.assign(missing('Airfare', 'moving', D.airfare, 'No Table 1a airport could be matched to this starting point, so airfare is not priced.'), { id: 'airfare' }));
      } else {
        const src = source(D.airfare);
        if (picked.estimate) src.status = 'ESTIMATE';
        lines.push(moneyLine({
          id: 'airfare',
          label: `Airfare × ${adults}`,
          lo: picked.lo * adults,
          typ: picked.typ * adults,
          hi: picked.hi * adults,
          note: `${picked.note} ${who} Not a quoted fare.`,
          sources: [src]
        }));
      }
    } else lines.push(Object.assign(missing('Airfare', 'moving', D.unsourced.airfare, 'Airfare is priced only when you choose Flying. Not sure is not treated as a flight.'), { id: 'airfare' }));

    const built = specsFor(A.type, A.size);
    const packRef = built.ref || built.specs[0];
    if (A.packing === 'None') {
      lines.push(Object.assign(chosen(D, 'Packing', 'No packing service selected.'), { id: 'packing' }));
    } else if (A.packing === 'Partial' || A.packing === 'Full' || A.packing === 'Not sure') {
      const triples = built.specs.map(spec => packingTriple(D, packKey(spec), 'partial'));
      const fulls = built.specs.map(spec => packingTriple(D, packKey(spec), 'full'));
      const refPack = packingTriple(D, packKey(packRef), 'partial');
      const refFull = packingTriple(D, packKey(packRef), 'full');
      let labor, materials, note;
      if (A.packing === 'Partial') {
        labor = combineParts(triples.map(t => t.labor), refPack.labor.typ);
        materials = combineParts(triples.map(t => t.materials), refPack.materials.typ);
        note = 'Partial packing labor. Typical is the midpoint of the published ends. Studio and 1-bedroom share Element\'s combined row. A 50% materials discount is not applied.';
      } else if (A.packing === 'Full') {
        labor = combineParts(fulls.map(t => t.labor), refFull.labor.typ);
        materials = combineParts(fulls.map(t => t.materials), refFull.materials.typ);
        note = 'Full packing labor. Typical is the midpoint of the published ends. The 2-bedroom low is moveBuddha\'s $520 and the high is Element\'s $1,400.';
      } else {
        labor = order3({
          lo: Math.min(refPack.labor.lo, refFull.labor.lo),
          typ: (refPack.labor.typ + refFull.labor.typ) / 2,
          hi: Math.max(refPack.labor.hi, refFull.labor.hi)
        });
        materials = refPack.materials;
        note = 'Packing level was not chosen. Low is partial labor, typical is the midpoint of partial and full, and high is full labor.';
      }
      lines.push(moneyLine({
        id: 'packing',
        label: A.packing === 'Not sure' ? 'Packing labor' : `Packing labor: ${A.packing}`,
        lo: labor.lo, typ: labor.typ, hi: labor.hi,
        note,
        sources: [source(D.packing)]
      }));
      lines.push(moneyLine({
        id: 'materials',
        label: 'Packing materials',
        lo: materials.lo, typ: materials.typ, hi: materials.hi,
        note: A.packing === 'Partial'
          ? 'No partial-packing materials price is published, so this line uses the full-pack materials range for this home size.'
          : 'Materials use the published full-pack range for this home size.',
        sources: [source(D.packing)]
      }));
    } else {
      lines.push(Object.assign(missing('Packing', 'moving', D.unsourced.packing, 'Packing is priced when you choose None, Partial, Full, or Not sure.'), { id: 'packing' }));
    }

    function addOn(id, label, yes, data, offNote) {
      if (yes === 'Yes') {
        lines.push(moneyLine({
          id, label,
          lo: data.lo, typ: data.typ, hi: data.hi,
          note: data.measured || data.caveat || '',
          sources: [source(data)]
        }));
      } else {
        lines.push(Object.assign(chosen(D, label, offNote), { id }));
      }
    }
    addOn('stairs', 'Stairs or elevator', A.stairs, D.access.stairs, 'No stair or elevator carry selected.');
    addOn('longCarry', 'Long carry', A.longCarry, D.access.longCarry, 'No long carry selected.');
    addOn('shuttle', 'Shuttle', A.shuttle, D.access.shuttle, 'No shuttle selected.');

    if (A.valuation === 'Yes') {
      const v = D.valuation;
      lines.push(moneyLine({
        id: 'valuation',
        label: 'Full-value protection',
        lo: v.lo, typ: (v.lo + v.hi) / 2, hi: v.hi,
        note: `Optional upgrade. Coastal publishes $${v.lo}–$${v.hi}+. Typical is the midpoint, $300. moveBuddha also states full-value protection at 1%–2% of declared value; no declared value by home size was published, so that percent is not turned into a second dollar line. Released value at 60¢ per pound is included at no charge.`,
        sources: [source(v)]
      }));
    } else {
      lines.push(line({
        id: 'valuation',
        label: 'Full-value protection',
        display: 'not-included',
        note: 'Not selected. Released value at 60¢ per pound is included at no charge. The optional upgrade is not in this total.',
        sources: [source(D.valuation)]
      }));
    }

    const months = countOf(A.storageMonths, 24);
    if (A.storage === 'No') lines.push(Object.assign(chosen(D, 'Temporary storage', 'No storage selected.'), { id: 'storage' }));
    else if (A.storage === 'Yes') {
      const used = months == null ? 1 : months;
      const mid = (D.storage.lo + D.storage.hi) / 2;
      lines.push(moneyLine({
        id: 'storage',
        label: `Temporary storage × ${used} month${used === 1 ? '' : 's'}`,
        lo: D.storage.lo * used,
        typ: mid * used,
        hi: D.storage.hi * used,
        note: `moveBuddha storage-in-transit is $${D.storage.lo}–$${D.storage.hi} per month. Typical is the midpoint, $${mid}. ${months == null ? 'Months were not chosen, so 1 month is used.' : ''}`,
        sources: [source(D.storage)]
      }));
    } else lines.push(Object.assign(missing('Temporary storage', 'moving', D.unsourced.storage, 'Storage is priced per month when you choose it and a month count. Not sure does not assume storage.'), { id: 'storage' }));

    const inFL = !!(origin && origin.state === 'Florida');
    const outOfState = !!(origin && origin.state && !inFL);
    if (!origin || !origin.state) {
      lines.push(Object.assign(missing('Florida new-resident vehicle fees', 'fees', D.fl.initReg, 'Registration, title, and plate fees are added only when a non-Florida origin and a vehicle count are both known.'), { id: 'fees' }));
      lines.push(Object.assign(missing("Florida driver's license", 'fees', D.fl.dl, "The license fee is added only for a known number of people moving from outside Florida."), { id: 'dl' }));
    } else if (inFL) {
      lines.push(line({
        id: 'fees', label: 'Florida new-resident vehicle fees', display: 'not-applicable', group: 'fees',
        note: 'Not charged because the move starts in Florida.',
        sources: [source(D.fl.initReg, 'Not applicable to a move that starts in Florida.')]
      }));
      lines.push(line({
        id: 'dl', label: "Florida driver's license", display: 'not-applicable', group: 'fees',
        note: 'Not charged because the move starts in Florida.',
        sources: [source(D.fl.dl, 'Not applicable to a move that starts in Florida.')]
      }));
    } else if (outOfState) {
      if (vehicles > 0) {
        const fixed = D.fl.initReg.value + D.fl.title.value + D.fl.plate.value;
        const tax = D.fl.regTax;
        lines.push(moneyLine({
          id: 'fees',
          label: `Florida registration, title, and plate × ${vehicles}`,
          group: 'fees',
          lo: vehicles * (fixed + tax.low),
          typ: vehicles * (fixed + tax.typical),
          hi: vehicles * (fixed + tax.high),
          note: `Each vehicle: $${D.fl.initReg.value} initial registration + $${D.fl.title.value.toFixed(2)} electronic title + $${D.fl.plate.value} plate, plus weight tax $${tax.low.toFixed(2)} / $${tax.typical.toFixed(2)} / $${tax.high.toFixed(2)}. ${tax.caveat}`,
          sources: [source(D.fl.initReg), source(D.fl.title), source(D.fl.plate), source(tax)]
        }));
      } else if (A.veh === '0') {
        lines.push(Object.assign(chosen(D, 'Florida new-resident vehicle fees', 'No vehicle is being registered.'), { id: 'fees', group: 'fees' }));
      } else {
        lines.push(Object.assign(missing('Florida new-resident vehicle fees', 'fees', D.fl.initReg, 'The vehicle count was not chosen, so these fees are not priced and are not assumed to be 3.'), { id: 'fees' }));
      }
      const licenses = countOf(A.licenses, 4);
      if (licenses > 0) {
        const fee = D.fl.dl;
        lines.push(moneyLine({
          id: 'dl',
          label: `Florida driver's license × ${licenses}`,
          group: 'fees',
          lo: licenses * fee.value,
          typ: licenses * fee.value,
          hi: licenses * (fee.value + fee.serviceFee),
          note: `Original Class E license $${fee.value}. High includes a possible $${fee.serviceFee.toFixed(2)} tax collector service fee.`,
          sources: [source(fee)]
        }));
      } else if (A.licenses === '0') {
        lines.push(Object.assign(chosen(D, "Florida driver's license", 'No new Florida license selected.'), { id: 'dl', group: 'fees' }));
      } else {
        lines.push(Object.assign(missing("Florida driver's license", 'fees', D.fl.dl, 'The number of new licenses was not chosen, so this fee is not guessed.'), { id: 'dl' }));
      }
    }

    lines.forEach(roundLine);
    const movingSub = sumCents(lines, 'moving');
    const feeSub = sumCents(lines, 'fees');
    const mode = coreOk ? 'estimate' : 'insufficient';
    const total = mode === 'estimate' ? sumCents(lines) : null;
    const included = lines.filter(l => l.display === 'money').map(l => l.label);
    const notIncluded = lines.filter(l => l.display === 'not-included').map(l => l.label).concat(staticNotIncluded());
    return {
      mode,
      quoteReason: '',
      dist,
      destSpread,
      lines,
      included,
      notIncluded,
      subtotals: { moving: mode === 'estimate' ? movingSub : null, fees: feeSub },
      total,
      inFL,
      headline: mode === 'estimate' ? 'Your moving cost estimate' : 'Not enough info to estimate',
      vehicleCaveat
    };
  }

  return {
    estimateMove,
    classifyZip,
    roadBetween,
    formatMoney,
    isOverseasState,
    priceCore
  };
});
