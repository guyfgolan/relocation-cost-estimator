(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mortgage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function num(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
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

  function buildEstimate(input, defaults) {
    const D = defaults || {};
    const notes = ['The exact monthly figure depends on the lot.'];
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
      missing.push('down payment within the home price');
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

    if (!(term > 0)) missing.push('loan term in the data file');

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
    } else if (taxAnnual != null) tax = pair(taxAnnual / 12, taxAnnual / 12);
    else missing.push('property tax');

    const ins = D.insurance || {};
    let insurance = null;
    if (input.insuranceTouched) {
      if (insuranceMonthly == null) missing.push('insurance');
      else insurance = pair(insuranceMonthly, insuranceMonthly);
    } else if (ins.lowQuarterly != null && ins.highQuarterly != null) {
      insurance = pair(ins.lowQuarterly / 3, ins.highQuarterly / 3);
    } else if (insuranceMonthly != null) insurance = pair(insuranceMonthly, insuranceMonthly);
    else missing.push('insurance');

    const hoaFile = place && place.hoa;
    let hoa = null;
    let hoaEntered = false;
    if (input.hoaTouched) {
      if (hoaMonthly != null) {
        hoa = pair(hoaMonthly, hoaMonthly);
        hoaEntered = true;
      }
    } else if (hoaFile && hoaFile.low != null && hoaFile.high != null) {
      hoa = pair(hoaFile.low, hoaFile.high);
      hoaEntered = true;
    } else if (hoaMonthly != null) {
      hoa = pair(hoaMonthly, hoaMonthly);
      hoaEntered = true;
    }
    if (!hoaEntered) notes.push('HOA is not in this range because no amount was entered.');

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
    buildEstimate
  };
});
