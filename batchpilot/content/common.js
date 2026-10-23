// DOM helpers shared by the provider content scripts (isolated world).
// Each provider script calls BP.register({ name, selectors, run }).
(() => {
  if (window.BP) return;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const visible = el => {
    if (!el || !el.isConnected) return false;
    if (el.type === 'file') return true; // file inputs are hidden on every site but still usable
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };

  // All visible matches of a selector list, in list order then document order.
  function findAll(sels, root = document) {
    const out = [];
    for (const sel of [].concat(sels || [])) {
      let els;
      try { els = root.querySelectorAll(sel); } catch { continue; } // bad user selector
      for (const el of els) if (visible(el) && !out.includes(el)) out.push(el);
    }
    return out;
  }
  const find = (sels, root) => findAll(sels, root)[0] || null;
  // Composers sit at the bottom of the page; take the last match of the first selector that hits.
  function findLast(sels, root = document) {
    for (const sel of [].concat(sels || [])) {
      const els = findAll(sel, root);
      if (els.length) return els[els.length - 1];
    }
    return null;
  }

  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelsOf = el => [el.getAttribute('aria-label'), el.title, textOf(el)].filter(Boolean);
  const CLICKABLE = 'button,[role=button],[role=tab],[role=radio],[role=option],[role=menuitem],[role=menuitemradio]';
  // Last visible clickable whose aria-label, title or text matches.
  const findByText = (re, sel = CLICKABLE) =>
    [...document.querySelectorAll(sel)].filter(el => visible(el) && labelsOf(el).some(t => re.test(t))).pop() || null;

  const enabled = el => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const isOn = el => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true'
    || el.getAttribute('aria-pressed') === 'true' || ['active', 'checked', 'on'].includes(el.dataset.state);

  // Best-effort setting: click the tab/radio/option whose label matches, unless already selected.
  async function pickOption(re) {
    const el = findByText(re);
    if (!el) return false;
    if (!isOn(el)) { click(el); await sleep(500); }
    return true;
  }

  async function waitFor(fn, timeout = 15000, every = 250) {
    const end = Date.now() + timeout;
    for (;;) {
      if (BP.stopped) throw new Error('Đã dừng');
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(every);
    }
  }

  function click(el) {
    el.scrollIntoView({ block: 'center' });
    const o = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }

  // Ask page-click.js (MAIN world, Flow only) to run the element's own click listeners with isTrusted=true.
  // Resolves to how many listeners ran; 0 when the script isn't there or found none.
  function pageClick(el) {
    return new Promise(resolve => {
      const done = invoked => { window.removeEventListener('message', onMsg); el.removeAttribute('data-bp-click'); resolve(invoked); };
      const onMsg = e => { if (e.source === window && e.data?.type === 'bp:page-click:done') done(e.data.invoked); };
      window.addEventListener('message', onMsg);
      el.setAttribute('data-bp-click', '');
      window.postMessage({ type: 'bp:page-click' }, location.origin);
      setTimeout(() => done(0), 1000);
    });
  }

  // A click the page treats as the user's: its own handlers with isTrusted=true (works in hidden tabs), else real
  // mouse input via the background's debugger session (needs a visible tab), else a synthetic click.
  // Returns how it clicked, for error messages.
  async function trustedClick(el) {
    if (await pageClick(el)) return 'click qua handler của trang';
    const attach = await chrome.runtime.sendMessage({ type: 'bp:attach' }).catch(e => ({ error: e.message }));
    let res = attach;
    if (attach?.ok) {
      await sleep(400); // let the debugger bar settle the layout before measuring
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      res = await chrome.runtime.sendMessage({ type: 'bp:click', x: r.left + r.width / 2, y: r.top + r.height / 2 }).catch(e => ({ error: e.message }));
      if (res?.ok) return 'click thật';
    }
    click(el);
    return `click giả (${res?.error || 'debugger không phản hồi'})`;
  }

  // Short element description for error messages, so a screenshot shows what was matched.
  const describe = el => el ? `<${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? ` aria-label="${el.getAttribute('aria-label')}"` : ''}> "${textOf(el).slice(0, 30)}"` : 'không tìm thấy';

  function pressEnter(el) {
    el.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  const squash = s => (s || '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, '');
  const isField = el => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  const valueOf = el => (isField(el) ? el.value : el.innerText);

  function clearEditable(el) {
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
  }

  // Put text into a textarea or a rich-text editor (ProseMirror/Lexical/Tiptap) so the
  // page's framework sees it. Returns true once the editor holds the text.
  async function setText(el, text) {
    if (isField(el)) {
      // React-controlled fields ignore plain .value writes; use the native setter.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      el.focus();
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      return squash(el.value) === squash(text);
    }
    const attempts = [
      () => {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
      () => document.execCommand('insertText', false, text),
    ];
    for (const attempt of attempts) {
      clearEditable(el);
      attempt();
      await sleep(300);
      if (squash(el.innerText) === squash(text)) return true;
    }
    return false;
  }

  function dataUrlToFile(dataUrl, i = 0) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const sub = mime.split('/')[1] || 'png';
    return new File([bytes], `ref_${i + 1}.${{ jpeg: 'jpg', quicktime: 'mov', 'x-matroska': 'mkv' }[sub] || sub}`, { type: mime });
  }

  // Does this file input take the file? accept looks like "image/*,video/mp4,.mov".
  const accepts = (input, f) => !input.accept || input.accept.split(',').map(t => t.trim().toLowerCase())
    .some(t => t === f.type || (t.endsWith('/*') && f.type.startsWith(t.slice(0, -1))) || (t.startsWith('.') && f.name.toLowerCase().endsWith(t)));

  // Each file goes, one at a time, to a file <input> that accepts its type (the preferred one first);
  // files no input takes are pasted onto the editor. Returns how they went in, for error messages.
  async function attachFiles(files, { input, editor }) {
    const inputs = [...new Set([input, ...document.querySelectorAll('input[type=file]')])].filter(Boolean);
    const via = new Set(), leftover = new DataTransfer();
    for (const f of files) {
      const target = inputs.find(i => accepts(i, f));
      if (!target) { leftover.items.add(f); continue; }
      const dt = new DataTransfer();
      dt.items.add(f);
      target.files = dt.files;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      via.add('input');
      await sleep(800);
    }
    if (leftover.files.length && editor) {
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: leftover, bubbles: true, cancelable: true }));
      via.add('paste');
    }
    return [...via].join('+');
  }

  // Attach reference images/videos (data URLs) and wait until their thumbnails have shown up and settled,
  // so a late upload tile is not mistaken for a result.
  async function attachRefs(refs, { input, editor }) {
    if (!refs?.length) return;
    // ponytail: any new <img>/<video> on the page counts as a thumbnail; the composer box guess was too narrow on Flow.
    const count = () => document.querySelectorAll('img,video').length;
    const before = count();
    const files = refs.map(dataUrlToFile);
    const via = await attachFiles(files, { input, editor });
    if (!via) throw new Error('Không tìm thấy chỗ đính kèm ảnh/video');
    const hasVideo = files.some(f => f.type.startsWith('video/'));
    await waitFor(() => count() >= before + files.length, hasVideo ? 90000 : 20000, 400);
    if (count() <= before) throw new Error(`Không đính kèm được ảnh/video tham chiếu (cách: ${via}, input: ${describe(input)})`);
    let last = count();
    await waitFor(async () => { await sleep(2000); const now = count(); const stable = now === last; last = now; return stable; }, 30000, 0);
  }

  // Click the send button once it is enabled (Enter as fallback) and confirm the page took it:
  // the editor empties, gets re-rendered, or a generation starts.
  async function submit(editor, findButton, isBusy = () => false, enableTimeout = 30000) {
    const btn = await waitFor(() => { const b = findButton(); return enabled(b) && b; }, enableTimeout, 300);
    const how = btn ? await trustedClick(btn) : (pressEnter(editor), 'Enter');
    const sent = () => !editor.isConnected || !squash(valueOf(editor)) || isBusy();
    if (await waitFor(sent, 10000, 300)) return;
    pressEnter(editor);
    if (!await waitFor(sent, 6000, 300)) {
      const hidden = document.hidden ? '; tab Flow đang bị ẩn/che, hãy để cửa sổ Flow hiển thị' : '';
      throw new Error(`Không gửi được prompt (nút gửi: ${describe(btn || findButton())}, ${how}${hidden})`);
    }
  }

  // Leaf element showing a progress percentage ("42%") = something is still generating.
  const hasProgress = () => [...document.querySelectorAll('span,div')]
    .some(e => e.childElementCount === 0 && /^\d{1,3}\s?%$/.test(e.textContent.trim()) && visible(e));

  // Every <img>/<video> the provider filter accepts, keyed by key(url).
  function scanMedia(accept, key = u => u) {
    const out = new Map();
    for (const el of document.querySelectorAll('img,video')) {
      const src = el.currentSrc || el.src || el.querySelector?.('source')?.src;
      if (!src) continue;
      const type = el.tagName === 'IMG' ? 'image' : 'video';
      if (accept(el, src, type)) out.set(key(src), { url: src, type });
    }
    return out;
  }

  // Poll until media not in `baseline` reach `expected` and stop changing for `settleMs`.
  // Fails early when nothing is generating and nothing new appeared for `idleFailMs`.
  async function waitForNewMedia({ baseline, accept, key, expected = 1, timeoutMs = 300000,
    settleMs = 4000, idleFailMs = 90000, isBusy = () => false, checkError = () => null }) {
    const start = Date.now();
    let last = '', changedAt = start, busyAt = start;
    const fresh = () => [...scanMedia(accept, key).entries()].filter(([k]) => !baseline.has(k)).map(([, m]) => m);
    while (Date.now() - start < timeoutMs) {
      if (BP.stopped) throw new Error('Đã dừng');
      const err = checkError();
      if (err) throw new Error(err);
      const now = Date.now(), busy = isBusy(), found = fresh();
      if (busy) busyAt = now;
      const sig = found.map(m => m.url).join('|');
      if (sig !== last) { last = sig; changedAt = now; }
      const quiet = !busy && now - changedAt >= settleMs;
      if (found.length >= expected && quiet) return found;
      // Fewer than expected but nothing has moved for a long while: return what we got.
      if (found.length && quiet && now - changedAt >= settleMs * 5) return found;
      if (!found.length && now - busyAt > idleFailMs) {
        throw new Error('Không thấy kết quả (có thể bị từ chối do policy/quota, hoặc selector đã đổi)');
      }
      await sleep(700);
    }
    const found = fresh();
    if (found.length) return found;
    throw new Error('Hết thời gian chờ kết quả');
  }

  const blobToDataUrl = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const fetchDataUrl = async url => blobToDataUrl(await (await fetch(url, { credentials: 'include' })).blob());

  // blob: URLs only live in this page, so convert them before handing results back.
  async function portable(m) {
    if (m.url.startsWith('data:')) return { ...m, dataUrl: m.url, url: '' };
    if (m.url.startsWith('blob:')) return { ...m, dataUrl: await fetchDataUrl(m.url), url: '' };
    return m;
  }

  async function selectorsFor(provider) {
    const { bp_settings: s } = await chrome.storage.local.get('bp_settings');
    let custom = {};
    try { custom = JSON.parse(s?.selectors || '{}')[provider.name] || {}; } catch { /* invalid JSON: ignore */ }
    return { ...provider.selectors, ...custom };
  }

  function register(provider) {
    if (BP.provider) return; // script injected twice (manifest + executeScript)
    BP.provider = provider.name;
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg.type === 'bp:ping') { reply({ ok: true, provider: provider.name }); return; }
      if (msg.type === 'bp:stop') { BP.stopped = true; return; }
      if (msg.type === 'bp:fetch') {
        fetchDataUrl(msg.url).then(dataUrl => reply({ ok: true, dataUrl }), e => reply({ ok: false, error: e.message }));
        return true;
      }
      if (msg.type !== 'bp:run') return;
      if (BP.busy) { reply({ ok: false, error: 'Tab này đang chạy một job khác' }); return; }
      BP.busy = true;
      BP.stopped = false;
      (async () => {
        const media = await provider.run(msg.job, await selectorsFor(provider));
        return Promise.all(media.map(portable));
      })()
        .then(media => reply({ ok: true, media }), e => reply({ ok: false, error: String(e?.message || e) }))
        .finally(() => { BP.busy = false; });
      return true;
    });
  }

  window.BP = {
    stopped: false, busy: false,
    sleep, visible, find, findAll, findLast, findByText, pickOption, textOf, enabled, isOn, waitFor, click, pressEnter,
    setText, attachRefs, submit, hasProgress, scanMedia,
    waitForNewMedia, register,
  };
})();
