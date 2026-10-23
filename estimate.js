(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Estimator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const R = 3958.7613;
  const BED_SIZES = ['1 bedroom', '2 bedrooms', '3 bedrooms', '4 bedrooms', '5+ bedrooms'];

  function roadBetween(a, b, factor) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const gc = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    return { gc, road: gc * factor };
  }

  function isOverseasState(state) {
    return state === 'Alaska' || state === 'Hawaii';
  }

  function classifyZip(raw, zips) {
    const s = String(raw ?? '').trim();
    if (!s) return { ok: false, code: 'format', message: 'Enter a 5-digit US ZIP code.' };
    if (/[A-Za-z]/.test(s)) return { ok: false, code: 'international', message: "International moves aren't supported." };
    let zip = null;
    if (/^\d{5}$/.test(s)) zip = s;
    else if (/^\d{5}-\d{4}$/.test(s)) zip = s.slice(0, 5);
    else return { ok: false, code: 'format', message: 'Enter a 5-digit US ZIP code.' };
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
        notes.push('A 1-bedroom house is not its own HireAHelper row. The 1-bedroom apartment row is used, the same size class as the full-service Studio/1BR cell.');
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

  function cmrIndex(type, size) {
    const notes = [];
    if (type === 'Studio apartment' || size === '1 bedroom') return { i: 0, notes };
    if (size === '3 bedrooms') return { i: 2, notes };
    if (size === '4 bedrooms') return { i: 3, notes };
    if (size === '5+ bedrooms') {
      notes.push('5+ bedrooms uses the published 4+ bedroom cell.');
      return { i: 3, notes };
    }
    return { i: 1, notes };
  }

  function specsFor(type, size) {
    if (contradictory(type, size)) return { error: 'contradiction' };
    const typeUnsure = !type || type === 'Not sure';
    const sizeUnsure = !size || size === 'Not sure';
    const types = type === 'Studio apartment' ? ['Studio apartment'] : (typeUnsure ? ['Apartment', 'Single-story house'] : [type]);
    const sizes = type === 'Studio apartment' ? [sizeUnsure ? '1 bedroom' : size] : (sizeUnsure ? BED_SIZES : [size]);
    const specs = [];
    for (const t of types) {
      for (const s of sizes) {
        if (contradictory(t, s)) continue;
        specs.push({ type: t, size: s, hah: hahIndex(t, s), cmr: cmrIndex(t, s) });
      }
    }
    let ref = null;
    if (!typeUnsure && !sizeUnsure) ref = specs[0];
    else if (type === 'Studio apartment') ref = specs[0];
    else if (sizeUnsure && !typeUnsure) ref = specs.find(s => s.size === '2 bedrooms') || specs[0];
    else if (sizeUnsure && typeUnsure) ref = specs.find(s => s.type === 'Apartment' && s.size === '2 bedrooms') || specs[0];
    return { specs, ref, typeUnsure, sizeUnsure };
  }

  function cmrBand(road) {
    if (road < 500) return 0;
    if (road < 1000) return 1;
    if (road < 1500) return 2;
    if (road < 2000) return 3;
    return 4;
  }

  function cmrCell(D, road, sizeI) {
    const b = cmrBand(road);
    const mv = D.movers.value;
    const period = (b === 3 && sizeI === 3) ? 'Dec 2022-Sep 2026' : D.movers.asOf;
    return {
      lo: mv.low[b][sizeI],
      md: mv.median[b][sizeI],
      hi: mv.high[b][sizeI],
      band: mv.bands[b],
      size: mv.sizes[sizeI],
      sample: mv.sample[b][sizeI],
      period
    };
  }

  const VEHICLE_CAVEAT = 'It seems you have selected to transport seven or more vehicles. Please contact a relocation company directly for a better estimate.';

  function diyTypical(local, ld, road) {
    const capped = Math.min(Math.max(road, 0), 1200);
    return local + (ld - local) * (capped / 1200);
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

  function priceDiySpec(D, key, spec, road) {
    const idx = spec.hah.idx;
    const local = D.hah.value.local[key][idx];
    const ld = D.hah.value.ld1200[key][idx];
    const typ = diyTypical(local, ld, road);
    const a = D.assumptions.diyScale;
    const priced = capDiyToFull(
      { lo: typ * a.lowFactor, typ, hi: typ * a.highFactor, capped: false },
      priceFullSpec(D, spec, road)
    );
    return { lo: priced.lo, typ: priced.typ, hi: priced.hi, capped: priced.capped, row: D.hah.value.rows[idx] };
  }

  function priceFullSpec(D, spec, road) {
    const local = D.hah.value.local.full[spec.hah.idx];
    const spread = D.assumptions.fullLocal;
    const localLo = local * spread.lowFactor;
    const localHi = local * spread.highFactor;
    if (road < 50) {
      return { lo: localLo, typ: local, hi: localHi, method: 'local', row: D.hah.value.rows[spec.hah.idx] };
    }
    const cell = cmrCell(D, Math.max(road, 100), spec.cmr.i);
    if (road >= 100) {
      return { lo: cell.lo, typ: cell.md, hi: cell.hi, method: 'cmr', row: cell.size, cell };
    }
    const t = (road - 50) / 50;
    return {
      lo: localLo + (cell.lo - localLo) * t,
      typ: local + (cell.md - local) * t,
      hi: localHi + (cell.hi - localHi) * t,
      method: 'bridge',
      row: D.hah.value.rows[spec.hah.idx],
      cell
    };
  }

  function median(nums) {
    const s = nums.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function combineParts(parts, refTyp) {
    return {
      lo: Math.min(...parts.map(p => p.lo)),
      typ: refTyp == null ? median(parts.map(p => p.typ)) : refTyp,
      hi: Math.max(...parts.map(p => p.hi))
    };
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

  function sum3(lines, group) {
    const priced = lines.filter(l => l.display === 'money' && (!group || l.group === group));
    if (!priced.length) return null;
    return priced.reduce((acc, l) => ({
      lo: acc.lo + l.lo, typ: acc.typ + l.typ, hi: acc.hi + l.hi
    }), { lo: 0, typ: 0, hi: 0 });
  }

  function seasonNote(D, when) {
    if (!/^(June|July|August|September)\b/.test(when || '')) return '';
    const s = D.cmrSeason.value;
    return `Peak-season adjustment is not applied. CMR's 2-bedroom median was $${s.jul.toLocaleString('en-US')} in July and $${s.jan.toLocaleString('en-US')} in January.`;
  }

  function milesLabel(road) {
    return `${Math.round(road).toLocaleString('en-US')} estimated road miles`;
  }

  function coreForMode(D, mode, built, road) {
    const parts = built.specs.map(spec => {
      if (mode === 'full') return Object.assign(priceFullSpec(D, spec, road), { spec });
      return Object.assign(priceDiySpec(D, mode, spec, road), { spec });
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

  function priceCore(D, answers, road) {
    const built = specsFor(answers.type, answers.size);
    if (built.error) {
      return {
        ok: false,
        line: line({
          id: 'moving',
          label: 'Moving the belongings',
          display: 'not-included',
          note: 'A studio and 2 or more bedrooms contradict each other, so the mover price is not estimated.',
          sources: [source({ source: 'Not priced', asOf: '2026-10-22', status: 'UNSOURCED', url: null })]
        })
      };
    }
    const help = answers.help || 'Not sure';
    const gas = D.gas.value;
    const truckMpg = D.assumptions.truckMpg.value;
    const fuel = road / truckMpg * gas;
    const notes = envelopeNote(built);
    const season = seasonNote(D, answers.when);

    function methodNote(mode, parts) {
      const methods = new Set(parts.map(p => p.method));
      if (mode !== 'full') {
        const hit = parts.some(p => p.capped) ? ' The cap applies on this move.' : '';
        if (road > 1200) {
          return `Past 1,200 miles, the HireAHelper 1,200-mile price is held flat instead of rising with distance. At every distance, including this one, a DIY truck or container is capped so it does not exceed full-service for the same home. The flat stretch, the cap, and the 0.8 / 1.25 range are assumptions.${hit}`;
        }
        return `Scaled from HireAHelper's local price and its 1,200-mile price across ${milesLabel(road)}. At every distance, a DIY truck or container is capped so it does not exceed full-service for the same home. The scale, the cap, and the 0.8 / 1.25 range are assumptions.${hit}`;
      }
      const localNote = `Under 50 miles, priced from HireAHelper's local table. Typical is the published figure. Low and high use a 0.75 / 1.25 range, which is an assumption.`;
      if ([...methods].every(m => m === 'local')) return localNote;
      if (methods.has('bridge')) {
        return `This distance is between 50 and 100 miles. It is not priced from the under-50-mile table. The price is blended from that table at 50 miles to the CMR 100-499 mile band at 100 miles, so it does not jump at 100 miles. The blend is an assumption.`;
      }
      const cell = (parts.find(p => p.cell && p.cell.band) || {}).cell;
      if (!cell) return localNote;
      let text = `CMR ${cell.band.replace('-', '–')} miles, ${cell.size}. Estimated road distance ${Math.round(road).toLocaleString('en-US')} miles.`;
      if (cell.sample) text += ` CMR marked this cell: ${cell.sample}.`;
      if (cell.period && cell.period !== D.movers.asOf) text += ` This cell covers ${cell.period}.`;
      return text;
    }

    if (help === 'Not sure') {
      const modes = ['truck', 'container', 'full'];
      const priced = modes.map(mode => {
        const result = coreForMode(D, mode, built, road);
        if (mode === 'truck') {
          result.combined = {
            lo: result.combined.lo + fuel,
            typ: result.combined.typ + fuel,
            hi: result.combined.hi + fuel
          };
        }
        return result.combined;
      });
      const env = {
        lo: Math.min(...priced.map(p => p.lo)),
        typ: median(priced.map(p => p.typ)),
        hi: Math.max(...priced.map(p => p.hi))
      };
      notes.unshift('Help level was not chosen. This range covers a DIY truck (including truck fuel), a container, and full-service movers. Typical is the middle of those three typical prices. It is not the full-service price alone. The truck and container prices are capped so they do not exceed full-service for the same home.' + (road > 1200 ? ' Past 1,200 miles they are held at the 1,200-mile HireAHelper price before that cap.' : ''));
      if (season) notes.push(season);
      return {
        ok: true,
        line: line({
          id: 'moving',
          label: 'Moving the belongings',
          display: 'money',
          lo: env.lo, typ: env.typ, hi: env.hi,
          note: notes.join(' '),
          sources: [source(D.hah), source(D.movers), source(D.assumptions.diyScale), source(D.assumptions.fullBridge), source(D.gas), source(D.assumptions.truckMpg)]
        })
      };
    }

    const mode = help === 'DIY rental truck' ? 'truck' : help === 'Moving container' ? 'container' : 'full';
    const result = coreForMode(D, mode, built, road);
    if (mode !== 'full') {
      const full = coreForMode(D, 'full', built, road);
      const capped = capDiyToFull(result.combined, full.combined);
      if (capped.capped) result.parts.forEach(p => { p.capped = true; });
      result.combined.lo = capped.lo;
      result.combined.typ = capped.typ;
      result.combined.hi = capped.hi;
    }
    notes.push(methodNote(mode, result.parts));
    if (mode === 'full' && season) notes.push(season);
    const names = { truck: 'DIY rental truck', container: 'Moving container', full: 'Full-service movers' };
    const sources = [source(D.hah)];
    if (mode === 'full' && result.parts.some(p => p.method !== 'local')) {
      const moverSrc = source(D.movers);
      const cell = result.parts[0] && result.parts[0].cell;
      if (result.parts.length === 1 && cell && cell.period) moverSrc.asOf = cell.period;
      sources.push(moverSrc);
    }
    if (mode !== 'full') sources.push(source(D.assumptions.diyScale));
    if (mode === 'full' && result.parts.some(p => p.method === 'local' || p.method === 'bridge')) sources.push(source(D.assumptions.fullLocal));
    if (mode === 'full' && result.parts.some(p => p.method === 'bridge')) sources.push(source(D.assumptions.fullBridge));
    if (season) sources.push(source(D.cmrSeason));
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

  function chosen(label, note) {
    return line({
      label, display: 'not-selected', group: 'other', note,
      sources: [{ source: 'Not selected', url: null, asOf: '2026-10-22', checked: '2026-10-22', status: 'CHOSEN', caveat: '' }]
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
    const n = countOf(answers.adults, 4);
    if (n == null) return { lo: D.assumptions.adultsUnsure.low, typ: D.assumptions.adultsUnsure.typical, hi: D.assumptions.adultsUnsure.high, assumed: true };
    return { lo: n, typ: n, hi: n, assumed: false };
  }

  function nightsFor(miles, mpd) {
    return Math.max(0, Math.ceil(miles / mpd) - 1);
  }

  function mealDays(nights) {
    if (nights <= 0) return 0;
    return nights + 0.5;
  }

  function staticNotIncluded() {
    return [
      'Full-value protection',
      'Utility and rental deposits',
      'Closing costs',
      'Tips'
    ];
  }

  function estimateMove(answers, D) {
    const A = answers || {};
    const origin = A.origin || null;
    const dest = A.dest || null;
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
        notIncluded: ['Ocean and ferry shipping is not modeled, so no drive price is shown.'].concat(staticNotIncluded()),
        subtotals: { moving: null, fees: null },
        total: null,
        inFL: false,
        headline: 'Get a quote',
        vehicleCaveat
      };
    }
    const dist = roadBetween(origin, dest, D.distance.factor);
    const lines = [];
    let coreOk = false;
    if (!dist) {
      lines.push(line({
        id: 'moving',
        label: 'Moving the belongings',
        display: 'not-included',
        note: 'Origin or destination was not specific enough to price the move.',
        sources: [source({ source: 'A mileage band needs both places', url: null, asOf: '2026-10-22', status: 'UNSOURCED' })]
      }));
    } else {
      const core = priceCore(D, A, dist.road);
      lines.push(core.line);
      coreOk = core.ok && core.line.display === 'money';
      if (A.help === 'DIY rental truck' && core.ok) {
        const per = dist.road / D.assumptions.truckMpg.value * D.gas.value;
        lines.push(line({
          id: 'truckFuel',
          label: 'Fuel for the rental truck',
          display: 'money',
          lo: per, typ: per, hi: per,
          note: `About 10 mpg, same on low, typical, and high. ${milesLabel(dist.road)}. Florida regular gasoline is $${D.gas.value}/gal for the whole drive. Origin-state prices are not used.`,
          sources: [source(D.assumptions.truckMpg), source(D.gas)]
        }));
      }
    }

    const drivingCars = A.vehHow === 'Drive them' && vehicles > 0 && dist && A.travel && A.travel !== 'Not sure';
    if (drivingCars) {
      const mpg = D.assumptions.carMpg;
      const gas = D.gas.value;
      const cost = mpgKey => dist.road / mpgKey * gas * vehicles;
      lines.push(line({
        id: 'carFuel',
        label: `Fuel for ${vehicles} driven ${vehicles === 1 ? 'car' : 'cars'}`,
        display: 'money',
        lo: cost(mpg.lowCost), typ: cost(mpg.typical), hi: cost(mpg.highCost),
        note: `Low cost uses ${mpg.lowCost} mpg, typical ${mpg.typical}, high cost ${mpg.highCost}. Those mpg figures are assumptions, not EPA ratings. Florida regular is $${gas}/gal for the whole drive.`,
        sources: [source(D.gas), source(mpg)]
      }));
    } else if (A.veh === '0' || A.vehHow === 'Ship them') {
      lines.push(Object.assign(chosen('Fuel for a driven car', A.veh === '0' ? 'No vehicle is being brought.' : 'The vehicles are being shipped, so drive fuel is not priced.'), { id: 'carFuel' }));
    } else {
      lines.push(Object.assign(missing('Fuel for a driven car', 'moving', D.assumptions.carMpg, 'Drive fuel is not priced until you choose to drive a known number of vehicles. A Not sure answer is not treated as a drive.'), { id: 'carFuel' }));
    }

    if (A.veh === '0') lines.push(chosen('Vehicle shipping', 'No vehicle is being brought.'));
    else if (A.vehHow === 'Drive them') lines.push(chosen('Vehicle shipping', 'You chose to drive the vehicles, so shipping is not included.'));
    else lines.push(missing('Vehicle shipping', 'moving', D.unsourced.ship, vehicles == null ? 'The vehicle count or the shipping choice is not set, so shipping is not priced and is not shown as $0.' : 'Auto-transport prices are not sourced, so shipping is not shown as $0.'));

    const wantRoadLife = dist && (A.travel === 'Driving' || (A.help === 'DIY rental truck' && A.travel !== 'Not sure' && A.travel));
    const blockForUnsureTravel = !A.travel || A.travel === 'Not sure';
    if (wantRoadLife && !blockForUnsureTravel) {
      const mpd = D.assumptions.milesPerDay;
      const adults = adultSpread(A, D);
      const nLo = nightsFor(dist.road, mpd.lowCost);
      const nTyp = nightsFor(dist.road, mpd.typical);
      const nHi = nightsFor(dist.road, mpd.highCost);
      const rooms = {
        lo: 1,
        typ: Math.ceil(adults.typ / 2),
        hi: adults.hi
      };
      const rate = D.lodging.value;
      const meal = D.meals.value;
      const who = adults.assumed ? 'Adults were not chosen: low uses 1, typical 2, and high 4.' : `${adults.typ} adult${adults.typ === 1 ? '' : 's'}.`;
      const why = A.help === 'DIY rental truck' && A.travel !== 'Driving' ? ' Lodging is included because someone drives the rental truck.' : '';
      lines.push(line({
        id: 'lodging',
        label: 'Lodging on the road',
        display: 'money',
        lo: nLo * rate * rooms.lo,
        typ: nTyp * rate * rooms.typ,
        hi: nHi * rate * rooms.hi,
        note: `${who} Nights are ${nLo} / ${nTyp} / ${nHi} at ${mpd.lowCost} / ${mpd.typical} / ${mpd.highCost} miles a day (an assumption). Rooms are ${rooms.lo} / ${rooms.typ} / ${rooms.hi}. The $${rate} rate is the FY2027 standard lodging cap.${why}`,
        sources: [source(D.lodging), source(mpd), source(D.assumptions.rooms)].concat(adults.assumed ? [source(D.assumptions.adultsUnsure)] : [])
      }));
      lines.push(line({
        id: 'meals',
        label: 'Meals on the road',
        display: 'money',
        lo: mealDays(nLo) * meal * adults.lo,
        typ: mealDays(nTyp) * meal * adults.typ,
        hi: mealDays(nHi) * meal * adults.hi,
        note: `${who} A drive that fits in one day, at that column's miles-per-day pace, does not add M&IE. A trip with nights uses 75% on the first and last day and 100% on the days between, which is nights + 0.5. The $${meal} rate is the FY2027 standard M&IE.`,
        sources: [source(D.meals), source(mpd)].concat(adults.assumed ? [source(D.assumptions.adultsUnsure)] : [])
      }));
    } else {
      lines.push(Object.assign(missing('Lodging on the road', 'moving', D.lodging, 'Lodging is priced only when you choose to drive, or when a DIY truck is driven. Not sure is not treated as a drive.'), { id: 'lodging' }));
      lines.push(Object.assign(missing('Meals on the road', 'moving', D.meals, 'Meals are priced only when lodging is. Not sure is not treated as a drive.'), { id: 'meals' }));
    }

    if (A.travel === 'Driving') lines.push(chosen('Airfare', 'You chose to drive, so airfare is not included.'));
    else lines.push(missing('Airfare', 'moving', D.unsourced.airfare, 'Airfare is not sourced, so it is not shown as $0.'));

    if (A.packing === 'None') lines.push(chosen('Packing', 'No packing service selected.'));
    else lines.push(missing(A.packing && A.packing !== 'Not sure' ? `Packing: ${A.packing}` : 'Packing', 'moving', D.unsourced.packing, 'Packing prices are not sourced, so packing is not shown as $0.'));

    if (A.storage === 'No') lines.push(chosen('Temporary storage', 'No storage selected.'));
    else lines.push(missing('Temporary storage', 'moving', D.unsourced.storage, 'Storage prices are not sourced, so storage is not shown as $0.'));

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
        lines.push(line({
          id: 'fees',
          label: `Florida registration, title, and plate × ${vehicles}`,
          display: 'money',
          group: 'fees',
          lo: vehicles * (fixed + tax.low),
          typ: vehicles * (fixed + tax.typical),
          hi: vehicles * (fixed + tax.high),
          note: `Each vehicle: $${D.fl.initReg.value} initial registration + $${D.fl.title.value.toFixed(2)} electronic title + $${D.fl.plate.value} plate, plus weight tax $${tax.low.toFixed(2)} / $${tax.typical.toFixed(2)} / $${tax.high.toFixed(2)}. ${tax.caveat}`,
          sources: [source(D.fl.initReg), source(D.fl.title), source(D.fl.plate), source(tax)]
        }));
      } else if (A.veh === '0') {
        lines.push(Object.assign(chosen('Florida new-resident vehicle fees', 'No vehicle is being registered.'), { id: 'fees', group: 'fees' }));
      } else {
        lines.push(Object.assign(missing('Florida new-resident vehicle fees', 'fees', D.fl.initReg, 'The vehicle count was not chosen, so these fees are not priced and are not assumed to be 3.'), { id: 'fees' }));
      }
      const licenses = countOf(A.licenses, 4);
      if (licenses > 0) {
        const fee = D.fl.dl;
        lines.push(line({
          id: 'dl',
          label: `Florida driver's license × ${licenses}`,
          display: 'money',
          group: 'fees',
          lo: licenses * fee.value,
          typ: licenses * fee.value,
          hi: licenses * (fee.value + fee.serviceFee),
          note: `Original Class E license $${fee.value}. High includes a possible $${fee.serviceFee.toFixed(2)} tax collector service fee.`,
          sources: [source(fee)]
        }));
      } else if (A.licenses === '0') {
        lines.push(Object.assign(chosen("Florida driver's license", 'No new Florida license selected.'), { id: 'dl', group: 'fees' }));
      } else {
        lines.push(Object.assign(missing("Florida driver's license", 'fees', D.fl.dl, 'The number of new licenses was not chosen, so this fee is not guessed.'), { id: 'dl' }));
      }
    }

    const movingSub = sum3(lines, 'moving');
    const feeSub = sum3(lines, 'fees');
    const mode = coreOk ? 'estimate' : 'insufficient';
    const total = mode === 'estimate' ? sum3(lines) : null;
    const included = lines.filter(l => l.display === 'money').map(l => l.label);
    const notIncluded = lines.filter(l => l.display === 'not-included').map(l => l.label).concat(staticNotIncluded());
    return {
      mode,
      quoteReason: '',
      dist,
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
