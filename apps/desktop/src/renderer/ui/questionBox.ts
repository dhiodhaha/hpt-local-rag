import type { Box } from "../aura.ts";

/**
 * The question box relative to the pane (the Aura's root, which fills the screen), from layout offsets and not from the bounding
 * rectangle, because the floating box is moved by a transform while it settles (`layout="position"`) and the light should go where
 * the box will be. Falls back to the rectangle when the box is not in the pane's offset chain.
 */
export function measureBox(pane: HTMLElement, element: HTMLElement): Box {
  const origin = pane.offsetParent;
  let x = 0;
  let y = 0;
  let at: Element | null = element;
  for (; at instanceof HTMLElement && at !== origin; at = at.offsetParent) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  if (at === origin && origin !== null) return { x, y, w: element.offsetWidth, h: element.offsetHeight };
  const from = pane.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return { x: rect.left - from.left, y: rect.top - from.top, w: rect.width, h: rect.height };
}

/** Calls `notify` when the box or anything around it changes size: its own height as the text wraps, the chips under it, the window. */
export function watchBox(pane: HTMLElement, element: HTMLElement, notify: () => void): () => void {
  const observer = new ResizeObserver(notify);
  for (let at: HTMLElement | null = element; at !== null && !at.contains(pane); at = at.parentElement) observer.observe(at);
  return () => observer.disconnect();
}
