(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CostEstimate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var STATE_NAME = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
    LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
    NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
    OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
  };

  function round10(n) {
    if (n == null || Number.isNaN(n)) return null;
    return Math.sign(n) * Math.round(Math.abs(n) / 10) * 10;
  }

  function num(value) {
    if (value == null || value === '') return null;
    var n = typeof value === 'number' ? value : Number(String(value).replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function formatRate(rate) {
    var percent = Math.round(Number(rate) * 100000) / 1000;
    return percent.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%';
  }

  function asOfLabel(asOf) {
    var full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf || '');
    if (full) return MONTHS[Number(full[2]) - 1] + ' ' + Number(full[3]) + ', ' + full[1];
    var month = /^(\d{4})-(\d{2})$/.exec(asOf || '');
    if (month) return MONTHS[Number(month[2]) - 1] + ' ' + month[1];
    return asOf || '';
  }

  function rateRecord(record) {
    if (!record) return null;
    if (record.kind === 'none' || record.kind === 'flat' || record.kind === 'graduated') return record;
    if (record.none) return { kind: 'none' };
    var brackets = record.brackets && record.brackets.single;
    if (!brackets || !brackets.length) return { kind: 'none' };
    var rates = brackets.map(function (row) { return row.rate; });
    var min = Math.min.apply(null, rates);
    var max = Math.max.apply(null, rates);
    if (Math.abs(max - min) < 1e-9) return { kind: 'flat', rate: min };
    return { kind: 'graduated', min: min, max: max };
  }

  function incomeTaxNote(stateCode, table, meta) {
    var name = STATE_NAME[stateCode];
    var record = rateRecord(table && table[stateCode]);
    var note = {
      asOf: (meta && meta.asOf) || '',
      asOfLabel: asOfLabel(meta && meta.asOf),
      source: (meta && meta.source) || ''
    };
    if (!name || !record) {
      note.text = 'A state income tax rate is not available for this location.';
      return note;
    }
    if (record.kind === 'none') {
      note.text = 'In ' + name + ', there is no state tax on wage income, and Florida has no state income tax.';
      return note;
    }
    var rateText = record.kind === 'flat'
      ? formatRate(record.rate)
      : formatRate(record.min) + ' to ' + formatRate(record.max);
    note.text = 'On top of these savings, in ' + name + ' your state income tax is currently ' + rateText + ', and Florida has no state income tax.';
    return note;
  }

  function fuelMonthly(input, price) {
    var miles = input.miles == null ? 1000 : input.miles;
    var vehicles = input.vehicles == null ? 1 : input.vehicles;
    if (!(vehicles > 0) || price == null) return null;
    if (input.fuel === 'ev') {
      var per = input.miPerKwh == null ? 3.5 : input.miPerKwh;
      if (!(per > 0)) return null;
      return miles / per * price * vehicles;
    }
    var mpg = input.mpg == null ? 25 : input.mpg;
    if (!(mpg > 0)) return null;
    return miles / mpg * price * vehicles;
  }

  function usdaHousehold(size, usda) {
    if (!usda) return null;
    var key = String(Math.min(Math.max(size, 1), 6));
    var people = (usda.composition && usda.composition[key]) || [];
    var adjust = usda.adjustment && usda.adjustment[key];
    if (!people.length || adjust == null) return null;
    var sum = 0;
    var i;
    for (i = 0; i < people.length; i++) {
      var cost = usda.persons && usda.persons[people[i]];
      if (cost == null) return null;
      sum += cost;
    }
    return sum * adjust;
  }

  function groceryPair(input) {
    var originRpp = input.rppOriginGoods;
    var floridaRpp = input.rppFloridaGoods;
    if (!(originRpp > 0) || !(floridaRpp > 0)) return null;
    var entered = num(input.groceriesNow);
    if (entered != null) {
      return { origin: entered, florida: entered * floridaRpp / originRpp };
    }
    var base = usdaHousehold(input.hhSize, input.usda);
    if (base == null) return null;
    return { origin: base * originRpp / 100, florida: base * floridaRpp / 100 };
  }

  function salesTaxMonthly(income, rate, groceriesMonthly, grocery) {
    if (rate == null || income == null) return null;
    var base = income * 0.30;
    var food = (groceriesMonthly || 0) * 12;
    if (grocery === 'reduced') return null;
    var taxable = base;
    if (grocery === 'exempt') taxable = Math.max(0, base - food);
    return taxable * rate / 12;
  }

  function salesTaxMonthlyReduced(income, fullRate, foodRate, groceriesMonthly) {
    var base = income * 0.30;
    var food = Math.max(0, (groceriesMonthly || 0) * 12);
    var other = Math.max(0, base - food);
    return (other * fullRate + Math.min(food, base) * foodRate) / 12;
  }

  var TERRITORIES = { PR: true, GU: true, VI: true, AS: true, MP: true };

  function isTerritory(code) {
    return !!TERRITORIES[String(code || '')];
  }

  // School taxes get the first $25,000 only. The rest of the exemption applies above $50,000 and only to non-school taxes.
  function homesteadBases(price, fullExemption, schoolExemption, additionalStartsAt) {
    var schoolCut = schoolExemption == null ? 25000 : schoolExemption;
    var starts = additionalStartsAt == null ? 50000 : additionalStartsAt;
    var school = Math.max(0, price - schoolCut);
    var extraMax = Math.max(0, (fullExemption || 0) - schoolCut);
    var extra = price > starts ? Math.min(extraMax, price - starts) : 0;
    return { school: school, other: Math.max(0, price - schoolCut - extra) };
  }

  function propertySide(tenure, price, rateKind, rate, homestead, schoolMillage, schoolExemption, additionalStartsAt) {
    if (tenure === 'rent') return { monthly: 0, note: 'Included in rent' };
    if (price == null || rate == null) return null;
    var annual;
    if (rateKind === 'millage' && homestead && schoolMillage != null) {
      var bases = homesteadBases(price, homestead, schoolExemption, additionalStartsAt);
      annual = bases.school * schoolMillage / 1000 + bases.other * (rate - schoolMillage) / 1000;
    } else if (rateKind === 'millage') {
      annual = Math.max(0, price - (homestead || 0)) * rate / 1000;
    } else {
      annual = price * rate;
    }
    return { monthly: annual / 12, note: '' };
  }

  function floodPremium(factors, areaId) {
    var flood = factors && factors.florida && factors.florida.flood;
    if (!flood || flood.enabled !== true) return null;
    var table = flood.statistic === 'average' ? (flood.averages || flood.areas) : flood.medians;
    if (!table) return null;
    if (table[areaId] != null) return table[areaId];
    if ((areaId === 'venice' || areaId === 'north-port') && table.sarasota != null) return table.sarasota;
    return null;
  }

  function unavailableLine(id, label, sources) {
    return {
      id: id,
      label: label,
      origin: null,
      florida: null,
      difference: null,
      inTotal: false,
      text: 'Not available',
      originNote: '',
      floridaNote: '',
      sources: sources || []
    };
  }

  function utilitiesMonthly(parts) {
    var total = 0;
    var used = [];
    if (parts.electricity != null) { total += parts.electricity; used.push('Electricity'); }
    if (parts.gas != null) { total += parts.gas; used.push('Natural gas'); }
    if (parts.water != null) { total += parts.water; used.push('Water'); }
    if (!used.length) return null;
    return { monthly: total, label: used.join(' and ') };
  }

  function electricityBill(kwh, rate) {
    if (kwh == null || rate == null) return null;
    return kwh * rate;
  }

  function waterBill(stateAverage, nationalAverage, rppUtilities) {
    if (stateAverage != null) return stateAverage;
    if (nationalAverage != null && rppUtilities != null) return nationalAverage * rppUtilities / 100;
    return null;
  }

  function priceLevelSentence(floridaName, floridaIndex, originName, originIndex) {
    if (!(originIndex > 0) || floridaIndex == null || !floridaName || !originName) return '';
    var pct = Math.round(Math.abs(floridaIndex - originIndex) / originIndex * 100);
    if (pct === 0) return 'Living in ' + floridaName + ' costs about the same as ' + originName + '.';
    var word = floridaIndex > originIndex ? 'more' : 'less';
    return 'Living in ' + floridaName + ' costs about ' + pct + '% ' + word + ' than ' + originName + '.';
  }

  function moneyLine(id, label, origin, florida, extra) {
    if (origin == null || florida == null) return null;
    var originRounded = round10(origin);
    var floridaRounded = round10(florida);
    var row = {
      id: id,
      label: label,
      origin: originRounded,
      florida: floridaRounded,
      difference: floridaRounded - originRounded,
      inTotal: true,
      originNote: '',
      floridaNote: '',
      sources: []
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) { row[key] = extra[key]; });
    }
    return row;
  }

  function sourceOf(block) {
    if (!block || !block.source) return [];
    return [{ name: block.source, asOf: block.asOf || '' }];
  }

  function buildEstimate(input, factors) {
    var lines = [];
    var notes = [];
    var hh = Number(input.hhSize) || 0;
    var area = factors.florida && factors.florida.areas && factors.florida.areas[input.toArea];
    var originState = input.state || '';
    var groceries = groceryPair({
      hhSize: hh,
      groceriesNow: input.groceriesNow,
      rppOriginGoods: input.rppOriginGoods,
      rppFloridaGoods: input.rppFloridaGoods,
      usda: factors.usda
    });

    var taxNote = factors.incomeTax
      ? incomeTaxNote(originState, factors.incomeTax.states, factors.incomeTax)
      : null;

    if (input.drives) {
      var gasPrice = factors.gas && factors.gas.states;
      var originFuel = fuelMonthly(input, gasPrice && input.fuel !== 'ev' ? gasPrice[originState] : (factors.electricity && factors.electricity.states ? factors.electricity.states[originState] : null));
      var floridaFuelPrice = input.fuel === 'ev'
        ? (factors.electricity && factors.electricity.states ? factors.electricity.states.FL : null)
        : (gasPrice ? gasPrice.FL : null);
      var floridaFuel = fuelMonthly(input, floridaFuelPrice);
      var fuel = moneyLine('fuel', input.fuel === 'ev' ? 'Driving: electricity' : 'Driving: fuel', originFuel, floridaFuel, {
        sources: input.fuel === 'ev' ? sourceOf(factors.electricity) : sourceOf(factors.gas)
      });
      if (fuel) lines.push(fuel);
      var auto = factors.autoInsurance && factors.autoInsurance.states;
      var vehicles = input.vehicles == null ? 1 : input.vehicles;
      if (auto && auto[originState] != null && auto.FL != null && vehicles > 0) {
        var cars = moneyLine('auto', 'Driving: car insurance', auto[originState] / 12 * vehicles, auto.FL / 12 * vehicles, {
          sources: sourceOf(factors.autoInsurance)
        });
        if (cars) lines.push(cars);
      }
    }

    if (groceries) {
      var food = moneyLine('groceries', 'Groceries', groceries.origin, groceries.florida, { sources: sourceOf(factors.usda) });
      if (food) lines.push(food);
    }

    if (area && area.median != null) {
      lines.push({
        id: 'median-price',
        label: 'Median home sale price',
        origin: null,
        florida: round10(area.median),
        difference: null,
        inTotal: false,
        originNote: '',
        floridaNote: '',
        sources: sourceOf(factors.florida.medianPrice)
      });
    }

    var elec = factors.electricity || {};
    var gasOn = !!(factors.naturalGas && factors.naturalGas.enabled === true && factors.naturalGas.states);
    var kwhOrigin = input.kwhOrigin != null ? input.kwhOrigin : (elec.kwhMonth ? elec.kwhMonth[originState] : null);
    var rateOrigin = input.elecRateOrigin != null ? input.elecRateOrigin : (elec.states ? elec.states[originState] : null);
    var kwhFlorida = input.kwhFlorida != null ? input.kwhFlorida : (elec.kwhMonth ? elec.kwhMonth.FL : null);
    var rateFlorida = input.elecRateFlorida != null ? input.elecRateFlorida : (elec.states ? elec.states.FL : null);
    var gasOrigin = input.gasBillOrigin != null ? input.gasBillOrigin : (gasOn ? factors.naturalGas.states[originState] : null);
    var gasFlorida = input.gasBillFlorida != null ? input.gasBillFlorida : (gasOn ? factors.naturalGas.states.FL : null);
    var nationalWater = input.nationalWater != null ? input.nationalWater : (factors.water ? factors.water.national : null);
    var utilityOrigin = utilitiesMonthly({
      electricity: electricityBill(kwhOrigin, rateOrigin),
      gas: gasOrigin,
      water: waterBill(input.waterOrigin, nationalWater, input.rppOriginUtilities)
    });
    var utilityFlorida = utilitiesMonthly({
      electricity: electricityBill(kwhFlorida, rateFlorida),
      gas: gasFlorida,
      water: waterBill(input.waterFlorida, nationalWater, input.rppFloridaUtilities)
    });
    if (utilityOrigin && utilityFlorida && utilityOrigin.label === utilityFlorida.label) {
      var utilitySources = [];
      if (utilityOrigin.label.indexOf('Electricity') >= 0) utilitySources = utilitySources.concat(sourceOf(factors.electricity));
      if (utilityOrigin.label.indexOf('Natural gas') >= 0) utilitySources = utilitySources.concat(sourceOf(factors.naturalGas));
      if (utilityOrigin.label.indexOf('Water') >= 0) utilitySources = utilitySources.concat(sourceOf(factors.water));
      var utility = moneyLine('utilities', utilityOrigin.label, utilityOrigin.monthly, utilityFlorida.monthly, {
        sources: utilitySources
      });
      if (utility) lines.push(utility);
    }

    if (hh && factors.health && factors.health.states && factors.health.states[originState] && factors.health.states.FL) {
      var healthKey = hh === 1 ? 'single' : 'family';
      var health = moneyLine('health', 'Health insurance', factors.health.states[originState][healthKey] / 12, factors.health.states.FL[healthKey] / 12, {
        sources: sourceOf(factors.health)
      });
      if (health) lines.push(health);
    }

    if (input.ownNow && input.planFL) {
      var originCover = input.ownNow === 'own'
        ? (factors.homeInsurance && factors.homeInsurance.states ? factors.homeInsurance.states[originState] : null)
        : (factors.rentersInsurance && factors.rentersInsurance.states ? factors.rentersInsurance.states[originState] : null);
      var floridaCover = input.planFL === 'buy'
        ? (area ? area.homeowners : null)
        : (factors.rentersInsurance && factors.rentersInsurance.states ? factors.rentersInsurance.states.FL : null);
      var coverLabel = "Home or renter's insurance";
      var coverSources = input.planFL === 'buy' ? sourceOf(factors.florida.homeInsurance) : sourceOf(factors.rentersInsurance);
      if (input.ownNow === 'own') coverSources = sourceOf(factors.homeInsurance).concat(coverSources);
      else coverSources = sourceOf(factors.rentersInsurance).concat(coverSources);
      var cover = moneyLine('insurance', coverLabel, originCover == null ? null : originCover / 12, floridaCover == null ? null : floridaCover / 12, {
        originNote: input.ownNow === 'own' ? "Homeowner's average." : "Renter's average.",
        floridaNote: input.planFL === 'buy' ? "Homeowner's average." : "Renter's average.",
        sources: coverSources
      });
      if (cover) lines.push(cover);
    }

    var premium = input.flood ? (area && area.flood != null ? area.flood : floodPremium(factors, input.toArea)) : null;
    if (premium != null) {
      var flood = moneyLine('flood', 'Flood insurance', 0, premium / 12, {
        originNote: '',
        floridaNote: 'Flood coverage may be required by your lender depending on the property\'s flood zone.',
        sources: sourceOf(factors.florida.flood)
      });
      if (flood) lines.push(flood);
    }

    if (input.ownNow && input.planFL && area) {
      var budget = num(input.homeBudget);
      var floridaPrice = budget != null ? budget : area.median;
      var homestead = input.planFL === 'buy' && input.primary ? (factors.homestead && factors.homestead.value) || 0 : 0;
      var originValue = input.originMedianValue;
      var originRate = input.originEffRate;
      var county = input.countyFips || '';
      if (input.ownNow === 'own') {
        if (originValue == null && factors.originMedianPrice && factors.originMedianPrice.counties) originValue = factors.originMedianPrice.counties[county];
        if (originRate == null && factors.originPropertyTax && factors.originPropertyTax.counties) originRate = factors.originPropertyTax.counties[county];
      }
      var originProperty = propertySide(
        input.ownNow === 'own' ? 'own' : 'rent',
        originValue,
        'effective',
        originRate,
        0
      );
      var floridaProperty = propertySide(
        input.planFL === 'buy' ? 'own' : 'rent',
        floridaPrice,
        'millage',
        area.millage,
        homestead,
        homestead && area.schoolMillage != null ? area.schoolMillage : null,
        factors.homestead && factors.homestead.schoolValue,
        factors.homestead && factors.homestead.additionalStartsAt
      );
      if (originProperty && floridaProperty) {
        var propertySources = sourceOf(factors.florida.millage).concat(sourceOf(factors.florida.schoolMillage), sourceOf(factors.homestead), sourceOf(factors.florida.medianPrice));
        if (input.ownNow === 'own') propertySources = propertySources.concat(sourceOf(factors.originPropertyTax), sourceOf(factors.originMedianPrice));
        var property = moneyLine('property-tax', 'Property tax', originProperty.monthly, floridaProperty.monthly, {
          originNote: originProperty.note,
          floridaNote: floridaProperty.note,
          sources: propertySources
        });
        if (property) {
          lines.push(property);
          if (input.planFL === 'buy') notes.push('Moving within Florida? Portability can lower this.');
        }
      }
    }

    var hoaNow = num(input.hoaNow);
    var hoaFlorida = num(input.hoaFL);
    if (hoaNow != null || hoaFlorida != null) {
      var hoa = moneyLine('hoa', 'HOA/CDD', hoaNow || 0, hoaFlorida || 0, {
        floridaNote: 'The figure varies by community.',
        sources: []
      });
      if (hoa && (hoa.origin || hoa.florida)) lines.push(hoa);
    }

    if (input.rppOriginAll != null && input.rppFloridaAll != null) {
      lines.push({
        id: 'price-level',
        label: 'Overall price level',
        origin: input.rppOriginAll,
        florida: input.rppFloridaAll,
        difference: null,
        inTotal: false,
        index: true,
        originNote: '',
        floridaNote: '',
        sources: [{ name: 'U.S. Bureau of Economic Analysis, Regional Price Parities', asOf: '2024' }]
      });
    }

    var monthly = 0;
    lines.forEach(function (line) {
      if (line.inTotal && line.difference != null) monthly += line.difference;
    });
    var low = round10(monthly * 0.85);
    var high = round10(monthly * 1.15);
    if (low != null && high != null && low > high) {
      var swap = low;
      low = high;
      high = swap;
    }
    var sentence = priceLevelSentence(input.floridaName, input.rppFloridaAll, input.originName, input.rppOriginAll);
    return {
      lines: lines,
      sentence: sentence,
      incomeTaxNote: taxNote,
      notes: notes,
      total: {
        monthly: monthly,
        yearly: monthly * 12,
        low: low,
        high: high,
        label: 'Estimated monthly difference (ballpark).'
      }
    };
  }

  return {
    STATE_NAME: STATE_NAME,
    round10: round10,
    formatRate: formatRate,
    asOfLabel: asOfLabel,
    incomeTaxNote: incomeTaxNote,
    fuelMonthly: fuelMonthly,
    usdaHousehold: usdaHousehold,
    groceryPair: groceryPair,
    salesTaxMonthly: salesTaxMonthly,
    salesTaxMonthlyReduced: salesTaxMonthlyReduced,
    isTerritory: isTerritory,
    floodPremium: floodPremium,
    homesteadBases: homesteadBases,
    propertySide: propertySide,
    utilitiesMonthly: utilitiesMonthly,
    electricityBill: electricityBill,
    waterBill: waterBill,
    priceLevelSentence: priceLevelSentence,
    buildEstimate: buildEstimate
  };
});
