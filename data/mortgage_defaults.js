// Every amount stays null until a cited value is added.
// Results and the form read this file only. Do not hard-code a rate, millage, premium, or HOA fee in the page.
window.MORTGAGE_DEFAULTS = {
  meta: {
    note: 'Planning defaults for the mortgage page. A number belongs here only with a source and an as-of date.'
  },
  fred: {
    seriesId: 'MORTGAGE30US',
    apiKey: null,
    source: null,
    url: 'https://fred.stlouisfed.org/series/MORTGAGE30US',
    asOf: null
  },
  rate: {
    value: null,
    low: null,
    high: null,
    unit: 'percent per year',
    source: null,
    url: null,
    asOf: null
  },
  term: {
    years: null,
    source: null,
    url: null,
    asOf: null
  },
  price: {
    value: null,
    source: null,
    url: null,
    asOf: null
  },
  downPayment: {
    dollars: null,
    percent: null,
    source: null,
    url: null,
    asOf: null
  },
  insurance: {
    quarterly: null,
    lowQuarterly: null,
    highQuarterly: null,
    source: null,
    url: null,
    asOf: null
  },
  places: [
    {
      id: 'manatee',
      name: 'Manatee County',
      county: 'Manatee',
      millage: { value: null, low: null, high: null, source: null, url: null, asOf: null },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'hillsborough',
      name: 'Hillsborough County',
      county: 'Hillsborough',
      millage: { value: null, low: null, high: null, source: null, url: null, asOf: null },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'pinellas',
      name: 'Pinellas County',
      county: 'Pinellas',
      millage: { value: null, low: null, high: null, source: null, url: null, asOf: null },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'sarasota',
      name: 'Sarasota County',
      county: 'Sarasota',
      millage: { value: null, low: null, high: null, source: null, url: null, asOf: null },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'venice',
      name: 'Venice (Sarasota County)',
      county: 'Sarasota',
      millage: { value: null, low: null, high: null, source: null, url: null, asOf: null },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'north-port',
      name: 'North Port (Sarasota County)',
      county: 'Sarasota',
      millage: { value: null, low: null, high: null, source: null, url: null, asOf: null },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    }
  ]
};
