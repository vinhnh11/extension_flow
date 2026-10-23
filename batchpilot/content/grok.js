// Grok Imagine (grok.com/imagine). The runner reloads /imagine before every job.
(() => {
  const MEDIA_HOST = /assets\.grok\.com|imagine-public\.x\.ai|grok\.x\.ai|\/generated\//;

  BP.register({
    name: 'grok',
    selectors: {
      editor: ['form textarea', 'form [contenteditable="true"]', 'textarea', '[contenteditable="true"]'],
      submit: ['form button[type="submit"]', 'button[aria-label="Submit"]', 'button[aria-label*="Send" i]'],
      fileInput: ['input[type="file"]'],
    },

    async run(job, S) {
      const editor = await BP.waitFor(() => BP.findLast(S.editor), 30000);
      if (!editor) throw new Error('Không thấy ô nhập của Grok Imagine — đã đăng nhập chưa?');

      const isVideo = job.settings.mediaType === 'video';
      // Image/Video toggle; if the label is not found Grok keeps its current mode.
      await BP.pickOption(isVideo ? /^(videocam\s*)?video$/i : /^(image\s*)?(image|ảnh|hình ảnh)$/i);
      if (job.settings.ratio) await BP.pickOption(new RegExp(`^${job.settings.ratio.replace(':', '\\s*:\\s*')}$`));

      await BP.attachRefs(job.images, { input: BP.find(S.fileInput), editor });
      // A literal "@" opens Grok's mention picker, so drop it.
      if (!await BP.setText(editor, job.prompt.replace(/@/g, ''))) throw new Error('Không nhập được prompt vào Grok');

      const accept = (el, src, type) => {
        if (type !== (isVideo ? 'video' : 'image') || el.closest('form, nav, aside')) return false;
        if (/thumbnail|loading|favorite|avatar/i.test(el.alt || '') || /blur/.test(el.className)) return false;
        const big = el.getBoundingClientRect().width >= 120;
        return big && (MEDIA_HOST.test(src) || (!isVideo && src.startsWith('data:image') && src.length > 20000));
      };
      const baseline = BP.scanMedia(accept);

      await BP.submit(editor, () => BP.find(S.submit), BP.hasProgress);

      return BP.waitForNewMedia({
        baseline, accept,
        expected: job.settings.count || 1,
        timeoutMs: job.settings.timeoutMs,
        settleMs: isVideo ? 6000 : 4000,
        isBusy: BP.hasProgress,
        checkError: () => (/rate limit|too many requests|reached your .*limit/i.test(document.body.innerText.slice(-4000))
          ? 'Grok báo đã hết lượt / quá nhiều yêu cầu' : null),
      });
    },
  });
})();
