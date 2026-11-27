import type { PassageId, Prose } from "@hpt/server/client";
import { CiteMark } from "../ui/index.ts";
import { segmentsOf } from "./prose.ts";

export type ProseViewProps = {
  spans: Prose;
  numberOf: (id: PassageId) => number | null;
  /** The passage whose mark is open. */
  active: PassageId | null;
  onCite: (id: PassageId) => void;
  words?: boolean;
  caret?: boolean;
};

/** Every word is its own span, so a word that is added later is a new element and its fade plays once. */
function Words({ text }: { text: string }) {
  return text.split(/(\s+)/).map((token, index) => (token === "" || /^\s+$/.test(token) ? token : <span key={index} className="m-word">{token}</span>));
}

export function ProseView({ spans, numberOf, active, onCite, words = false, caret = false }: ProseViewProps) {
  const segments = segmentsOf(spans);
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return words ? <Words key={index} text={segment.text} /> : segment.text;
        const marks = segment.passages === null ? <CiteMark state="pending" c="·" /> : segment.passages.map((id) => {
          const number = numberOf(id);
          return number === null ? null : <CiteMark key={id} passage={id} state={active === id ? "active" : "default"} c={String(number)} onClick={() => onCite(id)} />;
        });
        return (
          <span key={index} className="nw">
            {segment.word}
            {marks}
            {segment.after}
          </span>
        );
      })}
      {caret ? <span className="caret" aria-hidden="true" /> : null}
    </>
  );
}
