import type { PassageId } from "@hpt/server/client";
import { COPY } from "../chat/copy.ts";
import { ProseView } from "../chat/ProseView.tsx";
import type { Turn } from "../chat/store.ts";
import { gistOf, viewOf } from "../chat/view.ts";
import { Badge, CitedLink } from "../ui/index.ts";
import { CiteNumber } from "./CiteNumber.tsx";
import type { Annotation, Cited, ReaderDocument } from "./model.ts";

export type AnswerPaneProps = {
  turn: Turn;
  doc: ReaderDocument | null;
  annotations: ReadonlyMap<PassageId, Annotation>;
  cited: readonly Cited[];
  current: PassageId;
  onGo: (id: PassageId) => void;
};

/** What a row shows of a cited passage: the words the answer quotes when it quotes some, else the start of the passage. */
function snippetOf({ passage, note }: Cited): string {
  const [first] = note.excerpts;
  return `“${gistOf(first === undefined ? passage.text : passage.text.slice(first.start, first.end))}”`;
}

function whereOf({ passage }: Cited): string {
  const tail = passage.section?.split(" › ").at(-1);
  return tail === undefined ? COPY.reader.paragraph(passage.ordinal) : `${COPY.reader.paragraph(passage.ordinal)} · ${tail}`;
}

function Answer({ turn, annotations, current, onGo }: Pick<AnswerPaneProps, "turn" | "annotations" | "current" | "onGo">) {
  const view = viewOf(turn.run);
  const numberOf = (id: PassageId) => annotations.get(id)?.number ?? null;
  const answered = view.kind === "answer" && view.card.headline !== null ? view.card : null;
  return (
    <div className="rd-answer" data-card="reader-answer">
      <div className="rd-q">{turn.question}</div>
      {answered?.headline ? (
        <>
          <div className="rd-lead">
            <span className="lbl" style={{ color: "var(--color-accent)" }}>
              {COPY.answerLabel}
            </span>
            {answered.headline.inferred ? <Badge /> : null}
          </div>
          <p className="rd-headline">{answered.headline.text}</p>
          {answered.summary === null ? null : (
            <p className="rd-summary">
              <ProseView spans={answered.summary} numberOf={numberOf} active={current} onCite={onGo} />
            </p>
          )}
        </>
      ) : (
        <p className="rd-summary">{view.kind === "reply" && view.message !== null ? view.message : COPY.reader.noAnswer}</p>
      )}
    </div>
  );
}

function CitedList({ cited, current, onGo }: Pick<AnswerPaneProps, "cited" | "current" | "onGo">) {
  return (
    <>
      <div className="rd-listhead">
        <span className="lbl">{COPY.reader.citedHere}</span>
        <span className="rd-count">{COPY.reader.citedCount(cited.length)}</span>
      </div>
      <div className="rd-list">
        {cited.map((entry) => {
          const here = entry.passage.id === current;
          return (
            <CitedLink
              key={entry.passage.id}
              state={here ? "current" : "default"}
              where={whereOf(entry)}
              snippet={snippetOf(entry)}
              status={here ? COPY.reader.reading : undefined}
              mark={<CiteNumber c={String(entry.note.number)} active={here} />}
              onClick={here ? undefined : () => onGo(entry.passage.id)}
            />
          );
        })}
      </div>
    </>
  );
}

export function AnswerPane({ turn, doc, annotations, cited, current, onGo }: AnswerPaneProps) {
  const noCitations = doc !== null && cited.length === 0;
  return (
    <>
      <Answer turn={turn} annotations={annotations} current={current} onGo={onGo} />
      {noCitations ? <p className="rd-none">{COPY.reader.notCited}</p> : null}
      {doc !== null && cited.length > 0 ? <CitedList cited={cited} current={current} onGo={onGo} /> : null}
    </>
  );
}
