export function clickNearestVisuallyAbove(target: Element | string, candidateSelector = '.clickable, button, a', options: { allowOverlap?: boolean } = {}): Element | null {
  const { allowOverlap = false } = options;

  const getEl = (t: any) => (typeof t === 'string' ? document.querySelector(t) : t);
  const targetEl = getEl(target) as Element | null;
  if (!targetEl) return null;

  const targetRect = (targetEl as Element).getBoundingClientRect();

  // Exclude the extension's own overlay so we don't accidentally click our UI
  const overlayEl = document.getElementById('ec-page-overlay');

  function isCandidateVisible(el: Element) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el as Element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (style.pointerEvents === 'none') return false;
    const r = (el as Element).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }

  const nodeList = Array.from(document.querySelectorAll(candidateSelector));
  const candidates = nodeList
    .filter((c) =>
      c !== targetEl &&
      document.body.contains(c) &&
      // skip candidates that are inside our extension overlay
      (!overlayEl || !overlayEl.contains(c)) &&
      isCandidateVisible(c),
    )
    .map((c) => ({ el: c as Element, rect: (c as Element).getBoundingClientRect() }));

  let best: Element | null = null;
  let bestScore = Infinity;

  const targetCenterX = (targetRect.left + targetRect.right) / 2;

  for (const { el, rect } of candidates) {
    if (!allowOverlap && rect.bottom > targetRect.top) continue;

    const verticalGap = Math.max(0, targetRect.top - rect.bottom);
    const rectCenterX = (rect.left + rect.right) / 2;
    const horizontalGap = Math.abs(rectCenterX - targetCenterX);

    const score = verticalGap * 10000 + horizontalGap;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  const toClick = best || targetEl;

  try {
    (toClick as HTMLElement).click();
  } catch (err) {
    const ev = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
    });
    toClick.dispatchEvent(ev);
  }

  return toClick;
}
