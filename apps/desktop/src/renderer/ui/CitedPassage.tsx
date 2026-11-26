import type { ReactNode } from "react";

export const CITED_PASSAGE_TONES = ["cited", "revised"] as const;
export type CitedPassageTone = (typeof CITED_PASSAGE_TONES)[number];

export type CitedPassageProps = {
  tone?: CitedPassageTone;
  label: string;
  /** The CiteMark beside the label. */
  mark?: ReactNode;
  children: ReactNode;
};

const CITED_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

const REVISED_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);

/** A marked passage inside the reader. `cited`: an accent rule, "Dikutip dalam jawaban Anda" and the mark. `revised`: a dashed warn rule. */
export function CitedPassage({ tone = "cited", label, mark, children }: CitedPassageProps) {
  return (
    <div className="cp" data-tone={tone}>
      <div className="cp-hd">
        {tone === "cited" ? CITED_ICON : REVISED_ICON}
        <span className="cp-lb">{label}</span>
        <span className="cp-mk">{mark}</span>
      </div>
      <div className="cp-bd">{children}</div>
    </div>
  );
}
