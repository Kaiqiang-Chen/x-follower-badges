(() => {
  'use strict';
  const states = new Map();
  let enabled = true, timer, active;
  const handle = text => /^[A-Za-z0-9_]{1,15}$/.test(text || '') ? text.toLowerCase() : null;
  function author(row) {
    const names = [...row.querySelectorAll('a[href]')].map(a => {
      try { return handle(new URL(a.href).pathname.match(/^\/([^/]+)\/?$/)?.[1]); } catch { return null; }
    }).filter(Boolean);
    return names[0] || null;
  }
  const own = () => {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return link ? handle(new URL(link.href).pathname.slice(1)) : null;
  };
  function schedule() {
    if (!timer) timer = setTimeout(() => { timer = null; render(); }, 120);
  }
  function setState(name, state) { states.set(name, state); schedule(); }
  function nativeNotice(node) {
    let element = node.nodeType === 1 ? node : node.parentElement;
    if (!element?.isConnected || element.closest('article, .xfb-toast, .xfb-follow')) return;
    let match;
    for (let depth = 0; element && depth < 6 && element.tagName !== 'BODY'; depth++, element = element.parentElement) {
      const text = element.textContent.trim();
      match = text.match(/^(你取消关注了|你关注了|You unfollowed|You followed)\s*@([A-Za-z0-9_]{1,15})[。.！!]?$/i);
      if (match) break;
    }
    if (!match) return;
    const name = match[2].toLowerCase();
    const following = /^(你关注了|You followed)$/i.test(match[1]);
    const state = { ...states.get(name), following, requested: false, error: undefined, lastConfirmedAt: Date.now() };
    setState(name, state);
    if (active?.name === name && active.sent && following !== active.unfollow) active.result = state;
  }
  function render() {
    if (!enabled) { document.querySelectorAll('.xfb-follow').forEach(e => e.remove()); return; }
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const row = article.querySelector('[data-testid="User-Name"]');
      const name = row && author(row);
      const buttons = [...article.querySelectorAll('.xfb-follow')];
      let button = buttons.shift(); buttons.forEach(e => e.remove());
      if (!name || name === own()) { button?.remove(); continue; }
      if (button?.dataset.handle !== name) { button?.remove(); button = null; }
      if (!button) {
        button = document.createElement('button');
        button.type = 'button'; button.className = 'xfb-follow'; button.dataset.handle = name;
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          if (event.isTrusted) follow(article, row, name);
        });
      }
      const badge = row.querySelector('.xfb-badge');
      const column = getComputedStyle(row).flexDirection.startsWith('column');
      const mount = badge || row.firstElementChild;
      if (badge || !column) {
        if (mount && mount.nextElementSibling !== button) mount.after(button);
      } else if (mount && button.parentElement !== mount) mount.appendChild(button);
      const state = states.get(name) || {};
      const busy = active?.name === name;
      const label = busy ? (active.unfollow ? '取关中…' : '关注中…') : state.following ? (state.followedBy === true ? '互关' : '已关注') : state.requested ? '已申请' : '＋关注';
      if (button.textContent !== label) button.textContent = label;
      button.disabled = Boolean(active || state.requested);
      button.dataset.state = state.following || state.requested ? 'done' : busy ? 'busy' : 'ready';
      button.dataset.mutual = String(state.following === true && state.followedBy === true);
      button.title = state.error || (state.following ? `点击取消关注 @${name}` : `在时间线关注 @${name}`);
      button.setAttribute('aria-label', `${label} @${name}${state.following && !busy ? '，点击取消关注' : ''}`);
    }
  }
  function notify(text) {
    let toast = document.querySelector('.xfb-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'xfb-toast'; toast.setAttribute('role', 'status'); (document.body || document.documentElement).appendChild(toast); }
    toast.textContent = text;
    clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.remove(), 5000);
  }
  function waitFor(fn, ms) {
    return new Promise((resolve, reject) => {
      let interval;
      const check = () => { const value = fn(); if (value) { clearInterval(interval); clearTimeout(timeout); resolve(value); } };
      const timeout = ms == null ? null : setTimeout(() => { clearInterval(interval); reject(new Error('timeout')); }, ms);
      interval = setInterval(check, 80); check();
    });
  }
  function menuAction(name) {
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      const text = item.textContent.replace(/\s+/g, ' ').trim();
      const target = text.match(/@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/);
      if (!target || target[1].toLowerCase() !== name) continue;
      if (/^(取消关注|取消跟隨|取消追蹤|正在关注|Unfollow)\s*@/i.test(text)) return { item, following: true };
      if (/^(关注|關注|跟隨|追蹤|Follow)\s*@/i.test(text)) return { item, following: false };
    }
    return null;
  }
  async function unfollowResult(operation) {
    const next = await waitFor(() => operation.result || document.querySelector('[data-testid="confirmationSheetConfirm"]'), 10000);
    if (operation.result) return operation.result;
    const dialog = next.closest('[role="dialog"], [role="alertdialog"]') || next;
    let confirmed = false;
    const onConfirm = () => { confirmed = true; };
    next.addEventListener('click', onConfirm, { capture: true, once: true });
    // Leave the native confirmation entirely to the user, including Escape/cancel.
    try {
      await waitFor(() => operation.result || !dialog.isConnected, null);
      if (operation.result) return operation.result;
      if (!confirmed) return null;
      return await waitFor(() => operation.result, 10000);
    } finally { next.removeEventListener('click', onConfirm, true); }
  }
  async function follow(article, row, name) {
    if (active || states.get(name)?.requested) return;
    if (!article.isConnected || author(row) !== name) return;
    if (document.querySelector('[role="menu"], [data-testid="confirmationSheetConfirm"]')) { notify('请先关闭当前菜单或确认框，再操作。'); return; }
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret) { notify('暂时无法找到这条帖子的菜单，请使用 X 原生关注。'); return; }
    const operation = { name, sent: false, unfollow: states.get(name)?.following === true }; active = operation; schedule();
    if (operation.unfollow && !window.confirm(`确定取消关注 @${name} 吗？`)) { active = null; schedule(); return; }
    let opened = false;
    try {
      caret.click(); opened = true;
      const action = await waitFor(() => menuAction(name), 2500);
      if (!article.isConnected || author(row) !== name) throw new Error('recycled');
      if (action.following !== operation.unfollow) {
        setState(name, { ...states.get(name), following: action.following, requested: false, error: undefined });
        if (document.querySelector('[role="menu"]')) caret.click();
        opened = false;
        notify(action.following ? `你已经关注了 @${name}，再次点击可取消关注` : `你已不再关注 @${name}`);
      } else {
        operation.sent = true;
        action.item.click(); opened = false;
        const result = operation.unfollow ? await unfollowResult(operation) : await waitFor(() => operation.result, 10000);
        if (!result) return; // The user dismissed the native unfollow confirmation.
        if (operation.unfollow ? result.following !== false : (!result.following && !result.requested)) throw new Error('unconfirmed');
        setState(name, result);
        notify(operation.unfollow ? `已取消关注 @${name}` : result.requested ? `已向 @${name} 发送关注申请` : `已关注 @${name}`);
      }
    } catch {
      if (opened && document.querySelector('[role="menu"]') && caret.isConnected) caret.click();
      const error = operation.sent ? '尚未确认操作结果，请在 X 原生菜单检查状态后重试。' : '未找到该作者的关注入口，请使用 X 原生菜单。';
      setState(name, { ...states.get(name), error }); notify(error);
    } finally { if (active === operation) active = null; schedule(); }
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'x-follower-badges-v1') return;
    if (data.type === 'relationships' && Array.isArray(data.users) && data.users.length <= 500) {
      for (const u of data.users) {
        const name = handle(u?.name); if (!name) continue;
        const state = { ...states.get(name) };
        if (typeof u.following === 'boolean' && (data.confirmed || !state.lastConfirmedAt || Date.now() - state.lastConfirmedAt > 5000)) {
          if (state.following !== u.following || data.confirmed) {
            const toast = document.querySelector('.xfb-toast');
            if (state.error && toast?.textContent === state.error) toast.remove();
            state.error = undefined;
          }
          state.following = u.following;
        }
        if (typeof u.followedBy === 'boolean') state.followedBy = u.followedBy;
        if (typeof u.requested === 'boolean') state.requested = u.requested;
        if (data.confirmed && active?.name === name && active.sent) active.result = state;
        // A timeline request started before a follow may carry stale state.
        if (!active || active.name !== name || data.confirmed) states.set(name, state);
        if (states.size > 10000) states.delete(states.keys().next().value);
      }
      schedule();
    }
  });
  chrome.storage.local.get({ followEnabled: true }).then(s => { enabled = s.followEnabled; schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.followEnabled) { enabled = changes.followEnabled.newValue; schedule(); }
  });
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData' || record.type === 'childList') nativeNotice(record.target);
      for (const node of record.addedNodes || []) nativeNotice(node);
    }
    if (records.some(r => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.xfb-follow, .xfb-toast') &&
      !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && (n.classList.contains('xfb-follow') || n.classList.contains('xfb-toast')))))) schedule();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'], characterData: true });
  window.postMessage({ source: 'x-follower-badges-ui-v1', type: 'ready' }, location.origin);
  schedule();
})();
