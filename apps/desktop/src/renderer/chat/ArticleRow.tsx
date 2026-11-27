import type { CSSProperties, ReactNode } from "react";
import type { PassageId } from "@hpt/server/client";
import { ArabicText } from "../ArabicText.tsx";
import { isMostlyArabic } from "../arabic.ts";
import { Badge, CiteMark } from "../ui/index.ts";
import type { MarginNote } from "./article.ts";
import { COPY } from "./copy.ts";

export type ArticleContext = {
  readonly numberOf: (id: PassageId) => number | null;
  /** The passage whose mark is lit: the one the Sumber panel previews or the reader shows. */
  readonly active: PassageId | null;
  /** A mark or a margin note was clicked. The Sumber panel opens that source's card in place. */
  readonly onCite: (id: PassageId) => void;
  /** "Buka sumber". Only this opens Baca putusan. */
  readonly onOpen: (id: PassageId) => void;
};

const slot = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

/** The marks for some passages, in place. A passage the answer has not numbered yet has no mark. */
export function CiteRun({ ids, context }: { ids: readonly PassageId[]; context: ArticleContext }): ReactNode {
  return ids.flatMap((id) => {
    const number = context.numberOf(id);
    return number === null ? [] : [<CiteMark key={id} c={String(number)} passage={id} state={context.active === id ? "active" : "default"} onClick={() => context.onCite(id)} />];
  });
}

/** Text with its marks after the last word and before the closing punctuation, so a mark never starts a line. */
export function CitedText({ text, ids, context }: { text: string; ids: readonly PassageId[]; context: ArticleContext }) {
  const tail = /[.,;:!?]+$/.exec(text)?.[0] ?? "";
  const body = text.slice(0, text.length - tail.length);
  const word = /\S+$/.exec(body)?.[0] ?? "";
  return (
    <>
      {body.slice(0, body.length - word.length)}
      <span className="nw">
        {word}
        <CiteRun ids={ids} context={context} />
        {tail}
      </span>
    </>
  );
}

const ARROW = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function Quote({ text }: { text: string }) {
  if (isMostlyArabic(text)) {
    return (
      <span className="an-sn-arx" dir="rtl" lang="ar">
        {text.replace(/^“|”$/g, "")}
      </span>
    );
  }
  return (
    <q className="an-sn-q">
      <ArabicText text={text} />
    </q>
  );
}

function MarginItem({ note, context, style }: { note: MarginNote; context: ArticleContext; style?: CSSProperties }) {
  const active = context.active === note.id;
  const showStatus = note.quote !== null || note.status === "superseded";
  return (
    <div className="an-sn" data-active={active} data-margin={note.id} style={style}>
      <button type="button" className="an-sn-hit" aria-label={`${COPY.sources} ${note.number}: ${note.title}`} onClick={() => context.onCite(note.id)}>
        <span className="an-sn-t">
          <span className="c" data-state={active ? "active" : "default"} aria-hidden="true">
            {note.number}
          </span>
          <span className="an-sn-name">{note.title}</span>
        </span>
        {note.where === null ? null : <span className="an-sn-w">{note.where}</span>}
        {note.quote === null ? null : <Quote text={note.quote} />}
        {showStatus ? (
          <span className="an-sn-b">
            <Badge tone={note.status === "active" ? "berlaku" : "direvisi"} t={COPY.article.status[note.status]} />
          </span>
        ) : null}
      </button>
      <button type="button" className="an-sn-open" onClick={() => context.onOpen(note.id)}>
        {COPY.article.openSource}
        {ARROW}
      </button>
    </div>
  );
}

export function MarginList({ notes, context }: { notes: readonly MarginNote[]; context: ArticleContext }) {
  return (
    <aside className="an-side" aria-label={COPY.sources}>
      {notes.map((note) => (
        <MarginItem key={note.id} note={note} context={context} />
      ))}
    </aside>
  );
}

/** The whole margin as one column beside the article, each note level with the line that first cites it. */
export function MarginLayer({ notes, context, tops }: { notes: readonly MarginNote[]; context: ArticleContext; tops: readonly number[] }) {
  return (
    <aside className="an-margin" aria-label={COPY.sources}>
      {notes.map((note, index) => (
        <MarginItem key={note.id} note={note} context={context} style={{ transform: `translateY(${tops[index] ?? 0}px)` }} />
      ))}
    </aside>
  );
}

export type ArticleRowProps = {
  margin?: readonly MarginNote[];
  context: ArticleContext;
  /** Set for a row that arrives by itself, so it rises into place. */
  index?: number;
  children: ReactNode;
};

/** A block of the article and, beside it on a wide window or under it on a narrow one, the margin notes for what it cites. */
export function ArticleRow({ margin = [], context, index, children }: ArticleRowProps) {
  return (
    <div className={index === undefined ? "an-row" : "an-row m-field"} style={index === undefined ? undefined : slot(index)}>
      <div className="an-main">{children}</div>
      {margin.length === 0 ? null : <MarginList notes={margin} context={context} />}
    </div>
  );
}
