// MAIN world, document_start (Flow only). Remembers the page's click listeners so the content script can
// deliver a click straight to Flow's own handler with isTrusted=true: unlike the debugger's real mouse
// input, this also works while the Flow tab is hidden or its window is covered. Same trick as TobyFlow.
(() => {
  const clicks = new WeakMap(); // element -> Set of click listeners
  const { addEventListener: add, removeEventListener: remove } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (type, listener) {
    if (type === 'click' && listener && this instanceof Element) {
      if (!clicks.has(this)) clicks.set(this, new Set());
      clicks.get(this).add(listener);
    }
    return add.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (type, listener) {
    if (type === 'click' && this instanceof Element) clicks.get(this)?.delete(listener);
    return remove.apply(this, arguments);
  };

  // The content script marks the element with data-bp-click and posts bp:page-click.
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.type !== 'bp:page-click') return;
    const target = document.querySelector('[data-bp-click]');
    let invoked = 0;
    for (const owner of target ? [target, target.parentElement].filter(Boolean) : []) {
      for (const listener of clicks.get(owner) || []) {
        const native = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, button: 0 });
        const event = new Proxy(native, {
          get(src, key) {
            if (key === 'isTrusted') return true;
            if (key === 'target' || key === 'srcElement') return target;
            if (key === 'currentTarget') return owner;
            const v = Reflect.get(src, key, src);
            return typeof v === 'function' ? v.bind(src) : v;
          },
        });
        try {
          (typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)).call(owner, event);
          invoked++;
        } catch (err) {
          console.warn('[BatchPilot] click listener failed', err);
        }
      }
    }
    window.postMessage({ type: 'bp:page-click:done', invoked }, location.origin);
  });
})();
