// Pure helpers shared by the side panel, the workflow editor and the Node self-check.
(function (root) {
  'use strict';

  // 'block' = prompts separated by a blank line, 'line' = one prompt per line ('#' lines are comments).
  function splitPrompts(text, mode) {
    const parts = mode === 'line' ? text.split(/\r?\n/) : text.split(/\r?\n[ \t]*\r?\n/);
    return parts.map(s => s.trim()).filter(s => s && !(mode === 'line' && s.startsWith('#')));
  }

  const ascii = (s, max) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, c => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max);

  // Template tokens: [Date] [Time] [Prompt] [Index] [Provider] [Node]
  function buildFilename(template, vars, d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const map = {
      Date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      Time: `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
      Prompt: ascii(vars.prompt || '', 40),
      Index: String(vars.index ?? 1).padStart(3, '0'),
      Provider: vars.provider || '',
      Node: ascii(vars.node || '', 30),
    };
    const name = template.replace(/\[(\w+)\]/g, (m, k) => (k in map ? map[k] : m))
      .replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return name || 'output';
  }

  // Relative download folder; strips '..', drive letters and empty segments.
  const safeFolder = s => (s || '').split(/[\\/]+/)
    .map(p => p.replace(/[:*?"<>|]+/g, '_').trim())
    .filter(p => p && p !== '.' && p !== '..').join('/');

  // Kahn's algorithm. nodes: { id: { deps: [id] } } -> ids in run order.
  function topoOrder(nodes) {
    const indeg = {}, next = {};
    for (const id in nodes) { indeg[id] = 0; next[id] = []; }
    for (const id in nodes) {
      for (const d of nodes[id].deps) if (d in nodes) { indeg[id]++; next[d].push(id); }
    }
    const queue = Object.keys(indeg).filter(id => indeg[id] === 0), order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const n of next[id]) if (--indeg[n] === 0) queue.push(n);
    }
    if (order.length !== Object.keys(nodes).length) throw new Error('Workflow có vòng lặp (cycle) giữa các node');
    return order;
  }

  const MENTION_RE = /@([a-z][a-z0-9_]{0,29})(?![a-z0-9_])/g;
  const mentions = text => [...new Set([...(text || '').matchAll(MENTION_RE)].map(m => m[1]))];

  // Replace @slug with lookup(slug); unknown slugs stay literal.
  const resolveMentions = (text, lookup) => (text || '')
    .replace(MENTION_RE, (m, slug) => { const v = lookup(slug); return v == null ? m : v; })
    .replace(/[ \t]{2,}/g, ' ').trim();

  // Which reference images prompt i gets. mode: all | seq (one each, rotating) | none
  function refsFor(i, refs, mode) {
    if (!refs.length || mode === 'none') return [];
    return mode === 'seq' ? [refs[i % refs.length]] : refs.slice();
  }

  // Generator jobs for a node's references: one job per video (each with all the images), or one job without video.
  function refJobs(media) {
    const images = media.filter(m => m.type === 'image'), videos = media.filter(m => m.type === 'video');
    return videos.length ? videos.map(v => [...images, v]) : [images];
  }

  const api = { splitPrompts, buildFilename, safeFolder, topoOrder, mentions, resolveMentions, refsFor, refJobs };
  root.BPCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
