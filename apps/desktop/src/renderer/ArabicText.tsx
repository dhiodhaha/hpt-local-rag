import { arabicRuns, rowLine } from "./arabic.ts";

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

/** One line of corpus text that is cut at its end. A cut leaves the beginning of its Arabic in view, and mixed text keeps its order (see `rowLine`). */
export function ArabicLine({ text, className }: { text: string; className: string }) {
  const line = rowLine(text);
  if (line.arabic === "") {
    return (
      <span className={className} dir={line.dir}>
        <ArabicText text={line.lead} />
      </span>
    );
  }
  return (
    <span className={`${className} split`}>
      <span className="part-lead">
        <ArabicText text={line.lead} />
      </span>
      <span className="part-arabic" dir="rtl">
        <ArabicText text={line.arabic} />
      </span>
    </span>
  );
}
