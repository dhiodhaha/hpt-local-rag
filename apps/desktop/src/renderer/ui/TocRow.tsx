import type { ReactNode } from "react";

export const TOC_ROW_STATES = ["default", "cited", "current"] as const;
export type TocRowState = (typeof TOC_ROW_STATES)[number];

export type TocRowProps = {
  state?: TocRowState;
  n: string;
  title: string;
  meta?: string;
  /** CiteMarks for the passages of this bagian that the answer quotes. */
  marks?: ReactNode;
  onClick?: () => void;
};

/** One bagian in the reader's Daftar isi. `cited`: the answer quotes it. `current`: it is on screen now. */
export function TocRow({ state = "default", n, title, meta, marks, onClick }: TocRowProps) {
  return (
    <button type="button" className="toc-row" data-state={state} aria-current={state === "current" ? "location" : undefined} onClick={onClick}>
      <span className="toc-n">{n}</span>
      <span className="toc-tx">
        <span className="toc-t">{title}</span>
        {meta === undefined ? null : <span className="toc-m">{meta}</span>}
      </span>
      <span className="toc-mk">{marks}</span>
    </button>
  );
}
