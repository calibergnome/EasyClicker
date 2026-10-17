/**
 * Click the visually nearest element above a target element.
 *
 * Parameters:
 *  - target: Element | string (DOM element or selector for the target)
 *  - candidateSelector: optional CSS selector string to restrict candidates (defaults to '.clickable, button, a')
 *  - options: optional object:
 *      - allowOverlap (boolean) : if true, allows candidates that overlap vertically (default false)
 *
 * Returns: the element that was clicked, or null if target not found.
 */
export function clickNearestVisuallyAbove(target, candidateSelector = '.clickable, button, a', options = {}) {
  const { allowOverlap = false } = options;

  const getEl = (t) => (typeof t === 'string' ? document.querySelector(t) : t);
  const targetEl = getEl(target);
  if (!targetEl) return null;

  const targetRect = targetEl.getBoundingClientRect();

  function isCandidateVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (style.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }

  const nodeList = Array.from(document.querySelectorAll(candidateSelector));
  const candidates = nodeList
    .filter(c => c !== targetEl && document.body.contains(c) && isCandidateVisible(c))
    .map(c => {
      const r = c.getBoundingClientRect();
      return { el: c, rect: r };
    });

  let best = null;
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
    toClick.click();
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
