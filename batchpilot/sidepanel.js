// Side panel: batch form, persistent queue runner, settings.
'use strict';
const { PROVIDERS, loadSettings, runJob, stopAll, download, sleep } = BPRunner;
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// ---------- tabs ----------
for (const b of document.querySelectorAll('[data-tab]')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('[data-tab]')) x.setAttribute('aria-selected', x === b);
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${b.dataset.tab}`;
  };
}
$('openWorkflow').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('workflow.html') });

// ---------- selector bug report: compact dump of the provider page's controls ----------
// Runs inside the page; must be self-contained.
function snapshotPage() {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const ATTRS = ['role', 'aria-label', 'aria-selected', 'aria-checked', 'aria-expanded', 'aria-haspopup', 'data-state', 'title', 'type', 'accept', 'multiple', 'disabled'];
  const desc = el => {
    const o = { tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 50), text: text(el) };
    for (const a of ATTRS) if (el.hasAttribute(a)) o[a] = el.getAttribute(a);
    return o;
  };
  const CTRL = 'button,[role=button],[role=tab],[role=radio],[role=menuitem],[role=option]';
  return {
    url: location.href.replace(/\?.*/, ''), viewport: [innerWidth, innerHeight],
    fileInputs: [...document.querySelectorAll('input[type=file]')].map(desc),
    editors: [...document.querySelectorAll('[contenteditable=true],textarea')].filter(vis).map(desc),
    popups: [...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper]')].filter(vis)
      .map(p => ({ ...desc(p), controls: [...p.querySelectorAll(CTRL)].filter(vis).slice(0, 40).map(desc) })),
    controls: [...document.querySelectorAll(CTRL)].filter(vis).slice(-80).map(desc),
  };
}
$('snapshot').onclick = async () => {
  const urls = Object.values(PROVIDERS).map(p => p.match);
  const tabs = await chrome.tabs.query({ url: urls });
  const tab = tabs.find(t => t.active) || tabs[0];
  if (!tab) { $('snapshotOut').value = 'Hãy mở trang Google Flow / ChatGPT / Grok trước'; return; }
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: snapshotPage });
    $('snapshotOut').value = JSON.stringify(result);
    await navigator.clipboard.writeText($('snapshotOut').value).then(() => { $('snapshotOut').value = `(đã copy) ${$('snapshotOut').value}`; }, () => {});
  } catch (e) {
    $('snapshotOut').value = `Không đọc được trang: ${e.message}`;
  }
};
// ---------- batch form ----------
const readDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

let refs = []; // data URLs
const renderRefs = () => $('refThumbs').replaceChildren(...refs.map(src => el('img', { src, alt: '' })));
$('refFiles').onchange = async e => {
  refs.push(...await Promise.all([...e.target.files].map(readDataUrl)));
  e.target.value = '';
  renderRefs();
};
$('clearRefs').onclick = () => { refs = []; renderRefs(); };

function syncProvider() {
  const p = $('provider').value;
  $('mediaTypeWrap').hidden = !PROVIDERS[p].video;
  $('flowHint').hidden = p !== 'flow';
}
$('provider').onchange = syncProvider;

const prompts = () => BPCore.splitPrompts($('prompts').value, $('splitMode').value);
const updateCount = () => { $('promptCount').textContent = `${prompts().length} prompt`; };
$('prompts').oninput = updateCount;
$('splitMode').onchange = updateCount;
$('importTxt').onclick = () => $('txtFile').click();
$('txtFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  $('prompts').value = await f.text();
  $('splitMode').value = 'line';
  e.target.value = '';
  updateCount();
};

// ---------- queue ----------
let queue = [];
const state = { running: false, paused: false, stop: false };
const save = () => chrome.storage.local.set({ bp_queue: queue });

$('enqueue').onclick = async () => {
  const list = prompts();
  if (!list.length) { $('promptCount').textContent = 'Chưa có prompt nào'; return; }
  const provider = $('provider').value;
  const settings = {
    mediaType: PROVIDERS[provider].video ? $('mediaType').value : 'image',
    ratio: $('ratio').value,
    count: Number($('count').value),
  };
  const batch = Date.now();
  list.forEach((prompt, i) => queue.push({
    id: `${batch}_${i}`, n: i + 1, provider, prompt, settings,
    images: BPCore.refsFor(i, refs, $('refMode').value),
    status: 'pending', tries: 0, error: '', results: [],
  }));
  await save();
  render();
  run();
};

const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
async function wait(sec) {
  const end = Date.now() + sec * 1000;
  while (Date.now() < end && !state.stop) await sleep(200);
}

async function run() {
  if (state.running) { state.paused = false; render(); return; }
  Object.assign(state, { running: true, paused: false, stop: false });
  render();
  try {
    const S = await loadSettings();
    for (;;) {
      if (state.stop) break;
      if (state.paused) { await sleep(400); continue; }
      const item = queue.find(i => i.status === 'pending');
      if (!item) break;
      await runItem(item, S);
      if (!state.stop && queue.some(i => i.status === 'pending')) await wait(rand(S.delayMin, S.delayMax));
    }
  } finally {
    state.running = false;
    render();
  }
}

async function runItem(item, S) {
  Object.assign(item, { status: 'running', error: '' });
  render();
  let media;
  try {
    media = await runJob(item.provider, { prompt: item.prompt, images: item.images, settings: item.settings });
    item.results = media.filter(m => m.url).map(({ url, type }) => ({ url, type }));
    item.status = 'done';
  } catch (e) {
    item.error = e.message;
    if (state.stop) item.status = 'pending'; // interrupted by Stop: run again next time
    else if (!e.message.startsWith('⛔') && ++item.tries <= S.maxRetries) {
      item.status = 'pending';
      queue.push(queue.splice(queue.indexOf(item), 1)[0]); // retry at the end of the queue
    } else item.status = 'failed';
  }
  if (media && S.autoDownload) {
    try {
      const dir = BPCore.safeFolder(`${S.folder}/${item.provider}`);
      const name = BPCore.buildFilename(S.template, { prompt: item.prompt, index: item.n, provider: item.provider });
      for (const [k, m] of media.entries()) await download(m, `${dir}/${name}${media.length > 1 ? `_${k + 1}` : ''}`);
    } catch (e) {
      item.error = `Tải về lỗi: ${e.message}`;
    }
  }
  await save();
  render();
}

$('run').onclick = run;
$('pause').onclick = () => { state.paused = !state.paused; render(); };
$('stop').onclick = () => { state.stop = true; stopAll(); render(); };
$('retryFailed').onclick = async () => {
  for (const i of queue) if (i.status === 'failed') Object.assign(i, { status: 'pending', tries: 0, error: '' });
  await save();
  render();
};
$('clearDone').onclick = async () => { queue = queue.filter(i => i.status !== 'done'); await save(); render(); };
$('clearAll').onclick = async () => { queue = []; await save(); render(); };
$('queue').onclick = async e => {
  const id = e.target.closest('.del')?.dataset.id;
  if (!id) return;
  queue = queue.filter(i => i.id !== id || i.status === 'running');
  await save();
  render();
};

const ICON = { pending: '•', running: '⟳', done: '✓', failed: '✕' };
function itemEl(i) {
  const thumbs = el('div', { className: 'thumbs' }, ...i.results.map((r, k) => {
    const link = el('a', { href: r.url, target: '_blank', title: r.url, textContent: r.type === 'video' ? `🎬 video ${k + 1}` : '' });
    if (r.type !== 'video') {
      const img = el('img', { src: r.url, alt: `ảnh ${k + 1}` });
      img.onerror = () => img.replaceWith(`ảnh ${k + 1}`);
      link.append(img);
    }
    return link;
  }));
  const del = el('button', { className: 'del', title: 'Xóa', textContent: '✕' });
  del.dataset.id = i.id;
  del.setAttribute('aria-label', 'Xóa khỏi hàng đợi');
  return el('li', {},
    el('div', { className: 'head' },
      el('span', { className: `s-${i.status}`, textContent: `${ICON[i.status]} #${i.n} · ${PROVIDERS[i.provider].label}${i.tries ? ` · thử lại ${i.tries}` : ''}` }),
      del),
    el('div', { className: 'prompt', title: i.prompt, textContent: i.prompt }),
    i.error ? el('div', { className: 'err', textContent: i.error }) : '',
    thumbs);
}

function render() {
  const count = s => queue.filter(i => i.status === s).length;
  $('stats').textContent = queue.length ? `${count('done')}/${queue.length} xong · ${count('failed')} lỗi` : '';
  $('run').disabled = state.running && !state.paused;
  $('pause').textContent = state.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
  $('pause').disabled = !state.running;
  $('stop').disabled = !state.running;
  $('clearAll').disabled = state.running;
  $('queue').replaceChildren(...queue.map(itemEl));
}

// ---------- settings ----------
async function fillSettings() {
  const s = await loadSettings();
  for (const f of $('settingsForm').elements) {
    if (!f.name) continue;
    if (f.type === 'checkbox') f.checked = !!s[f.name];
    else f.value = s[f.name] ?? '';
  }
}
$('settingsForm').onsubmit = async e => {
  e.preventDefault();
  const out = {};
  for (const f of e.target.elements) {
    if (!f.name) continue;
    out[f.name] = f.type === 'checkbox' ? f.checked : f.type === 'number' ? Number(f.value) : f.value.trim();
  }
  if (out.selectors) {
    try { JSON.parse(out.selectors); } catch { $('savedMsg').textContent = 'Selector JSON không hợp lệ'; return; }
  }
  out.delayMax = Math.max(out.delayMin, out.delayMax);
  await chrome.storage.local.set({ bp_settings: out });
  $('savedMsg').textContent = 'Đã lưu';
};

// ---------- init ----------
(async () => {
  const { bp_queue = [] } = await chrome.storage.local.get('bp_queue');
  // A job that was running when the panel closed never finished.
  queue = bp_queue.map(i => (i.status === 'running' ? { ...i, status: 'pending' } : i));
  syncProvider();
  updateCount();
  render();
  fillSettings();
})();
