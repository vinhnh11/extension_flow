// All orchestration lives in the side panel / workflow page; the worker only opens the UI.
// Browsers without the sidePanel API (some Chromium forks) get the same UI in a tab.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
} else {
  chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') }));
}

// Real (isTrusted) clicks for content scripts: Flow ignores synthetic ones. bp:attach comes first because
// the "debugging this browser" bar resizes the page, so the content script measures the button after it.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (!tabId || !['bp:attach', 'bp:click'].includes(msg.type)) return;
  const target = { tabId };
  const run = msg.type === 'bp:attach'
    ? chrome.debugger.attach(target, '1.3').catch(e => { if (!/already attached/i.test(e.message)) throw e; })
    : (async () => {
      try {
        const send = (type, extra) => chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type, x: msg.x, y: msg.y, ...extra });
        await send('mouseMoved');
        await send('mousePressed', { button: 'left', clickCount: 1 });
        await send('mouseReleased', { button: 'left', clickCount: 1 });
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
      }
    })();
  run.then(() => reply({ ok: true }), e => reply({ ok: false, error: e.message }));
  return true;
});
