/** One delegated tooltip layer for all renderer title attributes, including dynamic portals. */
export function installCustomTooltips() {
  const tooltip = document.createElement('div');
  tooltip.id = 'volo-custom-tooltip';
  tooltip.className = 'volo-custom-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('popover', 'manual');
  const style = document.createElement('style');
  style.textContent = `
    .volo-custom-tooltip {
      position: fixed; inset: auto; margin: 0; z-index: 2147483647;
      max-width: min(320px, calc(100vw - 16px)); box-sizing: border-box;
      padding: 7px 10px; border: 1px solid rgb(34 42 54 / .14); border-radius: 9px;
      background: var(--v-panel); color: var(--v-text);
      font: 12px/1.5 system-ui, sans-serif; text-align: left; white-space: pre-wrap;
      overflow-wrap: anywhere; box-shadow: 0 5px 20px rgb(0 0 0 / .18);
      pointer-events: none; user-select: none; -webkit-app-region: no-drag;

    }
    body.dark .volo-custom-tooltip { background: rgb(20 23 30 / .94); color: rgb(244 246 250); border-color: rgb(255 255 255 / .16); }
  `;
  document.head.append(style);
  document.body.append(tooltip);
  let anchor: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let oldDescription: string | null = null;
  const hide = () => {
    clearTimeout(timer);
    if (anchor && oldDescription !== null) anchor.setAttribute('aria-describedby', oldDescription);
    else anchor?.removeAttribute('aria-describedby');
    oldDescription = null;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    anchor = null;
  };
  const convert = (element: Element) => {
    if (!element.hasAttribute('title') || element.namespaceURI !== 'http://www.w3.org/1999/xhtml')
      return;
    const title = element.getAttribute('title') || '';
    element.setAttribute('data-tooltip', title);
    element.removeAttribute('title');
  };
  const scan = (element: Element) => {
    convert(element);
    element.querySelectorAll('[title]').forEach(convert);
  };
  scan(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') convert(record.target as Element);
      else
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
    }
    if (anchor && (!anchor.isConnected || !anchor.getAttribute('data-tooltip'))) hide();
    else if (
      anchor &&
      tooltip.matches(':popover-open') &&
      tooltip.textContent !== anchor.getAttribute('data-tooltip')
    ) {
      tooltip.textContent = anchor.getAttribute('data-tooltip');
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title']
  });
  const reveal = (target: EventTarget | null, keyboard = false) => {
    const next = target instanceof Element ? target.closest('[data-tooltip]') : null;
    if (next === anchor) return;
    hide();
    if (!next?.getAttribute('data-tooltip')) return;
    anchor = next;
    timer = setTimeout(
      () => {
        if (!anchor?.isConnected || !anchor.getClientRects().length) return hide();
        tooltip.textContent = anchor.getAttribute('data-tooltip');
        tooltip.showPopover();
        const rect = anchor.getBoundingClientRect();
        const bounds = tooltip.getBoundingClientRect();
        const left = Math.max(
          8,
          Math.min(innerWidth - bounds.width - 8, rect.left + (rect.width - bounds.width) / 2)
        );
        const above = rect.top - bounds.height - 8;
        const top = Math.max(
          8,
          Math.min(innerHeight - bounds.height - 8, above >= 8 ? above : rect.bottom + 8)
        );
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        oldDescription = anchor.getAttribute('aria-describedby');
        anchor.setAttribute(
          'aria-describedby',
          [oldDescription, tooltip.id].filter(Boolean).join(' ')
        );
      },
      keyboard ? 100 : 450
    );
  };
  document.addEventListener('pointerover', (event) => reveal(event.target), true);
  document.addEventListener(
    'pointerout',
    (event) => {
      if (
        anchor &&
        (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget))
      )
        hide();
    },
    true
  );
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element && event.target.matches(':focus-visible'))
      reveal(event.target, true);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
}
