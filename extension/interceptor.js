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
  const cache = new Map(), pending = new Map(), relationships = new Map();
  function ingestRelationships(root, confirmed) {
    const stack = [root], seen = new WeakSet(), found = new Map();
    let visited = 0;
    while (stack.length && visited++ < 150000) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const name = value.core?.screen_name ?? value.legacy?.screen_name ?? value.screen_name;
      const following = value.relationship_perspectives?.following ?? value.legacy?.following ?? value.following;
      const followedBy = value.relationship_perspectives?.followed_by ?? value.legacy?.followed_by ?? value.followed_by;
      const requested = value.relationship_perspectives?.follow_request_sent ?? value.legacy?.follow_request_sent ?? value.follow_request_sent;
      if (typeof name === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(name) && (typeof following === 'boolean' || typeof requested === 'boolean' || typeof followedBy === 'boolean')) {
        const key = name.toLowerCase(), user = { ...relationships.get(key), ...found.get(key), name };
        if (typeof following === 'boolean') user.following = following;
        if (typeof followedBy === 'boolean') user.followedBy = followedBy;
        if (typeof requested === 'boolean') user.requested = requested;
        found.set(key, user);
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
    }
    const changed = [];
    for (const [key, user] of found) {
      if (confirmed || JSON.stringify(relationships.get(key)) !== JSON.stringify(user)) changed.push(user);
      relationships.set(key, user);
      if (relationships.size > 10000) relationships.delete(relationships.keys().next().value);
    }
    for (let i = 0; i < changed.length; i += 500) window.postMessage({ source: 'x-follower-badges-v1', type: 'relationships', users: changed.slice(i, i + 500), confirmed }, location.origin);
  }
  const followResponse = url => /\/friendships\/(create|destroy)\.json(?:\?|$)/.test(url);
  let timer, relationshipGeneration = 0;
  const send = users => window.postMessage({ source: 'x-follower-badges-v1', type: 'users', users }, location.origin);
  function ingest(data, confirmed = false, generation = relationshipGeneration) {
    if (confirmed) relationshipGeneration++;
    if (confirmed || generation === relationshipGeneration) ingestRelationships(data, confirmed);
    for (const user of extract(data)) {
      const key = user.name.toLowerCase();
      if (cache.get(key)?.count === user.count) continue;
      cache.delete(key);
      cache.set(key, user);
      pending.set(key, user);
      if (cache.size > 10000) cache.delete(cache.keys().next().value);
    }
    if (pending.size && !timer) timer = setTimeout(() => {
      timer = null;
      const users = [...pending.values()]; pending.clear();
      for (let i = 0; i < users.length; i += 500) send(users.slice(i, i + 500));
    }, 80);
  }
  function relevant(raw) {
    try {
      const u = new URL(raw, location.href);
      return /(^|\.)(x\.com|twitter\.com)$/.test(u.hostname) && /\/(graphql|api|1\.1|2)\//.test(u.pathname);
    } catch { return false; }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const generation = relationshipGeneration;
    const result = Reflect.apply(originalFetch, this, args);
    result.then(response => {
      if (relevant(response.url)) {
        try { response.clone().json().then(data => ingest(data, response.ok && followResponse(response.url), generation)).catch(() => {}); } catch {}
      }
    }).catch(() => {});
    return result;
  };
  const open = XMLHttpRequest.prototype.open;
  const urls = new WeakMap(), generations = new WeakMap(), hooked = new WeakSet();
  XMLHttpRequest.prototype.open = function (...args) {
    const result = Reflect.apply(open, this, args);
    urls.set(this, args[1]);
    generations.set(this, relationshipGeneration);
    if (!hooked.has(this)) {
      hooked.add(this);
      this.addEventListener('load', () => {
        if (!relevant(this.responseURL || urls.get(this))) return;
        try {
          if (this.responseType === 'json') ingest(this.response, this.status >= 200 && this.status < 300 && followResponse(this.responseURL || urls.get(this)), generations.get(this)); 
          else if (!this.responseType || this.responseType === 'text') ingest(JSON.parse(this.responseText), this.status >= 200 && this.status < 300 && followResponse(this.responseURL || urls.get(this)), generations.get(this));
        } catch {}
      });
    }
    return result;
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'x-follower-badges-ui-v1' || event.data.type !== 'ready') return;
    const relations = [...relationships.values()];
    for (let i = 0; i < relations.length; i += 500) window.postMessage({ source: 'x-follower-badges-v1', type: 'relationships', users: relations.slice(i, i + 500), confirmed: false }, location.origin);
    const users = [...cache.values()];
    for (let i = 0; i < users.length; i += 500) send(users.slice(i, i + 500));
  });
  // Some initial user records arrive with the HTML rather than an API response.
  function initial() {
    try { if (window.__INITIAL_STATE__) ingest(window.__INITIAL_STATE__); } catch {}
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      try { ingest(JSON.parse(script.textContent)); } catch {}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initial, { once: true });
  else initial();
})();
