import type { ReactNode } from "react";
import type { Passage, PassageId } from "@hpt/server/client";
import { COPY } from "../chat/copy.ts";
import { CitedPassage, RevisionNotice } from "../ui/index.ts";
import { CiteNumber } from "./CiteNumber.tsx";
import { blocksOf, headingBefore, type Annotation, type Block, type Piece, type ReaderDocument } from "./model.ts";

export type ArticleProps = {
  doc: ReaderDocument;
  annotations: ReadonlyMap<PassageId, Annotation>;
  current: PassageId;
  place: (id: PassageId) => (element: HTMLElement | null) => void;
};

function PieceView({ piece }: { piece: Piece }) {
  const inner = piece.arabic ? (
    <span className="rd-ar-run" lang="ar" dir="rtl">
      {piece.text}
    </span>
  ) : (
    piece.text
  );
  return piece.quoted ? <mark>{inner}</mark> : inner;
}

function Pieces({ pieces }: { pieces: Block["pieces"] }) {
  return pieces.map((piece, index) => <PieceView key={index} piece={piece} />);
}

/** The corpus text is only ever a text node, so a stray tag in a passage shows as the characters it is. */
function PassageText({ passage, annotation }: { passage: Passage; annotation: Annotation | undefined }) {
  const blocks = blocksOf(passage.text, annotation?.excerpts ?? []);
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "arabic" ? (
          <div key={index} className="rd-dl">
            <p className="rd-ar" lang="ar" dir="rtl">
              <Pieces pieces={block.pieces} />
            </p>
          </div>
        ) : (
          <p key={index} className="rd-p">
            <Pieces pieces={block.pieces} />
          </p>
        ),
      )}
    </>
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

export function Article({ doc, annotations, current, place }: ArticleProps) {
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
          <section key={passage.id} ref={place(passage.id)} className="rd-ps" data-passage={passage.id} data-current={current === passage.id}>
            {heading === null ? null : <Heading level={heading.level} text={heading.text} eyebrow={hasContents ? COPY.reader.bagianLabel(n) : null} />}
            {body}
          </section>
        );
      })}
    </div>
  );
}
