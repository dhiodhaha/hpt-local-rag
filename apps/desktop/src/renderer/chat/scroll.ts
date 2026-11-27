/**
 * Brings an element into view in the nearest scroller that scrolls, and in no other. `scrollIntoView` also scrolls every ancestor
 * that merely clips (overflow hidden), which shifted the whole panel while a card opened.
 */
export function revealInScroller(element: HTMLElement, behavior: ScrollBehavior = "smooth"): void {
  let scroller = element.parentElement;
  while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (scroller === null) return;
  const box = element.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const margin = 12;
  const delta = box.bottom > view.bottom - margin ? box.bottom - view.bottom + margin : Math.min(0, box.top - view.top - margin);
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior });
}
