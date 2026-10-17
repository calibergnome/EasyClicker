import browser from 'webextension-polyfill';
import { state } from './state';
import { matchPatternToRegExp } from '../utils';
import { ClickItem, StorageData } from '../types';
import { clickNearestVisuallyAbove } from '../utils/clickNearestVisuallyAbove';

class WorkerTimer {
  private worker: Worker | null = null;
  private callbacks = new Map<number, () => void>();
  private counter = 0;

  constructor() {
    try {
      const blob = new Blob(
        [
          `
        let intervals = {};
        let timeouts = {};
        self.onmessage = function(e) {
          const data = e.data;
          if (data.type === 'setInterval') {
            intervals[data.id] = setInterval(() => {
              self.postMessage({ id: data.id });
            }, data.ms);
          } else if (data.type === 'clearInterval') {
            clearInterval(intervals[data.id]);
            delete intervals[data.id];
          } else if (data.type === 'setTimeout') {
            timeouts[data.id] = setTimeout(() => {
              self.postMessage({ id: data.id });
              delete timeouts[data.id];
            }, data.ms);
          } else if (data.type === 'clearTimeout') {
            clearTimeout(timeouts[data.id]);
            delete timeouts[data.id];
          }
        };
      `,
        ],
        { type: 'application/javascript' },
      );
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = (e) => {
        const cb = this.callbacks.get(e.data.id);
        if (cb) cb();
      };
    } catch (_e) {
      this.worker = null;
    }
  }

  setInterval(cb: () => void, ms: number): number {
    const id = ++this.counter;
    if (this.worker) {
      this.callbacks.set(id, cb);
      this.worker.postMessage({ type: 'setInterval', id, ms });
      return id;
    } else {
      return window.setInterval(cb, ms);
    }
  }

  clearInterval(id: number): void {
    if (this.worker) {
      this.callbacks.delete(id);
      this.worker.postMessage({ type: 'clearInterval', id });
    } else {
      window.clearInterval(id);
    }
  }

  setTimeout(cb: () => void, ms: number): number {
    const id = ++this.counter;
    if (this.worker) {
      this.callbacks.set(id, () => {
        this.callbacks.delete(id);
        cb();
      });
      this.worker.postMessage({ type: 'setTimeout', id, ms });
      return id;
    } else {
      return window.setTimeout(cb, ms);
    }
  }

  clearTimeout(id: number): void {
    if (this.worker) {
      this.callbacks.delete(id);
      this.worker.postMessage({ type: 'clearTimeout', id });
    } else {
      window.clearTimeout(id);
    }
  }
}

const timer = new WorkerTimer();

// clickElement now returns boolean indicating whether any click was performed
export function clickElement(item: ClickItem): boolean {
  const finalSelector = item.type === 'any' ? item.selector : item.type + (item.selector || '');
  if (!finalSelector) return false;

  let elements;
  try {
    elements = Array.from(document.querySelectorAll(finalSelector));
  } catch (_e) {
    return false;
  }

  if (item.targetText) {
    const searchTarget = item.targetText.toLowerCase().trim().replace(/\s+/g, ' ');
    elements = elements.filter((el) => {
      const innerText = ((el as HTMLElement).innerText || '').toLowerCase().replace(/\s+/g, ' ');
      const textContent = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ');
      return innerText.includes(searchTarget) || textContent.includes(searchTarget);
    });
  }

  if (elements.length === 0) return false;

  const matchType = item.matchType || 'first';
  let clickedAny = false;

  if (matchType === 'first') {
    const clickedEl = clickNearestVisuallyAbove(elements[0] as HTMLElement, '.item-img');
    if (clickedEl) clickedAny = true;
  } else if (matchType === 'last') {
    const clickedEl = clickNearestVisuallyAbove(elements[elements.length - 1] as HTMLElement, '.item-img');
    if (clickedEl) clickedAny = true;
  } else if (matchType === 'all') {
    for (const el of elements) {
      const clickedEl = clickNearestVisuallyAbove(el as HTMLElement, '.item-img');
      if (clickedEl) clickedAny = true;
    }
  } else if (matchType === 'nth') {
    const idx = (item.nthIndex !== undefined ? item.nthIndex : 1) - 1;
    if (idx >= 0 && idx < elements.length) {
      const clickedEl = clickNearestVisuallyAbove(elements[idx] as HTMLElement, '.item-img');
      if (clickedEl) clickedAny = true;
    }
  }

  return clickedAny;
}

export function canProcessItem(item: ClickItem): boolean {
  if (!item.matchPattern) return true;
  try {
    const regex = matchPatternToRegExp(item.matchPattern);
    return regex.test(window.location.href);
  } catch (_e) {
    return false;
  }
}

export function processItem(item: ClickItem): boolean {
  if (!canProcessItem(item)) return false;
  return clickElement(item);
}

export function startClicker() {
  // Keep running until a matching element is clicked; then stop the clicker
  stopClicker();
  state.isRunning = true;
  state.sequenceStopFlag = false;
  state.sequenceId++;
  const mySequenceId = state.sequenceId;

  browser.storage.local.get(['items', 'interval', 'runMode']).then(async (res: Partial<StorageData>) => {
    if (mySequenceId !== state.sequenceId) return;

    const items = (res.items || []) as ClickItem[];
    const globalIntervalMs = (parseFloat(res.interval || '1') || 1) * 1000;
    const runMode = res.runMode || 'sequence';
    state.currentRunMode = runMode;

    if (runMode === 'parallel') {
      // For each enabled item, set an interval; any interval that detects a click will stop the clicker
      items.forEach((item) => {
        if (!item.enabled) return;
        const itemIntervalMs =
          item.interval && !isNaN(parseFloat(item.interval)) ? parseFloat(item.interval) * 1000 : globalIntervalMs;

        const id = timer.setInterval(() => {
          if (!state.isRunning || mySequenceId !== state.sequenceId) return;
          try {
            if (processItem(item)) {
              stopClicker();
            }
          } catch (_e) {
            // ignore per-item errors
          }
        }, itemIntervalMs);
        state.itemIntervalIds.push(id);
      });
    } else {
      // Sequence mode: loop through items repeatedly until a click occurs
      while (state.isRunning && !state.sequenceStopFlag && mySequenceId === state.sequenceId) {
        let processedAny = false;
        for (let i = 0; i < items.length; i++) {
          if (!state.isRunning || state.sequenceStopFlag || mySequenceId !== state.sequenceId) break;
          const item = items[i];
          if (item.enabled && canProcessItem(item)) {
            const clicked = clickElement(item);
            processedAny = true;
            if (clicked) {
              browser.storage.local.set({ activeSequenceItemId: item.id, activeSequenceItemStart: Date.now() });
              stopClicker();
              break;
            }
            const itemIntervalMs =
              item.interval && !isNaN(parseFloat(item.interval)) ? parseFloat(item.interval) * 1000 : globalIntervalMs;

            await new Promise<void>((resolve) => {
              state.currentSequenceResolve = resolve;
              state.currentSequenceTimer = timer.setTimeout(resolve, itemIntervalMs);
            });
            if (state.currentSequenceResolve) state.currentSequenceResolve = null;
          }
        }
        if (!processedAny) {
          await new Promise<void>((resolve) => {
            state.currentSequenceResolve = resolve;
            state.currentSequenceTimer = timer.setTimeout(resolve, 1000);
          });
          if (state.currentSequenceResolve) state.currentSequenceResolve = null;
        }
      }
    }
  });
}

export function stopClicker() {
  state.isRunning = false;
  state.sequenceStopFlag = true;
  state.sequenceId++;
  if (state.currentSequenceTimer) {
    timer.clearTimeout(state.currentSequenceTimer);
    state.currentSequenceTimer = null;
  }
  if (state.currentSequenceResolve) {
    state.currentSequenceResolve();
    state.currentSequenceResolve = null;
  }
  state.itemIntervalIds.forEach((id) => timer.clearInterval(id));
  state.itemIntervalIds = [];
  browser.storage.local.set({ activeSequenceItemId: null });
}
