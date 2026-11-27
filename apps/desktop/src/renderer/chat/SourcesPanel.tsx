import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { ArabicText } from "../ArabicText.tsx";
import { tidyCorpus } from "../arabic.ts";
import type { PassageId } from "@hpt/server/client";
import { Button, SourceTurnGroup } from "../ui/index.ts";
import { MOTION } from "../motion.ts";
import { COPY } from "./copy.ts";
import { BUTTON_RADII, contentFade, ICON, LABEL, OPEN_SPRING, SURFACE, SURFACE_RADII } from "./panelSpring.ts";
import { revealInScroller } from "./scroll.ts";
import { BOOK } from "./SumberIcon.tsx";
import type { PanelCard, SourcesPanel as Panel } from "./view.ts";

export type EarlierPanel = { readonly turn: number; readonly turnKey: string; readonly question: string; readonly panel: Panel };

/** The card a preview is open on: the turn whose answer cites it, and the passage. `hit` counts the clicks on a mark or margin note that opened it, and is absent when the card itself was clicked. */
export type Preview = { readonly turn: string; readonly passage: PassageId; readonly hit?: number };

/** `turnKey` names the turn whose answer the card belongs to. */
export type OpenSource = (turnKey: string, id: PassageId) => void;

/** True until the surface has grown. Cards that are there from the start come in with the panel, not one by one. */
const PanelGrowing = createContext(false);

export type SourcesPanelProps = {
  panel: Panel;
  /** The turn the current panel belongs to. */
  turnKey: string;
  earlier: readonly EarlierPanel[];
  /** The card that shows its preview, or null when every card is closed. */
  preview: Preview | null;
  /** A card was clicked: it opens its preview in place, or closes it. */
  onPreview: OpenSource;
  /** "Buka sumber": the reader. Only this opens it. */
  onOpen: OpenSource;
  onClose: () => void;
};

const statusLabel = (card: PanelCard): string => (card.status === "active" ? COPY.status.active : COPY.status.superseded);

/** The quote in full, a small line saying what kind of source it is and whether it still stands, and the two ways on. */
function CardMore({ card, open, onOpen }: { card: PanelCard; open: boolean; onOpen: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(card.copy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="scard-more" inert={!open}>
      <div className="scard-more-in">
        <div className="scard-more-pad">
          <p className="scard-quote" data-quoted={card.quoted}>
            <ArabicText text={tidyCorpus(card.preview).trim()} />
          </p>
          <div className="scard-meta">{[card.typeLabel, statusLabel(card), card.where].filter((part): part is string => part !== null).join(" · ")}</div>
          {card.priorTurn === null ? null : <div className="scard-meta">{COPY.priorTurn(card.priorTurn)}</div>}
          <div className="scard-acts">
            <Button label={COPY.article.openSource} onClick={onOpen} />
            <Button tone="ghost" label={copied ? COPY.copiedQuote : COPY.copyQuote} onClick={copy} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A row is a number, the title, one quoted line and a status dot until it is clicked, then the same row grows in place (D9.20). The
 * dot carries its meaning in words too: the row's accessible name ends with "Berlaku" or "Direvisi", and the legend under the list
 * says what the colours stand for. Once the panel has grown, an open row scrolls into view, and a row opened from a mark or margin note
 * (`hit`) is lit by a soft fade so the eye finds it. Nothing travels to the row. The entrance class is dropped when it ends, so React
 * moving the row to a new place never replays it.
 */
function Card({ card, open, hit, index, onToggle, onOpen }: { card: PanelCard; open: boolean; hit: number | undefined; index: number; onToggle: () => void; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const growing = useContext(PanelGrowing);
  const reduced = useReducedMotion() === true;
  const [entering, setEntering] = useState(!open && !growing);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || growing || element === null) return;
    revealInScroller(element, reduced ? "instant" : "smooth");
  }, [open, growing, hit, reduced]);
  const status = statusLabel(card);
  return (
    <div
      ref={ref}
      className={entering ? "scard m-source" : "scard"}
      style={{ "--i": index } as CSSProperties}
      data-source={card.id}
      data-open={open}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntering(false);
      }}
    >
      <button type="button" className="scard-head" aria-expanded={open} aria-label={COPY.sourceRow(open, card.title, status)} onClick={onToggle}>
        <span className={card.number === null ? "num wait" : "num"}>{card.number ?? "·"}</span>
        <span className="nm">{card.title}</span>
        <span className="scard-dot" data-status={card.status} role="img" aria-label={status} title={status} />
        <span className="scard-line">
          <span className="scard-line-in">
            <span className="scard-line-text">
              <ArabicText text={card.line} />
            </span>
          </span>
        </span>
      </button>
      <CardMore card={card} open={open} onOpen={onOpen} />
      {hit === undefined || growing ? null : <span key={hit} className="scard-hit" aria-hidden="true" />}
    </div>
  );
}

/** What the two dots mean, once under the whole list. */
function Legend() {
  return (
    <div className="scard-legend">
      <span>
        <span className="scard-dot" data-status="active" aria-hidden="true" />
        {COPY.status.active}
      </span>
      <span>
        <span className="scard-dot" data-status="superseded" aria-hidden="true" />
        {COPY.status.superseded}
      </span>
    </div>
  );
}

const CHEVRON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

type Cluster = { preview: Preview | null; onPreview: OpenSource; onOpen: OpenSource };

function Cards({ cards, turnKey, preview, onPreview, onOpen }: { cards: readonly PanelCard[]; turnKey: string } & Cluster) {
  return cards.map((card, index) => (
    <Card key={card.id} card={card} index={index} open={preview?.turn === turnKey && preview.passage === card.id} hit={preview?.turn === turnKey && preview.passage === card.id ? preview.hit : undefined} onToggle={() => onPreview(turnKey, card.id)} onOpen={() => onOpen(turnKey, card.id)} />
  ));
}

function Current({ panel, turnKey, ...cluster }: { panel: Panel; turnKey: string } & Cluster) {
  const [unfolded, setUnfolded] = useState(false);
  const { folded } = panel;
  return (
    <>
      {panel.hint === null ? null : (
        <p style={{ padding: "0 6px 10px", fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, color: "var(--color-ink-muted)" }}>{panel.hint === "numbers-follow" ? COPY.numbersFollow : COPY.numbersReturn}</p>
      )}
      <Cards cards={panel.shown} turnKey={turnKey} {...cluster} />
      {panel.unverified.map((reference) => (
        <div
          key={reference.asStated}
          style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10, padding: "12px 20px", borderRadius: "var(--radius-lg)", background: "var(--color-warn-soft)", color: "var(--color-warn)", fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}
        >
          <svg style={{ flex: "none", marginTop: 1 }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={COPY.unverifiedInPanel(reference.asStated)}>
            {COPY.unverifiedInPanel(reference.asStated)}
          </span>
        </div>
      ))}
      {folded === null ? null : (
        <>
          <button
            type="button"
            aria-expanded={unfolded}
            onClick={() => setUnfolded(!unfolded)}
            style={{ display: "flex", alignItems: "center", gap: 8, marginTop: panel.unverified.length > 0 ? 8 : 10, padding: "12px 18px", borderRadius: "var(--radius-full)", border: "1px dashed var(--color-rule)", fontSize: 13, fontWeight: 500, color: "var(--color-ink-muted)", textAlign: "left", cursor: "pointer", background: "transparent", font: "inherit" }}
            data-fold={folded.label}
          >
            {folded.label === "other" ? COPY.foldOther(folded.count) : COPY.foldUncited(folded.count)}
            {CHEVRON}
          </button>
          {unfolded ? (
            <div className="sx-list" style={{ marginTop: 8 }}>
              <Cards cards={folded.cards} turnKey={turnKey} {...cluster} />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function Earlier({ group, ...cluster }: { group: EarlierPanel } & Cluster) {
  const targeted = cluster.preview?.turn === group.turnKey;
  const [open, setOpen] = useState(targeted);
  useEffect(() => {
    if (targeted) setOpen(true);
  }, [targeted]);
  const { shown } = group.panel;
  return (
    <>
      <SourceTurnGroup state="earlier" turn={`Pertanyaan ${group.turn}`} count={COPY.panelBadge(shown.length, "dikutip")} question={group.question} onClick={() => setOpen(!open)} />
      {open ? (
        <div className="sx-list">
          <Cards cards={shown} turnKey={group.turnKey} {...cluster} />
        </div>
      ) : null}
    </>
  );
}

const CLOSE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/** The cards of a panel and of the earlier questions, the part the reader's Sumber tab shows too. */
export function SourcesBody({ panel, turnKey, earlier, preview, onPreview, onOpen }: Omit<SourcesPanelProps, "onClose">) {
  const cluster = { preview, onPreview, onOpen };
  return (
    <>
      <Current panel={panel} turnKey={turnKey} {...cluster} />
      {earlier.length === 0 ? null : (
        <div className="sx-list" style={{ marginTop: 14 }}>
          {earlier.map((group) => (
            <Earlier key={group.turn} group={group} {...cluster} />
          ))}
        </div>
      )}
      <Legend />
    </>
  );
}

/**
 * The panel is the surface the Sumber button turns into. While it grows, its title travels from the button's label and everything
 * else waits; while it shrinks home it leaves the layout, so the conversation takes its room back at once. Under reduced motion the
 * surface does not move: it only fades.
 */
export function SourcesPanel({ panel, turnKey, earlier, preview, onPreview, onOpen, onClose }: SourcesPanelProps) {
  const present = useIsPresent();
  const reduced = useReducedMotion() === true;
  const [growing, setGrowing] = useState(true);
  useEffect(() => {
    if (reduced) setGrowing(false);
  }, [reduced]);
  const fade = contentFade(reduced ? 0 : MOTION.sourcesOffsetPx);
  return (
    <PanelGrowing value={growing}>
      <motion.aside
        layoutId={SURFACE}
        tabIndex={-1}
        inert={!present}
        aria-label={COPY.sources}
        data-panel="sources"
        data-closing={!present}
        className="sx"
        style={SURFACE_RADII}
        transition={{ layout: OPEN_SPRING }}
        initial={reduced ? { opacity: 0 } : undefined}
        animate={{ opacity: 1 }}
        exit={reduced ? { opacity: 0 } : undefined}
        onLayoutAnimationComplete={() => setGrowing(false)}
      >
        <div className="sx-head">
          <motion.span layoutId={ICON} transition={{ layout: OPEN_SPRING }} style={{ display: "inline-flex" }}>
            {BOOK}
          </motion.span>
          <motion.div layoutId={LABEL} transition={{ layout: OPEN_SPRING }} style={{ fontSize: 15, fontWeight: 600 }}>
            {COPY.sources}
          </motion.div>
          <motion.span className="sx-count" {...fade}>
            {COPY.panelBadge(panel.heading.count, panel.heading.label)}
          </motion.span>
          <motion.button type="button" className="icon-btn" style={{ marginLeft: "auto", cursor: "pointer", ...BUTTON_RADII }} aria-label={COPY.sourcesCloseAria} onClick={onClose} {...fade}>
            {CLOSE}
          </motion.button>
        </div>
        <motion.div className="sx-body sx-list" {...fade}>
          <SourcesBody panel={panel} turnKey={turnKey} earlier={earlier} preview={preview} onPreview={onPreview} onOpen={onOpen} />
        </motion.div>
      </motion.aside>
    </PanelGrowing>
  );
}
