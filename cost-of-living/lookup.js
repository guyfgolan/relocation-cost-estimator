(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CostLookup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function resolveKeys(crosswalk, zip) {
    const code = String(zip || '');
    const hit = ((crosswalk && crosswalk.zips) || []).find(function (row) { return row.zip === code; });
    if (!hit) return { zip: code, county: '', cbsa: '', state: '', sample: false };
    return {
      zip: hit.zip,
      county: hit.countyFips || '',
      cbsa: hit.cbsa || '',
      state: hit.state || '',
      sample: hit.label === 'SAMPLE'
    };
  }

  function levelName(level) {
    if (level === 'cbsa') return 'metro value';
    if (level === 'zip') return 'ZIP value';
    if (level === 'county') return 'county value';
    if (level === 'state') return 'state value';
    return 'Not available';
  }

  function lookup(bundle, zip, categoryId, componentId) {
    const keys = resolveKeys(bundle.crosswalk, zip);
    const order = (bundle.nationalTables && bundle.nationalTables.fallback) || ['zip', 'county', 'cbsa', 'state'];
    const rows = (bundle.nationalTables && bundle.nationalTables.rows) || [];
    const component = componentId || null;
    for (let i = 0; i < order.length; i++) {
      const level = order[i];
      const geoId = keys[level];
      if (!geoId) continue;
      const hit = rows.find(function (row) {
        return row.geoLevel === level && row.geoId === geoId && row.categoryId === categoryId && (row.componentId || null) === component;
      });
      if (hit) return { figure: hit, level: levelName(level), keys: keys };
    }
    return { figure: null, level: 'Not available', keys: keys };
  }

  function monthlyAmount(figure) {
    if (!figure || typeof figure.value !== 'number' || Number.isNaN(figure.value)) return null;
    if (figure.unit === 'USD/month') return figure.value;
    if (figure.unit === 'USD/year') return figure.value / 12;
    return null;
  }

  function sumMonthly(figures) {
    if (!figures || !figures.length) return null;
    let total = 0;
    for (let i = 0; i < figures.length; i++) {
      const amount = monthlyAmount(figures[i]);
      if (amount == null) return null;
      total += amount;
    }
    return total;
  }

  function linkText(figure) {
    if (!figure || !figure.url) return '';
    return figure.linkLabel || figure.source || '';
  }

  function housingTenures(tenure) {
    if (tenure === 'rent') return ['rent'];
    if (tenure === 'own') return ['own'];
    return ['rent', 'own'];
  }

  function rowLabel(category, tenure) {
    let label = category.label;
    if (category.id === 'housing') label = tenure === 'rent' ? 'Gross rent' : tenure === 'own' ? 'Principal and interest' : 'Housing';
    if (category.id === 'utilities') label = 'Utilities';
    const ownerOnly = category.hiddenFor === 'rent' || category.id === 'property-tax' || category.id === 'utilities';
    if (ownerOnly && tenure !== 'rent' && tenure !== 'own') return 'If you buy: ' + label;
    return label;
  }

  function figureMatch(rows, tenure) {
    const list = rows || [];
    if (tenure === 'rent' || tenure === 'own') {
      return list.find(function (row) { return row.tenure === tenure; }) || list.find(function (row) { return row.tenure === 'both' || row.tenure == null; }) || null;
    }
    const shared = list.find(function (row) { return row.tenure === 'both' || row.tenure == null; });
    if (shared) return shared;
    const hasRent = list.some(function (row) { return row.tenure === 'rent'; });
    const hasOwn = list.some(function (row) { return row.tenure === 'own'; });
    if (hasRent && hasOwn) return null;
    return list.length === 1 ? list[0] : null;
  }

  return {
    resolveKeys: resolveKeys,
    lookup: lookup,
    monthlyAmount: monthlyAmount,
    sumMonthly: sumMonthly,
    linkText: linkText,
    housingTenures: housingTenures,
    rowLabel: rowLabel,
    figureMatch: figureMatch
  };
});
