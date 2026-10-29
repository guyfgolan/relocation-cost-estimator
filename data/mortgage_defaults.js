// Cited defaults compiled 2026-10-29. Amounts are the figures in Dexter's defaults file.
// A null low or high means that end was not supplied. Do not fill a gap with a guessed number.
window.MORTGAGE_DEFAULTS = {
  meta: {
    compiled: '2026-10-29',
    note: 'Freddie Mac PMMS is the rate fallback because no FRED API key is configured.'
  },
  fred: {
    seriesId: 'MORTGAGE30US',
    apiKey: null,
    source: 'Federal Reserve Bank of St. Louis, FRED. A free API key is required and none is configured.',
    url: 'https://fred.stlouisfed.org/series/MORTGAGE30US',
    asOf: null
  },
  rate: {
    value: 7.32,
    low: null,
    high: null,
    unit: 'percent per year',
    source: 'Freddie Mac Primary Mortgage Market Survey, 30-year fixed, week of 2026-10-22',
    url: 'https://www.freddiemac.com/pmms',
    asOf: '2026-10-22',
    label: 'MEASURED',
    note: 'Prior week was 7.40%. That prior week is not used as a high. The next PMMS release was scheduled Thu 2026-10-29 at 12pm ET.'
  },
  term: {
    years: 30,
    source: 'Freddie Mac Primary Mortgage Market Survey, 30-year fixed',
    url: 'https://www.freddiemac.com/pmms',
    asOf: '2026-10-22',
    label: 'MEASURED'
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
    range: {
      low: 3181,
      high: 6826,
      unit: 'dollars per year',
      label: 'INFERENCE',
      source: 'Low is the Florida Office of Insurance Regulation Manatee average. High is the Insurify Sarasota estimate for a $300,000 dwelling.',
      url: 'https://insurify.com/homeowners-insurance/florida/sarasota/',
      asOf: '2026-10-21',
      note: 'The low matches the OIR Manatee average as of 2026-03-31. The high is not a confirmed premium.'
    },
    counties: {
      Manatee: { annual: 3181, source: 'Florida Office of Insurance Regulation, homeowners insurance including wind', url: 'https://floir.gov/docs-sf/default-source/property-and-casualty/stability-unit-reports/july-2026-isu-report.pdf', asOf: '2026-03-31', label: 'MEASURED' },
      Sarasota: { annual: 3457, source: 'Florida Office of Insurance Regulation, homeowners insurance including wind', url: 'https://floir.gov/docs-sf/default-source/property-and-casualty/stability-unit-reports/july-2026-isu-report.pdf', asOf: '2026-03-31', label: 'MEASURED' },
      Hillsborough: { annual: 3525, source: 'Florida Office of Insurance Regulation, homeowners insurance including wind', url: 'https://floir.gov/docs-sf/default-source/property-and-casualty/stability-unit-reports/july-2026-isu-report.pdf', asOf: '2026-03-31', label: 'MEASURED' },
      Pinellas: { annual: 4063, source: 'Florida Office of Insurance Regulation, homeowners insurance including wind', url: 'https://floir.gov/docs-sf/default-source/property-and-casualty/stability-unit-reports/july-2026-isu-report.pdf', asOf: '2026-03-31', label: 'MEASURED' }
    },
    floodNote: 'Homeowners policies exclude flood. Flood insurance is required in a FEMA high-risk zone with a federally backed loan. There is no default flood premium.',
    effectiveTaxNote: 'An inferred effective tax rate of 1.3% to 1.9% of price with a homestead exemption, or 1.5% to 2.1% without one, is not used. The tax line uses millage. A new build\'s first bill often reflects land or a partial value as of January 1. That timing is not a fixed rule.'
  },
  communities: [
    {
      id: 'wildleaf-nrr',
      name: 'Wildleaf at North River Ranch',
      label: 'MEASURED',
      hoaAnnualLow: 111,
      hoaAnnualHigh: 1541,
      cddAnnualLow: 2336,
      cddAnnualHigh: 3764,
      source: 'Donovan Homes, citing North River Ranch ISD adopted assessments',
      url: 'https://donovanhomesfl.com/lakewood-ranch-parrish-hoa-cdd-fees/',
      asOf: '2026-10-01',
      note: '$111 is the single-family master HOA in the 2025 budget. $1,541 is the villa HOA. CDD is the FY2027 adopted assessment. A combined monthly figure of about $205 to $440 is a rounded inference and is not used.'
    },
    {
      id: 'nrr-other',
      name: 'Other North River Ranch (Brightwood, Morgan\'s Glen)',
      label: 'MEASURED',
      hoaAnnualLow: null,
      hoaAnnualHigh: null,
      cddAnnualLow: 2261,
      cddAnnualHigh: 3703,
      source: 'Donovan Homes, citing North River Ranch ISD adopted assessments',
      url: 'https://donovanhomesfl.com/lakewood-ranch-parrish-hoa-cdd-fees/',
      asOf: '2026-10-01',
      note: 'This row is the CDD only. An HOA amount for these communities was not in the measured row.'
    },
    {
      id: 'lakewood-ranch',
      name: 'Lakewood Ranch',
      label: 'UNVERIFIED',
      hoaMonthlyLow: 146,
      hoaMonthlyHigh: 600,
      cddAnnualExample: 1592.67,
      source: 'LWR Scout',
      url: 'https://lwrscout.com/compare',
      asOf: '2026',
      note: 'Third-party aggregator, partial snippet. Not a confirmed prefill.'
    },
    {
      id: 'wellen-park',
      name: 'Wellen Park',
      label: 'UNVERIFIED',
      hoaMonthlyLow: 207,
      hoaMonthlyHigh: 1209,
      cddAnnualLow: 575,
      cddAnnualHigh: 4095,
      source: 'Michael Ryan Dailey',
      url: 'https://michaelryandailey.com/wellen-park-cdd-hoa-fees',
      asOf: '2026',
      note: 'Agent page across 18 communities. Not a confirmed prefill.'
    },
    {
      id: 'del-webb-nrr',
      name: 'Del Webb at North River Ranch',
      label: 'UNVERIFIED',
      hoaMonthlyLow: 346,
      hoaMonthlyHigh: 363,
      source: 'Explore Del Webb NRR',
      url: 'https://exploredelwebbnrr.com/costs',
      asOf: null,
      note: 'Partial snippet. Not a confirmed prefill.'
    }
  ],
  places: [
    {
      id: 'manatee',
      name: 'Manatee County',
      county: 'Manatee',
      millage: {
        value: 14.5524,
        low: null,
        high: null,
        unit: 'mills',
        source: 'Manatee County Property Appraiser, 2025 final adopted millage, county average via the Florida Department of Revenue',
        url: 'https://www.manateepao.gov/data/Tax_Roll_Data/Millages/2025%20Final%20Adopted%20Millage%20Rates.pdf',
        asOf: '2025 final',
        label: 'MEASURED',
        note: 'The district table was not extracted, so there is no city or district range. This is the county average. CDD assessments are not included in the millage.'
      },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'hillsborough',
      name: 'Hillsborough County',
      county: 'Hillsborough',
      millage: {
        value: 18.8553,
        low: 18.29,
        high: 19.84,
        unit: 'mills',
        source: 'Hillsborough County Property Appraiser, 2025 final millage. County average via the Florida Department of Revenue.',
        url: 'https://www.hcpafl.org/Portals/HCPAFL/pdfs/2025FinalMillage.pdf',
        asOf: '2025 final',
        label: 'MEASURED',
        note: 'The low is Plant City and the high is Tampa, from the published city totals. Unincorporated Hillsborough was not captured. CDD assessments are not included.'
      },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'pinellas',
      name: 'Pinellas County',
      county: 'Pinellas',
      millage: {
        value: 18.4941,
        low: null,
        high: null,
        unit: 'mills',
        source: 'Florida Department of Revenue millage and taxes levied, via ParcelMath',
        url: 'https://parcelmath.com/research/florida-property-tax-by-county-2026/florida-property-tax-by-county-2025.csv',
        asOf: '2025',
        label: 'MEASURED',
        note: 'City millage was not pulled. This is the county average, not a city total.'
      },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'sarasota',
      name: 'Sarasota County',
      county: 'Sarasota',
      millage: {
        value: 12.7527,
        low: 10.7437,
        high: 11.4737,
        unit: 'mills',
        source: 'Sarasota County Tax Collector, 2025 certified millage. County average via the Florida Department of Revenue.',
        url: 'https://www.sarasotataxcollector.gov/docs/2025Millage',
        asOf: '2025 certified 2025-10-03',
        label: 'MEASURED',
        note: 'The low and high are the countywide base only: 10.7437 mills for North Port, the City of Venice, and Longboat Key, and 11.4737 mills elsewhere, which adds EMS. They do not include city millage. The county average, 12.7527, is higher because city millage is in the average. The City of Sarasota city millage was described as about 3.41 mills and is not added here.'
      },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'venice',
      name: 'Venice (Sarasota County)',
      county: 'Sarasota',
      millage: {
        value: 12.7527,
        low: null,
        high: null,
        unit: 'mills',
        source: 'Sarasota County average, Florida Department of Revenue. Venice city millage was not pulled.',
        url: 'https://www.sarasotataxcollector.gov/docs/2025Millage',
        asOf: '2025 certified 2025-10-03',
        label: 'MEASURED',
        note: 'City millage was not pulled, so this field uses the Sarasota County average of 12.7527 mills, not a Venice city total. The countywide base cited for the City of Venice is 10.7437 mills and does not include city millage.'
      },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    },
    {
      id: 'north-port',
      name: 'North Port (Sarasota County)',
      county: 'Sarasota',
      millage: {
        value: 12.7527,
        low: null,
        high: null,
        unit: 'mills',
        source: 'Sarasota County average, Florida Department of Revenue. North Port city millage was not pulled.',
        url: 'https://www.sarasotataxcollector.gov/docs/2025Millage',
        asOf: '2025 certified 2025-10-03',
        label: 'MEASURED',
        note: 'City millage was not pulled, so this field uses the Sarasota County average of 12.7527 mills, not a North Port city total. The countywide base cited for North Port is 10.7437 mills and does not include city millage.'
      },
      hoa: { monthly: null, low: null, high: null, source: null, url: null, asOf: null }
    }
  ]
};
