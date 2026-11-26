import type { PassageId, Prose } from "@hpt/server/client";
import { CiteMark } from "../ui/index.ts";
import { segmentsOf, splitTail } from "./prose.ts";

export type ProseViewProps = {
  spans: Prose;
  numberOf: (id: PassageId) => number | null;
  /** The passage whose mark is open. */
  active: PassageId | null;
  onCite: (id: PassageId) => void;
  /** The tail is still arriving: fade the last words and show a caret. */
  streaming?: boolean;
};

export function ProseView({ spans, numberOf, active, onCite, streaming = false }: ProseViewProps) {
  const segments = segmentsOf(spans);
  const last = segments.at(-1);
  const fading = streaming && last?.kind === "text";
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          if (!fading || index !== segments.length - 1) return segment.text;
          const { lead, tail } = splitTail(segment.text);
          return (
            <span key={index}>
              {lead}
              <span className="fade">{tail}</span>
            </span>
          );
        }
        const marks = segment.passages === null ? <CiteMark state="pending" c="·" /> : segment.passages.map((id) => {
          const number = numberOf(id);
          return number === null ? null : <CiteMark key={id} state={active === id ? "active" : "default"} c={String(number)} onClick={() => onCite(id)} />;
        });
        return (
          <span key={index} className="nw">
            {segment.word}
            {marks}
            {segment.after}
          </span>
        );
      })}
      {streaming ? <span className="caret" aria-hidden="true" /> : null}
    </>
  );
}
