import { useMemo, type ReactNode } from "react";
import type { Passage, PassageId } from "@hpt/server/client";
import { COPY } from "../chat/copy.ts";
import { CitedPassage, RevisionNotice } from "../ui/index.ts";
import { CiteNumber } from "./CiteNumber.tsx";
import { headingBefore, type Annotation, type Piece, type ReaderDocument } from "./model.ts";
import { structureOf } from "./structure.ts";
import type { Landed } from "./useReaderScroll.ts";

export type ArticleProps = {
  doc: ReaderDocument;
  annotations: ReadonlyMap<PassageId, Annotation>;
  current: PassageId;
  /** The passage the last jump went to. Only a jump lights its marked words. */
  landed: Landed;
  place: (id: PassageId) => (element: HTMLElement | null) => void;
};

function PieceView({ piece }: { piece: Piece }) {
  const inner = piece.arabic ? (
    <span className="ar-run" lang="ar" dir="rtl">
      {piece.text}
    </span>
  ) : (
    piece.text
  );
  return piece.quoted ? <mark>{inner}</mark> : inner;
}

function Pieces({ pieces }: { pieces: readonly Piece[] }) {
  return pieces.map((piece, index) => <PieceView key={index} piece={piece} />);
}

/**
 * The corpus text is only ever a text node, so a stray tag in a passage shows as the characters it is. It is set as a page of a book:
 * the parts structureOf found carry their kind, and the stylesheet draws a kind as a run-in head, a hanging item, a centred matn or a
 * narrower translation. What structureOf did not recognise is a plain paragraph.
 */
function PassageText({ passage, annotation }: { passage: Passage; annotation: Annotation | undefined }) {
  const excerpts = annotation?.excerpts;
  const parts = useMemo(() => structureOf(passage.text, excerpts ?? []), [passage.text, excerpts]);
  return (
    <div className="rd-bk" lang="id">
      {parts.map((part, index) =>
        part.kind === "matn" ? (
          <p key={index} className="rd-ar" lang="ar" dir="rtl">
            <Pieces pieces={part.pieces} />
          </p>
        ) : (
          <p key={index} className="rd-p" data-kind={part.kind} data-depth={part.depth} data-lead={part.leadIn ? "true" : undefined}>
            {part.head.length === 0 ? null : (
              <span className="rd-hd">
                <Pieces pieces={part.head} />
              </span>
            )}
            <Pieces pieces={part.pieces} />
          </p>
        ),
      )}
    </div>
  );
}

function Heading({ level, text, eyebrow }: { level: 2 | 3; text: string; eyebrow: string | null }) {
  if (level === 3) return <h3 className="rd-h3">{text}</h3>;
  return (
    <>
      {eyebrow === null ? null : <div className="lbl rd-eyebrow">{eyebrow}</div>}
      <h2 className="rd-h2">{text}</h2>
    </>
  );
}

export function Article({ doc, annotations, current, landed, place }: ArticleProps) {
  const hasContents = doc.bagian.length > 1;
  const bagianOfPassage = new Map(doc.bagian.flatMap((entry) => entry.passages.map((passage) => [passage.id, entry.n] as const)));
  return (
    <div className="rd-page">
      {doc.revised ? (
        <div className="rd-notice">
          <RevisionNotice title={COPY.reader.revisionTitle} text={COPY.reader.revisionText} />
        </div>
      ) : null}
      {doc.passages.map((passage, index) => {
        const heading = headingBefore(passage, doc.passages[index - 1] ?? null);
        const annotation = annotations.get(passage.id);
        const text = <PassageText passage={passage} annotation={annotation} />;
        let body: ReactNode = text;
        if (annotation !== undefined) {
          body = (
            <CitedPassage label={COPY.reader.citedLabel} mark={<CiteNumber c={String(annotation.number)} active={current === passage.id} />}>
              {text}
            </CitedPassage>
          );
        } else if (passage.supersededBy !== null) {
          body = (
            <CitedPassage tone="revised" label={COPY.reader.revisedLabel}>
              {text}
            </CitedPassage>
          );
        }
        const n = bagianOfPassage.get(passage.id) ?? 1;
        return (
          <section key={passage.id} ref={place(passage.id)} className="rd-ps" data-passage={passage.id} data-current={current === passage.id} data-landed={landed.id === passage.id ? landed.flip : undefined}>
            {heading === null ? null : <Heading level={heading.level} text={heading.text} eyebrow={hasContents ? COPY.reader.bagianLabel(n) : null} />}
            {body}
          </section>
        );
      })}
    </div>
  );
}
