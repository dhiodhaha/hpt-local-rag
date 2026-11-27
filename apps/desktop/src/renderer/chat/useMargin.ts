import { useLayoutEffect, useState, type RefObject } from "react";
import type { PassageId } from "@hpt/server/client";
import { placeNotes, sameNumbers, WIDE_PX } from "./margin.ts";

const GAP_PX = 12;

/** Whether the article is wide enough to draw its margin as one column beside the text. */
export function useWide(article: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = article.current;
    if (element === null) return;
    const measure = () => setWide(element.clientWidth >= WIDE_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [article]);
  return wide;
}

const NONE: readonly number[] = [];

/** The first mark of each passage, in the order the marks stand in the text. */
function firstMarks(article: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const mark of article.querySelectorAll<HTMLElement>("[data-cite]")) {
    const id = mark.dataset["cite"] ?? "";
    if (!found.has(id)) found.set(id, mark);
  }
  return found;
}

/**
 * The top of each margin note, level with the line of the first mark that cites it. Measured after layout and again whenever the
 * article or any note changes size (a resize, a block that opens or folds, words that arrive) and whenever a font finishes loading,
 * since lines move with all of these. The article's height must stay what its text makes it: nothing here may hold it up, or a
 * shrinking article would never be seen to shrink.
 */
export function useNoteTops(article: RefObject<HTMLElement | null>, ids: readonly PassageId[], enabled: boolean): readonly number[] {
  const [placed, setPlaced] = useState<readonly number[]>(NONE);
  const key = ids.join("\n");
  useLayoutEffect(() => {
    const element = article.current;
    if (element === null || !enabled || ids.length === 0) {
      setPlaced((before) => (before.length === 0 ? before : NONE));
      return;
    }
    const measure = () => {
      const origin = element.getBoundingClientRect().top;
      const marks = firstMarks(element);
      const notes = new Map([...element.querySelectorAll<HTMLElement>(".an-margin [data-margin]")].map((note) => [note.dataset["margin"] ?? "", note]));
      const wanted = ids.map((id) => {
        const mark = marks.get(id);
        return mark === undefined ? 0 : mark.getBoundingClientRect().top - origin;
      });
      const heights = ids.map((id) => notes.get(id)?.offsetHeight ?? 0);
      const tops = placeNotes(wanted, heights, GAP_PX);
      setPlaced((before) => (sameNumbers(before, tops) ? before : tops));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const note of element.querySelectorAll(".an-margin [data-margin]")) observer.observe(note);
    let current = true;
    void document.fonts.ready.then(() => current && measure());
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      current = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [article, enabled, key]);
  return placed;
}
