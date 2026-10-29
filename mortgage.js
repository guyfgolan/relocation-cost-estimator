(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mortgage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null) return null;
    let text = String(value).trim();
    if (!text) return null;
    text = text.replace(/[$,\s]/g, '').replace(/[^0-9.eE+-]/g, '');
    if (!/\d/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function cents(value) {
    return Math.round(value * 100) / 100;
  }

  function monthlyPayment(principal, annualPercent, years) {
    if (!(principal > 0) || !(years > 0) || annualPercent == null || !Number.isFinite(annualPercent) || annualPercent < 0) return null;
    const months = years * 12;
    if (annualPercent === 0) return principal / months;
    const r = annualPercent / 100 / 12;
    const growth = Math.pow(1 + r, months);
    return principal * r * growth / (growth - 1);
  }

  function pair(low, high) {
    const a = cents(low);
    const b = cents(high);
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }

  function placeById(defaults, id) {
    const places = (defaults && defaults.places) || [];
    for (let i = 0; i < places.length; i++) if (places[i].id === id) return places[i];
    return null;
  }

  function communityById(defaults, id) {
    const rows = (defaults && defaults.communities) || [];
    for (let i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }

  function countyInsurance(defaults, place) {
    const counties = defaults && defaults.insurance && defaults.insurance.counties;
    if (!counties || !place) return null;
    return counties[place.county] || null;
  }

  function measuredCommunityMonthly(community) {
    if (!community || community.label !== 'MEASURED') return null;
    let low = 0;
    let high = 0;
    let any = false;
    if (community.hoaAnnualLow != null && community.hoaAnnualHigh != null) {
      low += community.hoaAnnualLow;
      high += community.hoaAnnualHigh;
      any = true;
    }
    if (community.cddAnnualLow != null && community.cddAnnualHigh != null) {
      low += community.cddAnnualLow;
      high += community.cddAnnualHigh;
      any = true;
    }
    if (!any) return null;
    return { low: low / 12, high: high / 12 };
  }

  function buildEstimate(input, defaults) {
    const D = defaults || {};
    const notes = ['The exact monthly figure depends on the lot.'];
    const details = [];
    const missing = [];
    const price = num(input.price);
    const downDollars = num(input.downDollars);
    const downPercent = num(input.downPercent);
    const typedRate = num(input.rate);
    const taxAnnual = num(input.taxAnnual);
    const insuranceMonthly = num(input.insuranceMonthly);
    const hoaMonthly = num(input.hoaMonthly);
    const term = D.term && num(D.term.years);
    const place = placeById(D, input.placeId);

    if (!(price > 0)) missing.push('home price');

    let down = null;
    if (downDollars != null && downPercent != null) {
      down = downDollars;
      notes.push('Both a dollar down payment and a percent were entered. The dollar amount is used.');
    } else if (downDollars != null) down = downDollars;
    else if (downPercent != null && price != null) down = price * downPercent / 100;
    else missing.push('down payment');

    if (down != null && price != null && down > price) {
      notes.push('The down payment is higher than the home price.');
      missing.push('down payment');
      down = null;
    }
    if (down != null && down < 0) {
      missing.push('down payment');
      down = null;
    }

    const loan = price != null && down != null ? price - down : null;
    if (loan === 0) notes.push('The down payment covers the price, so principal and interest are $0.');

    const rateFile = D.rate || {};
    let rateLow = null;
    let rateHigh = null;
    if (input.rateTouched || rateFile.low == null || rateFile.high == null) {
      if (typedRate == null) missing.push('interest rate');
      else rateLow = rateHigh = typedRate;
    } else {
      rateLow = rateFile.low;
      rateHigh = rateFile.high;
    }

    if (!(term > 0)) missing.push('loan term');

    let principal = null;
    if (loan != null && loan >= 0 && rateLow != null && rateHigh != null && term > 0) {
      if (loan === 0) principal = { low: 0, high: 0 };
      else {
        const payLow = monthlyPayment(loan, rateLow, term);
        const payHigh = monthlyPayment(loan, rateHigh, term);
        if (payLow == null || payHigh == null) missing.push('principal and interest');
        else principal = pair(payLow, payHigh);
      }
    }

    const millage = place && place.millage;
    let tax = null;
    if (input.taxTouched) {
      if (taxAnnual == null) missing.push('property tax');
      else tax = pair(taxAnnual / 12, taxAnnual / 12);
    } else if (millage && millage.low != null && millage.high != null && price != null) {
      tax = pair(price * millage.low / 1000 / 12, price * millage.high / 1000 / 12);
    } else if (millage && millage.value != null && price != null) {
      tax = pair(price * millage.value / 1000 / 12, price * millage.value / 1000 / 12);
    } else if (taxAnnual != null) tax = pair(taxAnnual / 12, taxAnnual / 12);
    else missing.push('property tax');

    const ins = D.insurance || {};
    const countyPremium = countyInsurance(D, place);
    let insurance = null;
    if (input.insuranceTouched) {
      if (insuranceMonthly == null) missing.push('insurance');
      else insurance = pair(insuranceMonthly, insuranceMonthly);
    } else if (ins.range && ins.range.low != null && ins.range.high != null) {
      insurance = pair(ins.range.low / 12, ins.range.high / 12);
      notes.push('Estimate based on Florida insurance averages; your quote will vary.');
      details.push('The insurance range runs from a Florida county average to a published estimate for a Sarasota home. It is not a quote for your house.');
    } else if (countyPremium && countyPremium.annual != null) {
      insurance = pair(countyPremium.annual / 12, countyPremium.annual / 12);
      notes.push('Estimate based on Florida insurance averages; your quote will vary.');
    } else if (insuranceMonthly != null) insurance = pair(insuranceMonthly, insuranceMonthly);
    else missing.push('insurance');
    details.push('Homeowners insurance does not include flood. A lender may require a separate flood policy in a high-risk flood zone. This estimate does not add one.');
    details.push('A new home\'s first tax bill often covers only the land or a partial value as of January 1. The full bill usually arrives the next year.');

    const community = communityById(D, input.communityId);
    const measuredHoa = measuredCommunityMonthly(community);
    let hoa = null;
    let hoaEntered = false;
    if (input.hoaTouched) {
      if (hoaMonthly != null) {
        hoa = pair(hoaMonthly, hoaMonthly);
        hoaEntered = true;
      }
    } else if (measuredHoa) {
      hoa = pair(measuredHoa.low, measuredHoa.high);
      hoaEntered = true;
      notes.push('HOA and community development dues for ' + community.name + ' are included. You can type your own amount.');
    } else if (community && community.label === 'UNVERIFIED') {
      notes.push('Enter your own HOA amount for ' + community.name + '. A published dues figure is not included.');
    }
    if (!hoaEntered && !(community && community.label === 'UNVERIFIED')) notes.push('HOA dues are not included.');

    const lines = [
      { id: 'principal', label: 'Principal and interest', range: principal },
      { id: 'tax', label: 'Property tax', range: tax },
      { id: 'insurance', label: 'Insurance', range: insurance },
      { id: 'hoa', label: 'HOA', range: hoaEntered ? hoa : null, omitted: !hoaEntered }
    ];

    const required = [principal, tax, insurance];
    const complete = required.every(Boolean) && missing.length === 0;
    let total = null;
    if (complete) {
      let low = principal.low + tax.low + insurance.low;
      let high = principal.high + tax.high + insurance.high;
      if (hoaEntered) {
        low += hoa.low;
        high += hoa.high;
      }
      total = pair(low, high);
    }

    return {
      complete,
      missing,
      notes,
      details,
      lines,
      total,
      loan,
      term,
      place
    };
  }

  return {
    num,
    cents,
    monthlyPayment,
    placeById,
    communityById,
    countyInsurance,
    measuredCommunityMonthly,
    buildEstimate
  };
});
