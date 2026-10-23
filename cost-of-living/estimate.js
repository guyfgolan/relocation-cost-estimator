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

  function bandForIncome(income, bands) {
    var list = bands || [];
    var i;
    for (i = 0; i < list.length; i++) {
      var band = list[i];
      if (band.max == null || income < band.max) return band;
    }
    return list.length ? list[list.length - 1] : null;
  }

  function bandById(id, bands) {
    var list = bands || [];
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function filingStatus(adults) {
    return Number(adults) >= 2 ? 'married' : 'single';
  }

  function exemptionAmount(record, income, filing) {
    if (!record || record.none) return 0;
    var schedule = record.exemptionSchedule;
    var amount = 0;
    if (schedule && schedule.length) {
      var i;
      for (i = 0; i < schedule.length; i++) {
        var row = schedule[i];
        var fits = row.maxInclusive == null && row.maxExclusive == null
          || (row.maxInclusive != null && income <= row.maxInclusive)
          || (row.maxExclusive != null && income < row.maxExclusive);
        if (fits) {
          amount = row[filing] || 0;
          break;
        }
      }
    } else if (!record.personalExemptionIsCredit) {
      amount = (record.personalExemption && record.personalExemption[filing]) || 0;
    }
    var phase = record.exemptionPhaseout;
    if (phase && income > phase[filing]) amount = 0;
    return amount;
  }

  function marginalTax(taxable, brackets) {
    if (!(taxable > 0) || !brackets || !brackets.length) return 0;
    var rows = brackets.slice().sort(function (a, b) { return a.over - b.over; });
    var tax = 0;
    var i;
    for (i = 0; i < rows.length; i++) {
      var start = rows[i].over;
      var end = i + 1 < rows.length ? rows[i + 1].over : Infinity;
      if (taxable <= start) break;
      tax += (Math.min(taxable, end) - start) * rows[i].rate;
    }
    return tax;
  }

  // T = bracket tax on (income − standard deduction − filer exemption). Credits in the Tax Foundation deduction or exemption columns reduce the tax.
  function stateIncomeTax(stateCode, income, filing, table) {
    var record = table && table[stateCode];
    if (!record || record.none) return 0;
    var deduction = 0;
    if (!record.standardDeductionIsCredit) deduction += (record.standardDeduction && record.standardDeduction[filing]) || 0;
    deduction += exemptionAmount(record, income, filing);
    var taxable = Math.max(0, income - deduction);
    var tax = marginalTax(taxable, record.brackets && record.brackets[filing]);
    if (record.standardDeductionIsCredit) tax -= (record.standardDeduction && record.standardDeduction[filing]) || 0;
    if (record.personalExemptionIsCredit) tax -= (record.personalExemption && record.personalExemption[filing]) || 0;
    return Math.max(0, tax);
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
    var size = Number(input.hhSize);
    if (!(size >= 1)) return null;
    var base = usdaHousehold(size, input.usda);
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

  function dollarSentence(sign, floridaName, originName) {
    if (!floridaName || !originName) return '';
    if (sign > 0) return 'The monthly lines in this estimate cost more in ' + floridaName + ' than in ' + originName + '.';
    if (sign < 0) return 'The monthly lines in this estimate cost less in ' + floridaName + ' than in ' + originName + '.';
    return 'The monthly lines in this estimate cost about the same in ' + floridaName + ' as in ' + originName + '.';
  }

  // The BEA percent and the monthly total measure different baskets. The headline follows the monthly total when they point different ways, and it does not invent a percent.
  function alignedSentence(rppSentence, monthly, floridaName, originName) {
    var sentence = rppSentence || '';
    var rppSign = sentence.indexOf(' more than ') >= 0 ? 1 : sentence.indexOf(' less than ') >= 0 ? -1 : sentence.indexOf(' about the same as ') >= 0 ? 0 : null;
    var sign = monthly > 0 ? 1 : monthly < 0 ? -1 : 0;
    if (rppSign == null) return dollarSentence(sign, floridaName, originName) || sentence;
    if (rppSign === sign) return sentence;
    return dollarSentence(sign, floridaName, originName);
  }

  function medianOf(nums) {
    if (!nums || !nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function lowInformation(answers, meta) {
    var a = answers || {};
    var reasons = [];
    var core = ['household', 'income', 'ownNow', 'planFL', 'drives'];
    var unsure = core.filter(function (key) { return a[key] === 'not-sure'; }).length;
    if (unsure >= 3) reasons.push('unsure');
    if (a.income === 'not-sure' && a.ownNow === 'not-sure') reasons.push('income-tenure');
    var timing = meta && meta.timing;
    if (timing) {
      var mid = medianOf((timing.durationsMs || []).filter(function (n) { return typeof n === 'number'; }));
      if (mid != null && mid < 1500) reasons.push('rush');
      if (typeof timing.elapsedMs === 'number' && timing.elapsedMs < 10000) reasons.push('rush-total');
    }
    var picks = (meta && meta.choiceIndexes) || [];
    if (picks.length >= 5 && picks.every(function (i) { return i === picks[0] && i >= 0; })) reasons.push('defaults');
    var groceryZero = a.groceriesNow === 0 || a.groceriesNow === '0';
    var hoaNow = a.hoaNow;
    var hoaFL = a.hoaFL;
    var hoaQuiet = hoaNow === 0 || hoaNow === '0' || hoaNow === '' || hoaNow == null;
    var hoaQuietFL = hoaFL === 0 || hoaFL === '0' || hoaFL === '' || hoaFL == null;
    if (a.household === '1' && a.income === '250plus' && groceryZero && hoaQuiet && hoaQuietFL) reasons.push('thin');
    var budget = num(a.homeBudget);
    if (budget != null && (budget < 10000 || budget > 20000000)) reasons.push('budget');
    var vehicles = a.vehicles === '' || a.vehicles == null ? null : Number(a.vehicles);
    if (vehicles != null && vehicles > 10) reasons.push('vehicles');
    var miles = a.miles === '' || a.miles == null ? null : Number(a.miles);
    if (miles != null && miles * 12 > 100000) reasons.push('miles');
    var mpg = a.mpg === '' || a.mpg == null ? null : Number(a.mpg);
    if (a.fuel !== 'ev' && mpg === 0) reasons.push('mpg');
    return { show: reasons.length > 0, reasons: reasons };
  }

  function boundMessage(kind, value) {
    if (kind === 'budget') {
      if (value == null || String(value).trim() === '') return '';
      var budget = num(value);
      if (budget == null || budget < 0) return 'Enter a dollar amount, or leave it blank.';
      if (budget < 10000 || budget > 20000000) return 'Enter a home budget from $10,000 to $20,000,000, or leave it blank.';
      return '';
    }
    if (value == null || String(value).trim() === '') return '';
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 'Enter a number above zero.';
    if (kind === 'vehicles' && n > 10) return 'Enter 1 to 10 vehicles.';
    if (kind === 'miles' && n * 12 > 100000) return 'Enter 8,333 miles a month or less. That is 100,000 miles a year.';
    return '';
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
    var adults = input.adults == null || input.adults === '' ? Math.min(Math.max(hh, 1), 2) : Number(input.adults);
    var filing = filingStatus(adults);
    var band = input.incomeBand ? bandById(input.incomeBand, factors.incomeBands) : null;
    if (!band && input.income != null && input.income !== '') band = bandForIncome(num(input.income) || 0, factors.incomeBands);
    var income = band ? band.midpoint : null;
    var area = factors.florida && factors.florida.areas && factors.florida.areas[input.toArea];
    var originState = input.state || '';
    var groceries = groceryPair({
      hhSize: hh,
      groceriesNow: input.groceriesNow,
      rppOriginGoods: input.rppOriginGoods,
      rppFloridaGoods: input.rppFloridaGoods,
      usda: factors.usda
    });

    if (isTerritory(originState)) {
      lines.push(unavailableLine('income-tax', 'State income tax', sourceOf(factors.incomeTax)));
    } else if (originState && income != null && factors.incomeTax) {
      var annualTax = stateIncomeTax(originState, income, filing, factors.incomeTax.states);
      var monthlyTax = annualTax / 12;
      if (!(annualTax > 0) || round10(monthlyTax) === 0) {
        lines.push({
          id: 'income-tax',
          label: 'State income tax',
          origin: 0,
          florida: 0,
          difference: 0,
          inTotal: true,
          originNote: 'No change.',
          floridaNote: 'No change.',
          text: 'No change.',
          sources: sourceOf(factors.incomeTax)
        });
      } else {
        var taxLine = moneyLine('income-tax', 'State income tax', monthlyTax, 0, {
          originNote: 'Estimated savings.',
          floridaNote: '',
          sources: sourceOf(factors.incomeTax)
        });
        if (taxLine) lines.push(taxLine);
      }
    }

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

    if (isTerritory(originState)) {
      lines.push(unavailableLine('sales-tax', 'Sales tax', sourceOf(factors.salesTax).concat(sourceOf(factors.florida && factors.florida.salesTax))));
    } else if (income != null && groceries && factors.salesTax && area) {
      var originSales = factors.salesTax.states[originState];
      var floridaRate = area.salesTax;
      if (originSales && floridaRate != null) {
        var originMonthly = originSales.grocery === 'reduced'
          ? salesTaxMonthlyReduced(income, originSales.combined, originSales.groceryRate, groceries.origin)
          : salesTaxMonthly(income, originSales.combined, groceries.origin, originSales.grocery);
        var floridaMonthly = salesTaxMonthly(income, floridaRate, groceries.florida, 'exempt');
        var sales = moneyLine('sales-tax', 'Sales tax', originMonthly, floridaMonthly, {
          sources: sourceOf(factors.salesTax).concat(sourceOf(factors.florida.salesTax))
        });
        if (sales) lines.push(sales);
      }
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
      income: income,
      band: band,
      filing: filing,
      adults: adults,
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
    bandForIncome: bandForIncome,
    bandById: bandById,
    filingStatus: filingStatus,
    stateIncomeTax: stateIncomeTax,
    marginalTax: marginalTax,
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
    alignedSentence: alignedSentence,
    lowInformation: lowInformation,
    boundMessage: boundMessage,
    buildEstimate: buildEstimate
  };
});
