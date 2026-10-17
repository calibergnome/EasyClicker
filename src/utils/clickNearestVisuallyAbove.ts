export function clickNearestVisuallyAbove(target: Element | string, candidateSelector = '.clickable, button, a', options: { allowOverlap?: boolean; minMatchRatio?: number } = {}): Element | null {
  const { allowOverlap = false, minMatchRatio = 0.5 } = options;

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

  // Produce sample points across the bottom region of the rect to test top-mostness
  function samplePointsForRect(rect: DOMRect): Array<{ x: number; y: number }> {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    // If rect is tiny, just sample center-bottom
    const w = rect.width;
    const left = rect.left;
    const right = rect.right;
    const bottom = rect.bottom;

    const points: Array<{ x: number; y: number }> = [];

    const bottomY = clamp(bottom - 1, 0, window.innerHeight - 1);
    const centerX = clamp((left + right) / 2, 0, window.innerWidth - 1);
    points.push({ x: centerX, y: bottomY });

    if (w >= 24) {
      const q1 = clamp(left + w * 0.25, 0, window.innerWidth - 1);
      const q3 = clamp(left + w * 0.75, 0, window.innerWidth - 1);
      points.push({ x: q1, y: bottomY });
      points.push({ x: q3, y: bottomY });
    }

    if (w >= 80) {
      const t1 = clamp(left + w * 0.1, 0, window.innerWidth - 1);
      const t2 = clamp(left + w * 0.9, 0, window.innerWidth - 1);
      points.push({ x: t1, y: bottomY });
      points.push({ x: t2, y: bottomY });
    }

    // Also sample slightly above the bottom to avoid hairline occluders
    const altY = clamp(bottom - Math.min(6, Math.max(1, rect.height * 0.1)), 0, window.innerHeight - 1);
    if (altY !== bottomY) {
      points.push({ x: centerX, y: altY });
    }

    // Deduplicate points
    const seen = new Set<string>();
    const uniq: Array<{ x: number; y: number }> = [];
    for (const p of points) {
      const k = `${Math.round(p.x)}:${Math.round(p.y)}`;
      if (!seen.has(k)) {
        seen.add(k);
        uniq.push(p);
      }
    }
    return uniq;
  }

  // Return true if the candidate is top-most at a sufficient fraction of sample points
  function isTopmostBySampling(el: Element, rect: DOMRect, minRatio: number): boolean {
    // If rect is outside viewport, consider not topmost
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;

    const points = samplePointsForRect(rect);
    if (points.length === 0) return false;

    let matches = 0;
    for (const p of points) {
      const topEl = document.elementFromPoint(p.x, p.y) as Element | null;
      if (!topEl) continue;
      if (topEl === el || el.contains(topEl)) {
        matches++;
        continue;
      }
      // Sometimes elementFromPoint returns a child text node wrapper; climb up a little to tolerate small wrappers
      let cur: Element | null = topEl;
      let climbed = false;
      for (let i = 0; i < 3 && cur && cur !== document.documentElement; i++) {
        const parent = cur.parentElement;
        if (!parent) break;
        if (parent === el || el.contains(parent)) {
          matches++;
          climbed = true;
          break;
        }
        cur = parent;
      }
      if (climbed) continue;
    }

    return matches / points.length >= minRatio;
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

    // Ensure candidate is actually top-most at sampled points (visual stacking check)
    if (!isTopmostBySampling(el, rect, minMatchRatio)) continue;

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
