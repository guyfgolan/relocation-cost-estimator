(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveSources = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function todayISO(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function prettyDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function decode(html) {
    return String(html)
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#160;/g, ' ')
      .replace(/&#8217;|&rsquo;|\u2019/g, "'")
      .replace(/&#8211;|&ndash;/g, '-')
      .replace(/&#8212;|&mdash;/g, '-');
  }

  function parseMoney(raw) {
    const text = String(raw).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('not a number: ' + raw);
    return Number(text);
  }

  function challenged(text) {
    return /sgcaptcha|Attention Required|cf-error-details|Just a moment/i.test(String(text).slice(0, 4000));
  }

  function parseGsa(html) {
    const text = decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const lodging = text.match(/standard lodging rate(?: increased from \$[0-9,]+(?:\.\d+)? to)? \$([0-9,]+(?:\.\d+)?)/i);
    const meals = text.match(/standard M&IE rate (?:remains at|is) \$([0-9,]+(?:\.\d+)?)/i);
    if (!lodging || !meals) throw new Error('GSA standard lodging or M&IE rate missing');
    const fy = text.match(/FY\)?\s*(20\d\d)/i) || text.match(/Fiscal Year \(FY\) (20\d\d)/i);
    return { lodging: parseMoney(lodging[1]), meals: parseMoney(meals[1]), fy: fy ? fy[1] : '' };
  }

  function inRange(lodging, meals) {
    return lodging >= 50 && lodging <= 500 && meals >= 40 && meals <= 200;
  }

  function applyGsaLive(data, parsed, today) {
    if (!inRange(parsed.lodging, parsed.meals)) throw new Error('GSA rate out of range');
    data.lodging.value = parsed.lodging;
    data.meals.value = parsed.meals;
    data.lodging.checked = today;
    data.meals.checked = today;
    data.lodging.freshness = 'live';
    data.meals.freshness = 'live';
    delete data.lodging.fallbackReason;
    delete data.meals.fallbackReason;
    if (parsed.fy) {
      const current = String(data.lodging.asOf || '');
      const label = current.includes(parsed.fy) ? data.lodging.asOf : 'FY' + parsed.fy;
      data.lodging.asOf = label;
      const mealsAsOf = String(data.meals.asOf || '');
      data.meals.asOf = mealsAsOf.includes(parsed.fy) ? data.meals.asOf : label;
    }
  }

  function markFallback(block, reason) {
    if (!block) return;
    block.freshness = 'fallback';
    block.fallbackReason = reason;
  }

  async function readGsa(data, fetchText) {
    const url = data && data.lodging && data.lodging.url;
    const today = todayISO();
    const reason = 'The live GSA read failed, so the last stored rate is shown.';
    if (!url) {
      markFallback(data && data.lodging, reason);
      markFallback(data && data.meals, reason);
      return { ok: false };
    }
    try {
      const html = await fetchText(url);
      if (challenged(html)) throw new Error('The GSA page did not return the bulletin.');
      applyGsaLive(data, parseGsa(html), today);
      return { ok: true, checked: today };
    } catch (err) {
      markFallback(data.lodging, reason);
      markFallback(data.meals, reason);
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  function dated(value) {
    if (!value) return '';
    const pretty = prettyDate(value);
    return pretty || value;
  }

  function sourceCaption(s) {
    if (!s || !s.source) return '';
    const when = s.asOf ? ', as of ' + dated(s.asOf) : '';
    if (s.freshness === 'live') return 'Live from ' + s.source + when + (s.checked ? '. Read on ' + dated(s.checked) + '.' : '.');
    if (s.freshness === 'fallback') return 'Stored fallback, not live, from ' + s.source + when + '. ' + (s.fallbackReason || 'The live read failed.');
    if (s.status === 'ASSUMPTION') return 'Assumption, not a live price: ' + s.source + when + '.';
    if (s.status === 'SOURCED') return 'Stored figure, not live, from ' + s.source + when + '.';
    return '';
  }

  function lineCaptions(line) {
    const seen = [];
    (line && line.sources || []).forEach(s => {
      const text = sourceCaption(s);
      if (text && seen.indexOf(text) < 0) seen.push(text);
    });
    return seen.join(' ');
  }

  return { parseGsa, applyGsaLive, readGsa, sourceCaption, lineCaptions, prettyDate, todayISO };
});
