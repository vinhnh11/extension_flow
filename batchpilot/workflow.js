// Node workflow editor (Drawflow canvas) + executor.
// Data keys are lowercase on purpose: HTML lowercases df-* attribute names and Drawflow binds by them.
'use strict';
const $ = id => document.getElementById(id);
const { PROVIDERS } = BPRunner;

// ---------- node types ----------
const RATIOS = ['', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const select = (key, opts) => `<select df-${key}>${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
const generator = video => `
  <textarea df-prompt rows="4" placeholder="Prompt. Để trống = lấy text từ node Prompt nối vào. @slug để chèn text/ảnh"></textarea>
  <div class="opts">
    ${video ? select('mediatype', [['image', 'Ảnh'], ['video', 'Video']]) : ''}
    ${select('ratio', RATIOS.map(r => [r, r || 'Tỉ lệ: auto']))}
    ${select('count', [1, 2, 3, 4].map(n => [n, `${n} kết quả`]))}
  </div>
  <div class="result thumbs"></div>`;

const TYPES = {
  image: { title: 'Ảnh tham chiếu', ins: 0, outs: 1, body: '<input type="file" accept="image/*" multiple class="pick" aria-label="Chọn ảnh"><div class="refs thumbs"></div><button class="clear-refs">Bỏ ảnh</button>' },
  video: { title: 'Video tham chiếu', ins: 0, outs: 1, body: '<input type="file" accept="video/*" multiple class="pick-video" aria-label="Chọn video"><div class="vids muted"></div><button class="clear-refs">Bỏ video</button><p class="muted">Nối vào node Flow: mỗi video tạo 1 lần. Video không được lưu cùng workflow.</p>' },
  prompt: { title: 'Prompt', ins: 0, outs: 1, body: '<textarea df-text rows="5" placeholder="Nội dung prompt… (@slug để chèn text của node Prompt khác)"></textarea>' },
  flow: { title: 'Google Flow', ins: 1, outs: 1, body: generator(true) },
  chatgpt: { title: 'ChatGPT', ins: 1, outs: 1, body: generator(false) },
  grok: { title: 'Grok', ins: 1, outs: 1, body: generator(true) },
  delay: { title: 'Chờ', ins: 1, outs: 1, body: '<label>Số giây <input type="number" min="1" max="300" df-seconds></label>' },
  download: { title: 'Tải về', ins: 1, outs: 0, body: '<label>Thư mục con <input df-folder placeholder="mặc định: tên workflow"></label>' },
  telegram: { title: 'Telegram', ins: 1, outs: 0, body: '<label>Chat ID <input df-chatid></label><label>Caption <input df-caption placeholder="mặc định: prompt"></label>' },
  note: { title: 'Ghi chú', ins: 0, outs: 0, body: '<textarea df-text rows="4" placeholder="Ghi chú…"></textarea>' },
};

const nodeHtml = type => `
  <div class="hdr">
    <span class="title">${TYPES[type].title}</span>
    ${type === 'note' ? '<span class="slug"></span>' : '<input class="slug" df-slug title="Slug — dùng @slug trong prompt" aria-label="Slug">'}
    <button class="toggle" title="Bật/tắt node" aria-label="Bật/tắt node">⏻</button>
  </div>
  <div class="body">${TYPES[type].body}</div>
  <div class="status"></div>`;

// ---------- editor ----------
const editor = new Drawflow($('drawflow'));
editor.start();

const nodeEl = id => document.getElementById(`node-${id}`);
const nodesData = () => editor.export().drawflow.Home.data;

function uniqueSlug(type) {
  const used = new Set(Object.values(nodesData()).map(n => n.data.slug));
  let i = 1;
  while (used.has(`${type}${i}`)) i++;
  return `${type}${i}`;
}

function addNode(type, x, y, extra = {}) {
  const T = TYPES[type];
  const data = { slug: type === 'note' ? '' : uniqueSlug(type), off: false, text: '', prompt: '', mediatype: 'image', ratio: '', count: '1', seconds: '3', folder: '', chatid: '', caption: '', refs: [], videonames: [], ...extra };
  return editor.addNode(type, T.ins, T.outs, x, y, type, data, nodeHtml(type));
}

// Drop new nodes near the middle of the visible canvas.
function addAtCenter(type) {
  const box = $('drawflow').getBoundingClientRect(), pre = editor.precanvas.getBoundingClientRect();
  const x = (box.left + box.width / 2 - 130 - pre.left) / editor.zoom + Math.random() * 40;
  const y = (box.top + box.height / 3 - pre.top) / editor.zoom + Math.random() * 40;
  addNode(type, x, y);
}

for (const [type, T] of Object.entries(TYPES)) {
  const b = Object.assign(document.createElement('button'), { textContent: `+ ${T.title}` });
  b.onclick = () => addAtCenter(type);
  $('palette').append(b);
}
$('palette').insertAdjacentHTML('beforeend', '<p>Kéo từ chấm phải sang chấm trái để nối. Bấm vào đường nối để xóa. Delete để xóa node. Ctrl+lăn chuột để zoom.</p>');

// Things Drawflow's df-* binding doesn't cover: on/off toggle and reference image/video files.
// Videos stay in memory (too big for storage/JSON export); only their names are saved.
const videoFiles = new Map(); // node id -> [File]
const idOf = target => target.closest('.drawflow-node')?.id.slice(5);
function patchData(id, patch) {
  editor.updateNodeDataFromId(id, { ...editor.getNodeFromId(id).data, ...patch });
}
function paintNode(id) {
  const { data } = editor.getNodeFromId(id);
  nodeEl(id).classList.toggle('off', !!data.off);
  const refs = nodeEl(id).querySelector('.refs');
  if (refs) refs.replaceChildren(...(data.refs || []).map(src => Object.assign(new Image(), { src, alt: '' })));
  const vids = nodeEl(id).querySelector('.vids');
  if (vids) {
    const missing = (data.videonames || []).length && !videoFiles.get(id)?.length;
    vids.textContent = (data.videonames || []).join(', ') + (missing ? ' — chọn lại video' : '');
  }
}
$('drawflow').addEventListener('click', e => {
  const id = idOf(e.target);
  if (!id) return;
  if (e.target.closest('.toggle')) { patchData(id, { off: !editor.getNodeFromId(id).data.off }); paintNode(id); }
  if (e.target.closest('.clear-refs')) { videoFiles.delete(id); patchData(id, { refs: [], videonames: [] }); paintNode(id); }
});
const readDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});
$('drawflow').addEventListener('change', async e => {
  if (e.target.matches('.pick-video')) {
    const id = idOf(e.target);
    const files = [...(videoFiles.get(id) || []), ...e.target.files];
    e.target.value = '';
    videoFiles.set(id, files);
    patchData(id, { videonames: files.map(f => f.name) });
    paintNode(id);
    return;
  }
  if (!e.target.matches('.pick')) return;
  const id = idOf(e.target);
  const added = await Promise.all([...e.target.files].map(readDataUrl));
  e.target.value = '';
  patchData(id, { refs: [...(editor.getNodeFromId(id).data.refs || []), ...added] });
  paintNode(id);
});

$('zoomIn').onclick = () => editor.zoom_in();
$('zoomOut').onclick = () => editor.zoom_out();
$('zoomReset').onclick = () => editor.zoom_reset();

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), 3000);
}

// ---------- save / load ----------
let currentId = null;
const allWorkflows = async () => (await chrome.storage.local.get('bp_workflows')).bp_workflows || {};

async function refreshList() {
  const all = await allWorkflows();
  $('wfList').replaceChildren(
    new Option('— Mở workflow đã lưu —', ''),
    ...Object.entries(all).sort((a, b) => b[1].updated - a[1].updated).map(([id, w]) => new Option(w.name, id, false, id === currentId)));
}

function load(graph, name, id = null) {
  videoFiles.clear();
  editor.import(graph);
  currentId = id;
  $('wfName').value = name;
  Object.keys(nodesData()).forEach(paintNode);
}

$('wfSave').onclick = async () => {
  const all = await allWorkflows();
  currentId ||= `wf_${Date.now()}`;
  all[currentId] = { name: $('wfName').value.trim() || 'Workflow', graph: editor.export(), updated: Date.now() };
  await chrome.storage.local.set({ bp_workflows: all });
  refreshList();
  toast('Đã lưu');
};
$('wfList').onchange = async e => {
  const w = (await allWorkflows())[e.target.value];
  if (w) load(w.graph, w.name, e.target.value);
};
$('wfNew').onclick = () => { editor.clear(); videoFiles.clear(); currentId = null; $('wfName').value = 'Workflow mới'; refreshList(); };
$('wfDelete').onclick = async () => {
  if (!currentId) return toast('Workflow này chưa được lưu');
  const all = await allWorkflows();
  delete all[currentId];
  await chrome.storage.local.set({ bp_workflows: all });
  $('wfNew').onclick();
  toast('Đã xóa');
};
$('wfExport').onclick = () => {
  const name = $('wfName').value.trim() || 'workflow';
  const blob = new Blob([JSON.stringify({ type: 'batchpilot-workflow', version: 1, name, graph: editor.export() }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${BPCore.buildFilename('[Prompt]', { prompt: name })}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('wfImport').onclick = () => $('wfImportFile').click();
$('wfImportFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  try {
    const j = JSON.parse(await f.text());
    if (j.type !== 'batchpilot-workflow' || !j.graph?.drawflow) throw new Error();
    load(j.graph, j.name || 'Workflow nhập');
    toast('Đã nhập — bấm Lưu để giữ lại');
  } catch {
    toast('File không phải workflow BatchPilot');
  }
};

// ---------- executor ----------
let running = false, stopFlag = false;
const mediaKey = m => m.url || m.dataUrl;

function setStatus(id, state, msg = '') {
  const n = nodeEl(id);
  n.classList.remove('st-run', 'st-done', 'st-fail', 'st-skip');
  if (state) n.classList.add(`st-${state}`);
  n.querySelector('.status').textContent = msg;
}

function showResult(id, media) {
  const box = nodeEl(id).querySelector('.result');
  box.replaceChildren(...media.map(m => {
    const v = m.type === 'video'
      ? Object.assign(document.createElement('video'), { muted: true, controls: true })
      : Object.assign(new Image(), { alt: 'kết quả' });
    v.src = m.url || m.dataUrl;
    // Some CDNs refuse extension-page embeds; fall back to a data URL.
    v.onerror = () => { v.onerror = null; BPRunner.toDataUrl(m).then(u => { v.src = u; }).catch(() => {}); };
    return v;
  }));
}

async function waitSeconds(sec) {
  const end = Date.now() + sec * 1000;
  while (Date.now() < end && !stopFlag) await BPRunner.sleep(200);
}

async function execNode(n, { out, bySlug, S }) {
  const d = n.data;
  const upstream = n.edges.map(id => out[id]).filter(r => r?.status === 'done');
  const upMedia = upstream.flatMap(r => r.media || []);
  const upText = upstream.map(r => r.text).filter(Boolean).join('\n\n');
  const bySlugResult = s => (bySlug[s] && out[bySlug[s].id]?.status === 'done' ? out[bySlug[s].id] : null);

  switch (n.type) {
    case 'prompt':
      return { text: BPCore.resolveMentions(d.text, s => bySlugResult(s)?.text) };

    case 'image':
      if (!d.refs?.length) throw new Error('Chưa chọn ảnh');
      return { media: d.refs.map(dataUrl => ({ url: '', dataUrl, type: 'image' })) };

    case 'video': {
      const files = videoFiles.get(n.id) || [];
      if (!files.length) throw new Error(d.videonames?.length ? 'Chọn lại video (video không được lưu cùng workflow)' : 'Chưa chọn video');
      // Files travel to the Flow tab as one extension message, which has a size cap.
      const big = files.find(f => f.size > 45e6);
      if (big) throw new Error(`${big.name} quá lớn (>45 MB), hãy cắt ngắn video`);
      return { media: await Promise.all(files.map(async f => ({ url: '', dataUrl: await readDataUrl(f), type: 'video', name: f.name }))) };
    }

    case 'flow': case 'chatgpt': case 'grok': {
      // References: everything wired in + every node/result mentioned with @slug. Only Flow takes videos.
      const refs = [];
      const add = m => {
        if ((m.type === 'image' || (m.type === 'video' && n.type === 'flow')) && !refs.some(r => mediaKey(r) === mediaKey(m))) refs.push(m);
      };
      upMedia.forEach(add);
      BPCore.mentions(d.prompt).forEach(s => (bySlugResult(s)?.media || []).forEach(add));
      const images = refs.filter(m => m.type === 'image');
      let prompt = BPCore.resolveMentions(d.prompt, s => {
        const r = bySlugResult(s);
        if (!r) return null;
        if (r.text != null) return r.text;
        return (r.media || []).map(m => (m.type === 'video' ? '[video]'
          : `[image ${images.findIndex(x => mediaKey(x) === mediaKey(m)) + 1}]`)).join(' ');
      });
      if (!prompt) prompt = upText;
      if (!prompt) throw new Error('Chưa có prompt (nhập vào node hoặc nối node Prompt vào)');
      // Motion control: one generation per reference video, each with all the images.
      const jobs = BPCore.refJobs(refs), media = [], errors = [];
      for (const [k, set] of jobs.entries()) {
        if (stopFlag) break;
        const tag = jobs.length > 1 ? `Video ${k + 1}/${jobs.length}` : '';
        if (tag) setStatus(n.id, 'run', `${tag}…`);
        try {
          const got = await BPRunner.runJob(n.type, {
            prompt, images: await Promise.all(set.map(BPRunner.toDataUrl)),
            settings: { mediaType: PROVIDERS[n.type].video ? d.mediatype : 'image', ratio: d.ratio, count: Number(d.count) || 1 },
          });
          got.forEach(m => { m.prompt = prompt; m.source = set.find(r => r.type === 'video')?.name; });
          media.push(...got);
          showResult(n.id, media);
        } catch (e) {
          if (jobs.length === 1) throw e;
          errors.push(`${tag} (${set.at(-1).name}): ${e.message}`);
        }
      }
      if (!media.length) throw new Error(errors.join(' | ') || 'Không có kết quả');
      return { media, warn: errors.join(' | ') };
    }

    case 'delay':
      await waitSeconds(Number(d.seconds) || 3);
      return { media: upMedia, text: upText };

    case 'download': {
      if (!upMedia.length) throw new Error('Không có media để tải');
      const dir = BPCore.safeFolder(`${S.folder}/${d.folder || $('wfName').value || 'workflow'}`);
      for (const [k, m] of upMedia.entries()) {
        // Motion control results are named after their source video rather than the long prompt.
        const label = m.source ? m.source.replace(/\.[^.]+$/, '') : m.prompt || upText;
        const name = BPCore.buildFilename(S.template, { prompt: label, index: k + 1, node: d.slug, provider: m.provider || '' });
        await BPRunner.download(m, `${dir}/${name}`);
      }
      return {};
    }

    case 'telegram':
      if (!upMedia.length) throw new Error('Không có media để gửi');
      for (const m of upMedia) await BPRunner.sendTelegram(S.telegramToken, d.chatid, m, d.caption || m.prompt);
      return {};
  }
  return {};
}

async function runWorkflow() {
  if (running) return;
  running = true;
  stopFlag = false;
  $('wfRun').disabled = true;
  $('wfStop').disabled = false;
  try {
    const S = await BPRunner.loadSettings();
    const nodes = {};
    for (const [id, n] of Object.entries(nodesData())) {
      const edges = Object.values(n.inputs || {}).flatMap(i => i.connections.map(c => String(c.node)));
      nodes[id] = { id, type: n.name, data: n.data, edges, deps: [...edges] };
    }
    const bySlug = {};
    for (const n of Object.values(nodes)) if (n.data.slug) bySlug[n.data.slug] = n;
    // An @mention is a dependency even without a wire.
    for (const n of Object.values(nodes)) {
      for (const s of BPCore.mentions(n.data.prompt || n.data.text)) if (bySlug[s] && bySlug[s] !== n) n.deps.push(bySlug[s].id);
    }
    const order = BPCore.topoOrder(nodes);
    Object.keys(nodes).forEach(id => setStatus(id, ''));
    const out = {};
    // ponytail: nodes run one at a time; parallel branches on different providers would be faster.
    for (const id of order) {
      if (stopFlag) break;
      const n = nodes[id];
      if (n.type === 'note') continue;
      if (n.data.off) { out[id] = { status: 'off' }; setStatus(id, '', 'Đã tắt — bỏ qua'); continue; }
      // Disabled upstream nodes are ignored; failed/skipped ones block this node.
      if (n.deps.some(dep => out[dep] && out[dep].status !== 'off' && out[dep].status !== 'done')) {
        out[id] = { status: 'skip' };
        setStatus(id, 'skip', 'Bỏ qua vì node phía trước lỗi');
        continue;
      }
      setStatus(id, 'run', 'Đang chạy…');
      try {
        out[id] = { status: 'done', ...(await execNode(n, { out, bySlug, S })) };
        setStatus(id, 'done', out[id].warn ? `Xong, một số lỗi: ${out[id].warn}` : 'Xong');
      } catch (e) {
        out[id] = { status: 'fail' };
        setStatus(id, 'fail', e.message);
      }
    }
    toast(stopFlag ? 'Đã dừng workflow' : 'Workflow chạy xong');
  } catch (e) {
    toast(e.message);
  } finally {
    running = false;
    $('wfRun').disabled = false;
    $('wfStop').disabled = true;
  }
}
$('wfRun').onclick = runWorkflow;
$('wfStop').onclick = () => { stopFlag = true; BPRunner.stopAll(); };

// ---------- starter graph ----------
function demo() {
  const ref = addNode('image', 20, 60, { slug: 'ref' });
  addNode('prompt', 20, 330, { slug: 'style', text: 'Cinematic editorial portrait, soft warm key light, 35mm film look.' });
  const gpt = addNode('chatgpt', 330, 120, { slug: 'portrait', prompt: 'Keep the identity of @ref. @style', ratio: '3:4' });
  const flow = addNode('flow', 640, 60, { slug: 'clip', prompt: 'Animate @portrait into an 8-second slow dolly-in shot.', mediatype: 'video' });
  const dl = addNode('download', 950, 120, { slug: 'save' });
  editor.addConnection(ref, gpt, 'output_1', 'input_1');
  editor.addConnection(gpt, flow, 'output_1', 'input_1');
  editor.addConnection(flow, dl, 'output_1', 'input_1');
}

// ---------- template: Motion Control (same graph as TobyFlow's "motion control" workflows) ----------
const SHEET_PROMPT = `# TASK: GENERATE A COMPLETE 4-PANEL CHARACTER REFERENCE SHEET
Create a complete, photorealistic character reference sheet using the provided reference assets.
Combine all referenced elements into ONE SINGLE, visually consistent character, presented in a
strictly controlled 2x2 studio layout.
SOURCES
- IMAGE_1: authoritative source for face, hair, skin tone, body proportions.
- IMAGE_2: authoritative source for outfit and accessories (every garment, color, logo, shoes).
LAYOUT (vertical 9:16 canvas, 4 equal panels, thin gutters)
- Top-left: head-and-shoulders close-up, front view, neutral expression.
- Top-right: head-and-shoulders, side/three-quarter view, same lighting.
- Bottom-left: full body, front view, standing straight, arms relaxed.
- Bottom-right: full body, back view, same pose.
RULES
- Same person, same outfit, same proportions in all four panels.
- Seamless light-gray studio background, soft even lighting, no harsh shadows.
- Photorealistic skin and fabric detail, sharp focus.
- No text, labels, watermarks, borders or extra people.`;

const MOTION_PROMPT = `TASK: CHARACTER REPLACEMENT WITH REFERENCE-VIDEO MOTION TRANSFER
Use the provided character reference image (IMAGE_1) as the authoritative source for the main
character's identity, appearance, and outfit. Use the provided reference video (VIDEO_1) as the
authoritative source for the original motion, timing, camera movement, framing, scene, lighting,
props and every other person or object.
DO
- Replace ONLY the main person in VIDEO_1 with the character from IMAGE_1.
- Match body pose, gestures and hand-object interactions frame by frame, with identical timing.
- Keep the camera path, lens, framing, background, props and lighting exactly as in VIDEO_1.
- Keep the character's face, hair, accessories and outfit consistent across all frames,
  correctly lit by the scene's light.
- Keep the same duration and aspect ratio as VIDEO_1.
DO NOT
- Add, remove or restyle any object, background element or secondary person.
- Change the action, speed or camera movement.
- Add text, captions, logos or watermarks.`;

function motionTemplate() {
  $('wfNew').onclick();
  $('wfName').value = 'Motion Control';
  const model = addNode('image', 20, 40, { slug: 'model' });
  const outfit = addNode('image', 20, 340, { slug: 'outfit' });
  const sheetPrompt = addNode('prompt', 330, 20, { slug: 'sheetprompt', text: SHEET_PROMPT });
  const sheet = addNode('flow', 640, 120, { slug: 'sheet', mediatype: 'image', ratio: '9:16' });
  const motionPrompt = addNode('prompt', 950, 20, { slug: 'motionprompt', text: MOTION_PROMPT });
  const source = addNode('video', 950, 330, { slug: 'source' });
  const motion = addNode('flow', 1260, 120, { slug: 'motion', mediatype: 'video', ratio: '9:16' });
  const save = addNode('download', 1570, 160, { slug: 'save' });
  addNode('note', 20, 640, { text: 'Motion Control: model + outfit → character sheet (Flow, ảnh) → thay vào từng video nguồn (Flow, video). Trong Flow: đặt 1 kết quả/prompt. Chỉ dùng nhân vật bạn có quyền dùng.' });
  for (const [a, b] of [[model, sheet], [outfit, sheet], [sheetPrompt, sheet], [sheet, motion], [motionPrompt, motion], [source, motion], [motion, save]]) {
    editor.addConnection(a, b, 'output_1', 'input_1');
  }
  Object.keys(nodesData()).forEach(paintNode);
  toast('Mẫu Motion Control: chọn ảnh model, outfit, video nguồn rồi bấm Chạy');
}
$('palette').prepend(Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Mẫu: Motion Control', onclick: motionTemplate }));

refreshList();
demo();
