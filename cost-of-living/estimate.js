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

  function propertySide(tenure, price, rateKind, rate, homestead) {
    if (tenure === 'rent') return { monthly: 0, note: 'Included in rent' };
    if (price == null || rate == null) return null;
    var annual;
    if (rateKind === 'millage') annual = Math.max(0, price - (homestead || 0)) * rate / 1000;
    else annual = price * rate;
    return { monthly: annual / 12, note: '' };
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
    var adults = input.adults == null || input.adults === '' ? Math.min(Math.max(hh, 1), 2) : Number(input.adults);
    var filing = filingStatus(adults);
    var band = bandById(input.incomeBand, factors.incomeBands) || bandForIncome(num(input.income) || 0, factors.incomeBands);
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

    if (originState && income != null && factors.incomeTax) {
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

    var utilityOrigin = utilitiesMonthly({
      electricity: electricityBill(input.kwhOrigin, input.elecRateOrigin),
      gas: input.gasBillOrigin,
      water: waterBill(input.waterOrigin, input.nationalWater, input.rppOriginUtilities)
    });
    var utilityFlorida = utilitiesMonthly({
      electricity: electricityBill(input.kwhFlorida, input.elecRateFlorida),
      gas: input.gasBillFlorida,
      water: waterBill(input.waterFlorida, input.nationalWater, input.rppFloridaUtilities)
    });
    if (utilityOrigin && utilityFlorida && utilityOrigin.label === utilityFlorida.label) {
      var utility = moneyLine('utilities', utilityOrigin.label, utilityOrigin.monthly, utilityFlorida.monthly, {
        sources: sourceOf(factors.electricity).concat(sourceOf(factors.naturalGas), sourceOf(factors.water))
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

    if (input.flood && area && area.flood != null) {
      var flood = moneyLine('flood', 'Flood insurance', 0, area.flood / 12, {
        originNote: '',
        floridaNote: 'Flood coverage may be required by your lender depending on the property\'s flood zone.',
        sources: sourceOf(factors.florida.flood)
      });
      if (flood) lines.push(flood);
    }

    if (income != null && groceries && factors.salesTax && area) {
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
      var originProperty = propertySide(
        input.ownNow === 'own' ? 'own' : 'rent',
        input.originMedianValue,
        'effective',
        input.originEffRate,
        0
      );
      var floridaProperty = propertySide(
        input.planFL === 'buy' ? 'own' : 'rent',
        floridaPrice,
        'millage',
        area.millage,
        homestead
      );
      if (originProperty && floridaProperty) {
        var property = moneyLine('property-tax', 'Property tax', originProperty.monthly, floridaProperty.monthly, {
          originNote: originProperty.note,
          floridaNote: floridaProperty.note,
          sources: sourceOf(factors.florida.millage).concat(sourceOf(factors.homestead), sourceOf(factors.florida.medianPrice))
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
    propertySide: propertySide,
    utilitiesMonthly: utilitiesMonthly,
    electricityBill: electricityBill,
    waterBill: waterBill,
    priceLevelSentence: priceLevelSentence,
    buildEstimate: buildEstimate
  };
});
