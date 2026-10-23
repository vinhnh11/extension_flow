// Drives provider tabs from an extension page (side panel / workflow editor).
// Extension pages can use chrome.tabs/scripting/downloads directly and live as long as they are open,
// so long generations don't depend on the service worker staying alive.
(function (root) {
  'use strict';

  const PROVIDERS = {
    flow: { label: 'Google Flow', match: 'https://flow.google.com/*', home: 'https://flow.google.com/', fresh: false, script: 'content/flow.js', video: true },
    chatgpt: { label: 'ChatGPT', match: 'https://chatgpt.com/*', home: 'https://chatgpt.com/', fresh: true, script: 'content/chatgpt.js', video: false },
    grok: { label: 'Grok', match: 'https://grok.com/*', home: 'https://grok.com/imagine', fresh: true, script: 'content/grok.js', video: true },
  };

  const DEFAULTS = {
    delayMin: 3, delayMax: 10, maxRetries: 2,
    autoDownload: true, folder: 'batchpilot', template: '[Date]_[Prompt]_[Index]',
    timeoutImage: 300, timeoutVideo: 600,
    chatgptPrefix: 'Generate an image: ',
    telegramToken: '',
    selectors: '',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function loadSettings() {
    const { bp_settings } = await chrome.storage.local.get('bp_settings');
    return { ...DEFAULTS, ...bp_settings };
  }

  async function findTab(provider) {
    const P = PROVIDERS[provider];
    const tabs = await chrome.tabs.query({ url: P.match });
    // Flow needs an open project; prefer such a tab.
    const tab = tabs.find(t => provider !== 'flow' || t.url.includes('/project/')) || tabs[0];
    return tab || chrome.tabs.create({ url: P.home, active: true });
  }

  function navigate(tabId, url) {
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); };
      const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') { done(); resolve(); } };
      const timer = setTimeout(() => { done(); reject(new Error('Trang tải quá lâu')); }, 60000);
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.update(tabId, { url, active: true });
    });
  }

  // Tabs opened before the extension was installed/reloaded have no content script yet.
  async function ensureScript(tabId, P) {
    for (let i = 0; i < 30; i++) {
      try {
        if ((await chrome.tabs.sendMessage(tabId, { type: 'bp:ping' }))?.ok) return;
      } catch { /* not injected yet */ }
      if (i === 2) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content/common.js', P.script] }).catch(() => {});
      }
      await sleep(500);
    }
    throw new Error(`Không kết nối được với tab ${P.label}`);
  }

  // job: { prompt, images: [dataUrl], settings: { mediaType, count, ratio, prefix } }
  async function runJob(provider, job) {
    const P = PROVIDERS[provider];
    const s = await loadSettings();
    const settings = {
      timeoutMs: (job.settings.mediaType === 'video' ? s.timeoutVideo : s.timeoutImage) * 1000,
      prefix: provider === 'chatgpt' ? s.chatgptPrefix : '',
      ...job.settings,
    };
    const tab = await findTab(provider);
    // Generating sites throttle or pause hidden tabs, so bring the tab to the front.
    await chrome.tabs.update(tab.id, { active: true });
    if (P.fresh) await navigate(tab.id, P.home);
    await ensureScript(tab.id, P);
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'bp:run', job: { ...job, settings } });
    if (!res?.ok) throw new Error(res?.error || 'Job thất bại');
    if (!res.media.length) throw new Error('Không có kết quả');
    return res.media.map(m => ({ ...m, provider, tabId: tab.id }));
  }

  async function stopAll() {
    for (const P of Object.values(PROVIDERS)) {
      for (const t of await chrome.tabs.query({ url: P.match })) chrome.tabs.sendMessage(t.id, { type: 'bp:stop' }).catch(() => {});
    }
  }

  const blobToDataUrl = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  // Media -> data URL. Host permissions let the extension fetch with the user's cookies;
  // if that fails, ask the provider tab to fetch it in-page.
  async function toDataUrl(m) {
    if (m.dataUrl) return m.dataUrl;
    try {
      const r = await fetch(m.url, { credentials: 'include' });
      if (!r.ok) throw new Error(r.status);
      return (m.dataUrl = await blobToDataUrl(await r.blob()));
    } catch {
      const res = await chrome.tabs.sendMessage(m.tabId, { type: 'bp:fetch', url: m.url }).catch(() => null);
      if (!res?.ok) throw new Error('Không tải được media để dùng làm ảnh tham chiếu');
      return (m.dataUrl = res.dataUrl);
    }
  }

  function extOf(m) {
    const mime = (m.dataUrl || '').match(/^data:([^;,]+)/)?.[1];
    if (mime) return { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm' }[mime] || (mime.startsWith('video') ? 'mp4' : 'png');
    const ext = (m.url.match(/\.(png|jpe?g|webp|gif|mp4|webm)(?:[?#]|$)/i) || [])[1];
    return ext ? ext.toLowerCase().replace('jpeg', 'jpg') : (m.type === 'video' ? 'mp4' : 'png');
  }

  // path: "folder/sub/name" without extension.
  async function download(m, path) {
    const url = m.url || URL.createObjectURL(await (await fetch(m.dataUrl)).blob());
    await chrome.downloads.download({ url, filename: `${path}.${extOf(m)}`, conflictAction: 'uniquify', saveAs: false });
    if (!m.url) setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function sendTelegram(token, chatId, m, caption) {
    if (!token || !chatId) throw new Error('Thiếu Telegram bot token (Cài đặt) hoặc Chat ID');
    const blob = await (await fetch(await toDataUrl(m))).blob();
    const kind = m.type === 'video' ? 'video' : 'photo';
    const form = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', caption.slice(0, 1024));
    form.append(kind, blob, `media.${extOf(m)}`);
    const res = await (await fetch(`https://api.telegram.org/bot${token}/send${kind === 'video' ? 'Video' : 'Photo'}`, { method: 'POST', body: form })).json();
    if (!res.ok) throw new Error(`Telegram: ${res.description}`);
  }

  root.BPRunner = { PROVIDERS, DEFAULTS, loadSettings, runJob, stopAll, toDataUrl, download, sendTelegram, sleep };
})(globalThis);
