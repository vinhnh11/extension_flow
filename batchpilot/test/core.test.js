// Run: node test/core.test.js
const assert = require('node:assert/strict');
const C = require('../lib/core.js');

assert.deepEqual(C.splitPrompts('a\nb\n\n  c  \n\n\n', 'block'), ['a\nb', 'c']);
assert.deepEqual(C.splitPrompts('a\r\n# note\r\n\r\nb', 'line'), ['a', 'b']);

const d = new Date(2026, 9, 21, 9, 5, 7);
assert.equal(C.buildFilename('[Date]_[Time]_[Prompt]_[Index]', { prompt: 'Cô gái đi xe đạp / hoàng hôn', index: 7 }, d),
  '2026-10-21_09-05-07_Co_gai_di_xe_dap_hoang_hon_007');
assert.equal(C.buildFilename('[Provider]-[Unknown]', { provider: 'grok' }, d), 'grok-[Unknown]');
assert.equal(C.buildFilename('[Prompt]', { prompt: '???' }, d), 'output');
assert.equal(C.safeFolder('../a//b/../C:/x'), 'a/b/C_/x');

assert.deepEqual(C.topoOrder({ c: { deps: ['b', 'a', 'a'] }, b: { deps: ['a'] }, a: { deps: [] } }), ['a', 'b', 'c']);
assert.throws(() => C.topoOrder({ a: { deps: ['b'] }, b: { deps: ['a'] } }), /vòng lặp/);

assert.deepEqual(C.mentions('use @ref and @ref, @style_2 or @Bad'), ['ref', 'style_2']);
assert.equal(C.resolveMentions('Keep @ref.  @style @nope', s => ({ ref: '[image 1]', style: 'warm light' })[s]),
  'Keep [image 1]. warm light @nope');

assert.deepEqual(C.refsFor(3, ['x', 'y'], 'seq'), ['y']);
assert.deepEqual(C.refsFor(0, ['x', 'y'], 'all'), ['x', 'y']);
assert.deepEqual(C.refsFor(0, ['x'], 'none'), []);

// Motion control: one generation per video, each with every image (character sheet).
const img = n => ({ type: 'image', n }), vid = n => ({ type: 'video', n });
assert.deepEqual(C.refJobs([img(1), vid('a'), img(2), vid('b')]), [[img(1), img(2), vid('a')], [img(1), img(2), vid('b')]]);
assert.deepEqual(C.refJobs([img(1)]), [[img(1)]]);
assert.deepEqual(C.refJobs([]), [[]]);

console.log('core.test.js: all checks passed');
