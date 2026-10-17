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

  // Checks whether the candidate is the top-most element at one or more sample points
  function isTopmostAtRect(el: Element, rect: DOMRect): boolean {
    // If rect is outside viewport, treat as not topmost
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    const centerX = clamp((rect.left + rect.right) / 2, 0, window.innerWidth - 1);
    // pick a y slightly inside the bottom edge of the element so that it's within the element
    const bottomY = clamp(rect.bottom - 1, 0, window.innerHeight - 1);
    const quarterLeftX = clamp(rect.left + (rect.width || 0) * 0.25, 0, window.innerWidth - 1);
    const quarterRightX = clamp(rect.left + (rect.width || 0) * 0.75, 0, window.innerWidth - 1);

    const samplePoints: Array<{ x: number; y: number }> = [];
    // prefer bottom center, but add left/right samples if element is wide enough
    samplePoints.push({ x: centerX, y: bottomY });
    if (rect.width >= 24) {
      samplePoints.push({ x: quarterLeftX, y: bottomY });
      samplePoints.push({ x: quarterRightX, y: bottomY });
    }

    let matches = 0;
    for (const p of samplePoints) {
      const topEl = document.elementFromPoint(p.x, p.y) as Element | null;
      if (!topEl) continue;
      // consider it matching if the found element is the candidate or a descendant of it
      if (topEl === el || el.contains(topEl)) matches++;
    }

    // require at least one sample to match (loose) — ensures candidate is clickable/visible at some point
    return matches > 0;
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

    // ensure candidate is actually top-most at its bottom area (i.e., not occluded)
    if (!isTopmostAtRect(el, rect)) continue;

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
