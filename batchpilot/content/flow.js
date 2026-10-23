// Google Flow (flow.google.com/project/<id>). Image/Video mode is switched best-effort; model, ratio and
// outputs-per-prompt use whatever is selected in Flow's settings; job.settings.count = how many to wait for.
(() => {
  const MEDIA_HOST = /flow-content\.google|googleusercontent\.com|storage\.googleapis\.com|flow\.google\.com\/asb\//;

  // A refused/failed generation shows up as a tile with a "warning" icon and Flow's reason text.
  const warnIcons = () => [...document.querySelectorAll('i,span')]
    .filter(e => e.childElementCount === 0 && e.textContent.trim() === 'warning' && BP.visible(e));
  function failReason(icon) {
    for (let el = icon.parentElement, i = 0; el && i < 5; el = el.parentElement, i++) {
      const text = BP.textOf(el).replace(/^warning\s*/, '');
      if (text.length >= 20) return text.slice(0, 200);
    }
    return 'không rõ lý do';
  }

  // Like TobyFlow: open the settings popover that sits next to Send, pick the Image or Video tab
  // (+ Ingredients for video, so a reference video is used as an ingredient), then close it.
  // ponytail: label regexes, not Flow's real icon names; false = not recognised, Flow's current mode is kept.
  async function setMode(isVideo, sendBtn) {
    if (!sendBtn) return false;
    let bar = sendBtn.parentElement;
    while (bar && bar.querySelectorAll('button').length < 2) bar = bar.parentElement;
    const trigger = bar && [...bar.querySelectorAll('button[aria-haspopup],button[aria-expanded]')]
      .filter(b => b !== sendBtn && BP.visible(b)).pop();
    if (!trigger) return false;
    const popups = () => [...document.querySelectorAll('[role=dialog],[role=menu],[data-radix-popper-content-wrapper]')].filter(BP.visible);
    const before = new Set(popups());
    BP.click(trigger);
    const panel = () => popups().find(p => !before.has(p)); // re-read: the popover may re-render after a pick
    if (!await BP.waitFor(panel, 3000)) return false;
    const pick = async re => {
      // Only tabs/radios: a plain "Upload video" button in the wrong popover must not be clicked.
      const el = [...(panel()?.querySelectorAll('[role=tab],[role=radio]') || [])]
        .find(e => BP.visible(e) && re.test(`${BP.textOf(e)} ${e.getAttribute('aria-label') || ''}`));
      if (!el) return false;
      if (!BP.isOn(el)) { BP.click(el); await BP.sleep(500); }
      return true;
    };
    try {
      const ok = await pick(isVideo ? /video/i : /image|hình ảnh|^\s*ảnh/i);
      if (ok && isVideo) await pick(/ingredient|thành phần/i);
      return ok;
    } finally {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await BP.sleep(400);
    }
  }

  BP.register({
    name: 'flow',
    // Override any of these in Cài đặt → Selector (JSON: { "flow": { "submit": "..." } }).
    selectors: {
      editor: ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', 'textarea'],
      submit: ['button[aria-label*="Create" i]', 'button[aria-label*="Generate" i]', 'button[aria-label*="Tạo" i]'],
      fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
      captcha: ['iframe[src*="recaptcha/api2/bframe"]', 'iframe[src*="recaptcha/enterprise"]'],
    },

    async run(job, S) {
      if (!/\/project\/[\w-]+/.test(location.pathname)) {
        throw new Error('Hãy mở một project trên Google Flow (flow.google.com/project/...) rồi chạy lại');
      }
      const editor = await BP.waitFor(() => BP.findLast(S.editor), 20000);
      if (!editor) throw new Error('Không tìm thấy ô nhập prompt của Flow');

      // Flow's send button is an icon button ("arrow_forward"); aria-label varies by locale.
      // No \b: the icon text runs into the label ("arrow_forwardCreate") once whitespace is stripped.
      const findSubmit = () => BP.find(S.submit) || BP.findByText(/arrow_forward/);
      const isVideo = job.settings.mediaType === 'video';
      // Mode first: switching it may reset the composer's ingredients.
      const modeSet = await setMode(isVideo, findSubmit()).catch(() => false);
      const hint = modeSet ? '' : ` (không tự chuyển được Flow sang chế độ ${isVideo ? 'Video · Ingredients' : 'Ảnh'}; hãy chuyển tay rồi chạy lại)`;

      try {
        // job.images: reference images and, for motion control, the source video (data URLs).
        await BP.attachRefs(job.images, { input: BP.find(S.fileInput), editor });
        if (!await BP.setText(editor, job.prompt)) throw new Error('Không nhập được prompt vào Flow');

        const accept = (el, src, type) => MEDIA_HOST.test(src) && type === (isVideo ? 'video' : 'image')
          && !editor.contains(el) && el.getBoundingClientRect().width >= 60;
        const baseline = BP.scanMedia(accept);
        const failsBefore = warnIcons().length;

        // A just-uploaded video keeps Send disabled while Flow processes it.
        await BP.submit(editor, findSubmit, BP.hasProgress, 120000);

        return await BP.waitForNewMedia({
          baseline, accept,
          expected: job.settings.count || 1,
          timeoutMs: job.settings.timeoutMs,
          settleMs: isVideo ? 6000 : 4000,
          isBusy: BP.hasProgress,
          checkError: () => {
            if (BP.find(S.captcha)) return 'Flow yêu cầu captcha — hãy giải captcha rồi chạy lại';
            const icons = warnIcons();
            if (icons.length <= failsBefore) return null;
            // ponytail: newest tile assumed first in the DOM (Flow prepends); a scroll that mounts old failed tiles could misfire.
            const reason = failReason(icons[0]);
            // Policy refusals fail the same way every time; the ⛔ prefix tells the queue not to retry.
            return `${/chính sách|policy|vi phạm|violat/i.test(reason) ? '⛔ ' : ''}Flow báo lỗi: ${reason}`;
          },
        });
      } catch (e) {
        if (hint && !e.message.startsWith('⛔')) e.message += hint;
        throw e;
      }
    },
  });
})();
