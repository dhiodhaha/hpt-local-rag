import { useState, type CSSProperties, type ReactNode } from "react";
import { EXCEPTION_WITHHELD, type Dalil, type Note, type PassageId, type Prose, type SourceCard, type WithheldException } from "@hpt/server/client";
import { MOTION } from "../motion.ts";
import { Badge, Disclaimer, ExpandRow, Presence, SkeletonRow, SourceTag, SwapSlot, UnverifiedRefNotice, VerifyMark, type BadgeTone, type SkeletonRowPosition } from "../ui/index.ts";
import { AnswerActions } from "./AnswerActions.tsx";
import { COPY } from "./copy.ts";
import { ProseView } from "./ProseView.tsx";
import { useReveal } from "./useReveal.ts";
import { plainTextOf, type AnswerCard, type RowKind, type SectionRow } from "./view.ts";

export type CardContext = {
  readonly numberOf: (id: PassageId) => number | null;
  readonly active: PassageId | null;
  readonly onCite: (id: PassageId) => void;
  readonly sources: readonly SourceCard[];
};

const HEADLINE_STYLE: CSSProperties = {
  fontFamily: "var(--font-read)",
  fontWeight: 400,
  fontSize: "var(--text-verdict)",
  lineHeight: 1.15,
  letterSpacing: "-.02em",
  maxWidth: 620,
  textWrap: "balance",
};

const NOTE_BADGE = {
  exception: { tone: "pengecualian", label: "Pengecualian" },
  practical: { tone: "praktis", label: "Praktis" },
  difference: { tone: "perbedaan", label: "Perbedaan" },
  revision: { tone: "revisi", label: "Revisi" },
  referral: { tone: "rujukan", label: "Rujukan" },
} as const satisfies Record<Note["kind"], { tone: BadgeTone; label: string }>;

const DALIL_LABEL = { quran: "Al-Qur'an", hadith: "Hadis", tarjih: "Tarjih" } as const satisfies Record<Dalil["kind"], string>;

const BULB = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" />
  </svg>
);

const titleOf = (sources: readonly SourceCard[], id: PassageId | undefined) => sources.find((card) => card.passage.id === id)?.passage.title ?? null;

const staggerSlot = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

function Cites({ ids, context }: { ids: readonly PassageId[]; context: CardContext }) {
  const marks = ids.flatMap((id) => {
    const number = context.numberOf(id);
    return number === null ? [] : [{ id, number }];
  });
  if (marks.length === 0) return null;
  return (
    <span className="nw">
      {marks.map(({ id, number }) => (
        <button key={id} type="button" className="c" data-state={context.active === id ? "active" : "default"} onClick={() => context.onCite(id)}>
          {number}
        </button>
      ))}
    </span>
  );
}

function NoteItem({ note, context, index }: { note: Note | WithheldException; context: CardContext; index: number }) {
  if ("withheld" in note) {
    return (
      <div className="it-card" style={staggerSlot(index)}>
        <div className="it-warn">{EXCEPTION_WITHHELD}</div>
      </div>
    );
  }
  const { tone, label } = NOTE_BADGE[note.kind];
  return (
    <div className="it-card" style={staggerSlot(index)}>
      <div className="it-top">
        <Badge tone={tone} t={label} />
        {note.basis === "inferred" ? <Badge /> : null}
      </div>
      <div className="it-title">{note.title}</div>
      <p className="it-body">
        {note.text} <Cites ids={note.sources} context={context} />
      </p>
      {note.quote === null ? null : <p className="it-quote">{note.quote.text}</p>}
    </div>
  );
}

function DalilItem({ dalil, context, index }: { dalil: Dalil; context: CardContext; index: number }) {
  const inferred = dalil.explanationBasis === "inferred";
  const title = titleOf(context.sources, dalil.sources[0]);
  const where = title === null ? dalil.reference : `${dalil.reference} · dikutip dalam ${title}`;
  return (
    <div className="it-card" style={staggerSlot(index)}>
      <div className="it-top">
        <Badge tone="kind" t={DALIL_LABEL[dalil.kind]} />
        <SourceTag t={where} />
      </div>
      {dalil.arabic === null ? null : (
        <>
          <div className="it-cap">Teks sumber</div>
          <p className="it-ar" dir="rtl" lang="ar">
            {dalil.arabic.text}
          </p>
        </>
      )}
      {dalil.translation === null ? null : (
        <>
          {dalil.arabic === null ? <div className="it-cap">Terjemahan teks sumber</div> : null}
          <p className="it-tr">“{dalil.translation}”</p>
        </>
      )}
      <div className={inferred ? "it-ex inf" : "it-ex"}>
        <div className="it-h">
          {BULB}
          {COPY.explanation}
          {inferred ? (
            <span style={{ marginLeft: "auto" }}>
              <Badge />
            </span>
          ) : null}
        </div>
        <p>
          {dalil.explanation} <Cites ids={dalil.sources} context={context} />
        </p>
      </div>
    </div>
  );
}

function positionOf(index: number, total: number): SkeletonRowPosition {
  if (total === 1) return "single";
  if (index === 0) return "first";
  return index === total - 1 ? "last" : "middle";
}

const ROW_TITLE = { notes: COPY.notes, dalil: COPY.dalil } as const satisfies Record<RowKind, string>;

const ROWS_FROM = 2;

function itemsOf(section: RowKind, card: AnswerCard, context: CardContext): ReactNode {
  if (section === "notes") return card.notes.map((note, n) => <NoteItem key={note.id} note={note} context={context} index={n} />);
  return card.dalil.map((dalil, n) => <DalilItem key={dalil.id} dalil={dalil} context={context} index={n} />);
}

function Rows({ rows, card, context }: { rows: readonly SectionRow[]; card: AnswerCard; context: CardContext }) {
  const [open, setOpen] = useState<RowKind | null>(null);
  if (rows.length === 0) return null;
  return (
    <section className="grp" style={{ marginTop: 10 }}>
      {rows.map((row, index) => {
        const isOpen = row.kind === "items" && open === row.section;
        const items = row.kind === "items" ? itemsOf(row.section, card, context) : null;
        const header =
          row.kind === "items" ? (
            <div data-row={row.section}>
              <ExpandRow state={isOpen ? "open" : "closed"} title={ROW_TITLE[row.section]} hint={row.hint ?? ""} count={String(row.count)} onToggle={() => setOpen(isOpen ? null : row.section)}>
                {items}
              </ExpandRow>
            </div>
          ) : null;
        return (
          <SwapSlot key={row.section} className="m-field" style={staggerSlot(ROWS_FROM + index)} loading={row.kind === "skeleton"} skeleton={<SkeletonRow pos={positionOf(index, rows.length)} />}>
            <div className={isOpen ? "it-open m-open" : undefined}>{header}</div>
          </SwapSlot>
        );
      })}
    </section>
  );
}

function Summary({ prose, caret, animated, context }: { prose: Prose; caret: boolean; animated: boolean; context: CardContext }) {
  return (
    <p style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.7, marginTop: 14, maxWidth: 620, textWrap: "pretty" }}>
      <ProseView spans={prose} numberOf={context.numberOf} active={context.active} onCite={context.onCite} words={animated} caret={caret} />
    </p>
  );
}

export type AnswerCardViewProps = {
  card: AnswerCard;
  context: CardContext;
  revealOnArrival?: boolean;
};

export function AnswerCardView({ card, context, revealOnArrival = false }: AnswerCardViewProps) {
  const hasReference = card.unverified.length > 0;
  const { prose, complete, animated } = useReveal(card.summary, revealOnArrival);
  const showSkeleton = card.headline === null && !hasReference;
  return (
    <>
      <section className="m-surface" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: hasReference ? "24px 28px 22px" : "26px 28px 24px" }} data-card="answer">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="lbl" style={{ color: "var(--color-accent)" }}>
            {COPY.answerLabel}
          </div>
          {card.headline?.inferred ? <Badge /> : null}
          <span style={{ marginLeft: "auto" }}>
            <Presence show={card.headline?.verifying === true} exitMs={MOTION.verifyPillFadeMs}>
              {(closing) => (
                <span className="m-verify" data-closing={closing} data-headline={closing ? "settling" : "verifying"}>
                  <VerifyMark />
                </span>
              )}
            </Presence>
          </span>
        </div>
        {card.unverified.map((reference) => (
          <div key={reference.asStated} style={{ marginTop: 14 }}>
            <UnverifiedRefNotice rl={COPY.unverifiedLabel} rq={`“${reference.asStated}”`} nt={reference.note} />
          </div>
        ))}
        {hasReference && card.headline === null ? null : (
          <SwapSlot
            fade={false}
            loading={showSkeleton}
            style={{ marginTop: hasReference ? 16 : 12 }}
            skeleton={
              <div style={{ paddingTop: 6 }}>
                <div className="sk" style={{ width: "88%", height: 18 }} />
                <div className="sk" style={{ width: "54%", height: 18, marginTop: 10 }} />
              </div>
            }
          >
            {card.headline === null ? null : (
              <h2 className="m-headline" data-verifying={card.headline.verifying} style={HEADLINE_STYLE}>
                {card.headline.text}
              </h2>
            )}
          </SwapSlot>
        )}
        {prose === null ? null : <Summary prose={prose} caret={card.summaryStreaming || !complete} animated={animated} context={context} />}
        {card.inferenceNote === null ? null : (
          <p className="m-field" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-rule)", maxWidth: 620, fontSize: "var(--text-sm)", fontWeight: 500, lineHeight: 1.5, color: "var(--color-inferred)", ...staggerSlot(1) }}>
            <span style={{ flex: "none", marginTop: 2 }}>{BULB}</span>
            <span>
              <ProseView spans={card.inferenceNote} numberOf={context.numberOf} active={context.active} onCite={context.onCite} />
            </span>
          </p>
        )}
      </section>
      <Rows rows={card.rows} card={card} context={context} />
      {card.finished && complete ? (
        <AnswerActions text={plainTextOf(card)} index={ROWS_FROM + card.rows.length} />
      ) : (
        <div style={{ margin: "16px 4px 0" }}>
          <Disclaimer t={COPY.disclaimer} />
        </div>
      )}
    </>
  );
}
