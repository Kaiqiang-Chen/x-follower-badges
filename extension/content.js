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
  const users = new Map();
  let settings = { enabled: true, format: 'compact' }, timer;
  const selector = '[data-testid="User-Name"], [data-testid="UserCell"]';
  function schedule() {
    if (!timer) timer = setTimeout(() => { timer = null; render(); }, 120);
  }
  function render() {
    if (!settings.enabled) {
      document.querySelectorAll('.xfb-badge').forEach(b => b.remove()); return;
    }
    for (const container of document.querySelectorAll(selector)) {
      // UserCell can contain a User-Name; let the more specific container own it.
      if (container.matches('[data-testid="UserCell"]') && container.querySelector('[data-testid="User-Name"]')) continue;
      const links = [...container.querySelectorAll('a[href]')].filter(a => profile(a.getAttribute('href'), location.origin));
      const anchor = links.find(a => a.textContent.trim() && !a.textContent.trim().startsWith('@'))
        || links.find(a => a.textContent.trim().startsWith('@'));
      const handleSpan = [...container.querySelectorAll('span')].find(e => /^@[A-Za-z0-9_]{1,15}$/.test(e.textContent.trim()));
      const name = anchor ? profile(anchor.getAttribute('href'), location.origin) : handleSpan?.textContent.trim().slice(1).toLowerCase();
      const user = users.get(name);
      const badges = [...container.querySelectorAll('.xfb-badge')];
      let badge = badges.shift();
      badges.forEach(b => b.remove());
      if (!user || (!anchor && !handleSpan)) { badge?.remove(); continue; }
      if (badge && badge.dataset.handle !== name) { badge.remove(); badge = null; }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'xfb-badge'; badge.dataset.handle = name;

      }
      let mount;
      if (container.matches('[data-testid="User-Name"]')) {
        // X's name link lives inside a column. Place the badge between the
        // top-level name group (including verification) and the handle group.
        const nameGroup = container.firstElementChild;
        const direction = getComputedStyle(container).flexDirection;
        if (direction === 'column' || direction === 'column-reverse') {
          // Expanded post headers stack name and handle vertically. Keep the
          // badge inside the name group instead of creating a third line.
          nameGroup.classList.add('xfb-name-row');
          if (badge.parentElement !== nameGroup) nameGroup.appendChild(badge);
        } else {
          mount = nameGroup;
        }
      } else {
        // User lists have name and handle on separate lines. Their name link
        // contains an existing horizontal row, including the verification icon.
        const row = [...anchor.querySelectorAll('div')].find(e => {
          const style = getComputedStyle(e);
          return style.display === 'flex' && style.flexDirection === 'row';
        }) || anchor;
        if (badge.parentElement !== row) row.appendChild(badge);
        if (row === anchor) row.classList.add('xfb-name-row');
      }
      if (mount && mount !== badge && mount.nextElementSibling !== badge) mount.insertAdjacentElement('afterend', badge);
      const text = '粉丝 ' + format(user.count, settings.format);
      if (badge.textContent !== text) badge.textContent = text;
      const label = `@${user.name} · ${user.count.toLocaleString('en-US')} 位粉丝（本次页面响应）`;
      if (badge.title !== label) { badge.title = label; badge.setAttribute('aria-label', label); }
    }
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'x-follower-badges-v1' || data.type !== 'users' || !Array.isArray(data.users) || data.users.length > 500) return;
    for (const user of data.users) {
      if (!user || !valid(user.name, user.count)) continue;
      const key = user.name.toLowerCase(); users.delete(key); users.set(key, { name: user.name, count: user.count });
      if (users.size > 10000) users.delete(users.keys().next().value);
    }
    schedule();
  });
  chrome.storage.local.get(settings).then(value => { settings = value; schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of ['enabled', 'format']) if (changes[key]) settings[key] = changes[key].newValue;
    schedule();
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === 'status') reply({ users: users.size, badges: document.querySelectorAll('.xfb-badge').length });
  });
  const observer = new MutationObserver(records => {
    if (records.some(r => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.xfb-badge') &&
      !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.classList.contains('xfb-badge'))))) schedule();
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  window.postMessage({ source: 'x-follower-badges-ui-v1', type: 'ready' }, location.origin);
  schedule();
})();
