// ChatGPT (chatgpt.com). The runner opens a fresh chat before every job.
(() => {
  // Signed image URLs ChatGPT serves generated files from.
  const MEDIA_URL = /backend-api\/estuary\/content|oaiusercontent\.com|backend-api\/files/;
  const fileId = url => (url.match(/[?&]id=(file[-_][\w-]+)/) || [])[1] || url;

  BP.register({
    name: 'chatgpt',
    selectors: {
      editor: ['#prompt-textarea', '.ProseMirror[contenteditable="true"]', 'form textarea'],
      submit: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send" i]'],
      stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
      fileInput: ['form input[type="file"][accept*="image"]', 'form input[type="file"]', 'input[type="file"]'],
      assistant: ['[data-message-author-role="assistant"]'],
    },

    async run(job, S) {
      const editor = await BP.waitFor(() => BP.findLast(S.editor), 30000);
      if (!editor) throw new Error('Không thấy ô chat — đã đăng nhập ChatGPT chưa?');

      await BP.attachRefs(job.images, { input: BP.find(S.fileInput), editor });
      const { prefix = '', ratio } = job.settings;
      const prompt = `${prefix}${job.prompt}${ratio ? `\n\nAspect ratio: ${ratio}.` : ''}`;
      if (!await BP.setText(editor, prompt)) throw new Error('Không nhập được prompt vào ChatGPT');

      const accept = (el, src, type) => type === 'image' && !el.closest('form')
        && (MEDIA_URL.test(src) || /^generated image/i.test(el.alt || ''))
        && !/blur/.test(el.className) && el.getBoundingClientRect().width >= 120;
      const baseline = BP.scanMedia(accept, fileId);
      const isBusy = () => !!BP.find(S.stop);

      await BP.submit(editor, () => BP.find(S.submit), isBusy);

      const lastReply = () => BP.findAll(S.assistant).pop();
      return BP.waitForNewMedia({
        baseline, accept, key: fileId,
        expected: job.settings.count || 1,
        timeoutMs: job.settings.timeoutMs,
        idleFailMs: 45000, // finished answering without an image = text-only reply / refusal
        isBusy,
        checkError: () => {
          const reply = lastReply();
          const text = reply ? BP.textOf(reply) : '';
          if (/(image (generation|creation) limit|hit the (plan )?limit|rate limit)/i.test(text)) return 'ChatGPT báo đã hết lượt tạo ảnh';
          return null;
        },
      });
    },
  });
})();
