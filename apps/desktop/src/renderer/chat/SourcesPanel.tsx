import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PassageId } from "@hpt/server/client";
import { Badge, SourceTurnGroup } from "../ui/index.ts";
import { COPY } from "./copy.ts";
import type { PanelCard, SourcesPanel as Panel } from "./view.ts";

export type EarlierPanel = { readonly turn: number; readonly question: string; readonly panel: Panel };

export type SourcesPanelProps = {
  panel: Panel;
  earlier: readonly EarlierPanel[];
  active: PassageId | null;
  onClose: () => void;
};

const RADIUS_BIG = "var(--radius-md)";

function cornersOf(index: number, total: number): CSSProperties {
  if (total === 1) return { borderRadius: RADIUS_BIG };
  if (index === 0) return { borderRadius: `${RADIUS_BIG} ${RADIUS_BIG} 6px 6px` };
  return index === total - 1 ? { borderRadius: `6px 6px ${RADIUS_BIG} ${RADIUS_BIG}` } : { borderRadius: 6 };
}

function Card({ card, style, active }: { card: PanelCard; style: CSSProperties; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div ref={ref} className="scard" style={{ ...style, ...(active ? { boxShadow: "inset 0 0 0 1.5px var(--color-accent)" } : {}) }} data-source={card.id}>
      <div className="h">
        <span className={card.number === null ? "num wait" : "num"}>{card.number ?? "·"}</span>
        <div className="nm">{card.title}</div>
      </div>
      <div className="badges">
        <Badge tone="kind" t={card.typeLabel} />
        {card.status === "active" ? <Badge tone="berlaku" t="Berlaku" /> : <Badge tone="direvisi" t="Direvisi" />}
      </div>
      {card.where === null ? null : <div className="meta">{card.where}</div>}
      <div className="sc-ring">{COPY.sourcesSummary}</div>
      <p className="sum">{card.gist}</p>
      {card.priorTurn === null ? null : <p className="meta">{COPY.priorTurn(card.priorTurn)}</p>}
    </div>
  );
}

const CHEVRON = (
  <svg style={{ marginLeft: "auto" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function Cards({ cards, active }: { cards: readonly PanelCard[]; active: PassageId | null }) {
  return cards.map((card, index) => <Card key={card.id} card={card} style={cornersOf(index, cards.length)} active={active === card.id} />);
}

function Current({ panel, active }: { panel: Panel; active: PassageId | null }) {
  const [unfolded, setUnfolded] = useState(false);
  const { folded } = panel;
  return (
    <>
      {panel.hint === null ? null : (
        <p style={{ padding: "0 6px 10px", fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, color: "var(--color-ink-muted)" }}>{panel.hint === "numbers-follow" ? COPY.numbersFollow : COPY.numbersReturn}</p>
      )}
      <Cards cards={panel.shown} active={active} />
      {panel.unverified.map((reference) => (
        <div
          key={reference.asStated}
          style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10, padding: "12px 16px", borderRadius: "var(--radius-md)", border: "1px dashed var(--color-rule)", background: "var(--color-warn-soft)", color: "var(--color-warn)", fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
              <Cards cards={folded.cards} active={active} />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function Earlier({ group, active }: { group: EarlierPanel; active: PassageId | null }) {
  const [open, setOpen] = useState(false);
  const shown = group.panel.shown;
  return (
    <>
      <SourceTurnGroup state="earlier" turn={`Pertanyaan ${group.turn}`} count={COPY.panelBadge(shown.length, "dikutip")} question={group.question} onClick={() => setOpen(!open)} />
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Cards cards={shown} active={active} />
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

export function SourcesPanel({ panel, earlier, active, onClose }: SourcesPanelProps) {
  return (
    <aside
      aria-label={COPY.sources}
      data-panel="sources"
      style={{ width: 408, flex: "none", margin: "8px 8px 8px 0", background: "var(--color-ground)", borderRadius: "0 var(--radius-lg) var(--radius-lg) 0", borderLeft: "1px solid var(--color-rule)", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 68, flex: "none", padding: "0 12px 0 24px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{COPY.sources}</div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-full)", background: "var(--color-surface)", color: "var(--color-ink-muted)", fontVariantNumeric: "tabular-nums" }}>
          {COPY.panelBadge(panel.heading.count, panel.heading.label)}
        </span>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto", cursor: "pointer" }} aria-label={COPY.sourcesClose} onClick={onClose}>
          {CLOSE}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
        <Current panel={panel} active={active} />
        {earlier.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 14 }}>
            {earlier.map((group) => (
              <Earlier key={group.turn} group={group} active={active} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
