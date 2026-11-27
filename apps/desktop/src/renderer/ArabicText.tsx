import { arabicRuns } from "./arabic.ts";

/** Corpus text in a UI-font line: each Arabic run in the Arabic font, right to left, isolated so it cannot reorder the line around it. */
export function ArabicText({ text }: { text: string }) {
  return arabicRuns(text).map((run, index) =>
    run.arabic ? (
      <span key={index} className="ar-run" lang="ar" dir="rtl">
        {run.text}
      </span>
    ) : (
      run.text
    ),
  );
}
