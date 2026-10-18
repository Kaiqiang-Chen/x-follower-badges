(async () => {
  const enabled = document.querySelector('#enabled'), format = document.querySelector('#format');
  const settings = await chrome.storage.local.get({ enabled: true, format: 'compact', followEnabled: true });
  const followEnabled = document.querySelector('#followEnabled');
  followEnabled.checked = settings.followEnabled;
  followEnabled.addEventListener('change', () => chrome.storage.local.set({ followEnabled: followEnabled.checked }));
  enabled.checked = settings.enabled; format.value = settings.format;
  function preview() { document.querySelector('.preview span').textContent = format.value === 'exact' ? '粉丝 174,000' : '粉丝 17.4万'; }
  preview();
  enabled.addEventListener('change', () => chrome.storage.local.set({ enabled: enabled.checked }));
  format.addEventListener('change', () => { chrome.storage.local.set({ format: format.value }); preview(); });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    document.querySelector('#status').textContent = `已读取 ${status.users} 个账号 · 当前显示 ${status.badges} 个标签`;
  } catch (error) {
    const status = document.querySelector('#status');
    status.textContent = '未连接到页面脚本。请确认当前是 X 页面，并在更新插件后刷新页面。';
    status.title = error.message;
  }
})();
