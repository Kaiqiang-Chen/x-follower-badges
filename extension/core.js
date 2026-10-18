(() => {
  'use strict';
  const valid = (name, count) => typeof name === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(name) && Number.isSafeInteger(count) && count >= 0;
  function extract(root) {
    const users = new Map(), seen = new WeakSet(), stack = [root];
    let visited = 0;
    while (stack.length && visited++ < 150000) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const name = value.core?.screen_name ?? value.legacy?.screen_name ?? value.screen_name;
      const count = value.relationship_counts?.followers ?? value.legacy?.followers_count ?? value.followers_count ?? value.public_metrics?.followers_count;
      if (valid(name, count)) users.set(name.toLowerCase(), { name, count });
      for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
    }
    return [...users.values()];
  }
  function format(count, mode = 'compact') {
    if (mode === 'exact' || count < 10000) return count.toLocaleString('en-US');
    const unit = count >= 100000000 ? 100000000 : 10000;
    return (count / unit).toFixed(1).replace(/\.0$/, '') + (unit === 10000 ? '万' : '亿');
  }
  function profile(href, origin = 'https://x.com') {
    try {
      const url = new URL(href, origin);
      if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      const name = match?.[1].toLowerCase();
      if (!name || ['home','explore','notifications','messages','search','settings','compose','i','intent','login','logout','signup'].includes(name)) return null;
      return name;
    } catch { return null; }
  }
  const api = { valid, extract, format, profile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.__XFollowerCore = api;
})();
