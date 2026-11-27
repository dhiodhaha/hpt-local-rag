/**
 * Where margin notes sit. A note starts level with the line that first cites it (`wanted`, a distance from the top of the article).
 * Notes keep their reading order: one that would land on the note before it is pushed down to `gap` below that note's end, and
 * nothing moves up.
 */
export function placeNotes(wanted: readonly number[], heights: readonly number[], gap: number): number[] {
  const tops: number[] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  wanted.forEach((want, index) => {
    const top = Math.max(want, bottom + gap);
    tops.push(top);
    bottom = top + (heights[index] ?? 0);
  });
  return tops;
}

/** The widest window layout: a 640px column, a 60px gutter and a 240px margin. Below this the notes sit under their paragraph. */
export const WIDE_PX = 940;

export const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
