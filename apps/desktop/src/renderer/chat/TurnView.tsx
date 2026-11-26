import { useEffect, useRef, useState } from "react";
import { RESTART_WHY, citedOf, fallbackNotice, type PassageId } from "@hpt/server/client";
import { MOTION } from "../motion.ts";
import { Button, Disclaimer, EarlierTurn, RecheckNotice, SkeletonRow, ThinkingStatus } from "../ui/index.ts";
import { AnswerCardView } from "./AnswerCardView.tsx";
import { COPY } from "./copy.ts";
import { NoticeView } from "./NoticeView.tsx";
import { ReplyView } from "./ReplyView.tsx";
import type { Turn } from "./store.ts";
import { tallyOf, viewOf, type RunView } from "./view.ts";

export type TurnViewProps = {
  turn: Turn;
  /** The last turn is open. Earlier answers fold into one card. */
  latest: boolean;
  active: PassageId | null;
  onCite: (id: PassageId) => void;
  onPick: (option: string) => void;
  onRetry: () => void;
  onCancel: () => void;
};

const BUBBLE_STYLE = { maxWidth: 560, padding: "13px 20px", background: "var(--color-surface)", borderRadius: "var(--radius-lg) 8px var(--radius-lg) var(--radius-lg)", fontSize: 15.5, fontWeight: 500, lineHeight: 1.45, overflowWrap: "anywhere" } as const;

const CHECK = (
  <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: "var(--radius-full)", background: "var(--color-accent-soft)", color: "var(--color-accent)", alignItems: "center", justifyContent: "center" }}>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  </span>
);

function Status({ turn, view, onCancel }: { turn: Turn; view: RunView; onCancel: () => void }) {
  const { run } = turn;
  const running = run.outcome === null;
  if (view.kind === "notice" || view.kind === "reply") return null;
  if (running) {
    const text = view.kind === "working" && view.step === "searching" ? COPY.searching : COPY.thinking;
    return (
      <div style={{ display: "flex", alignItems: "center", margin: "18px 4px 12px" }}>
        <ThinkingStatus t={text} />
        <span style={{ marginLeft: "auto" }}>
          <Button tone="ghost" label={COPY.cancel} onClick={onCancel} />
        </span>
      </div>
    );
  }
  const { searched, cited } = tallyOf(run);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 4px 12px", fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-ink-muted)" }}>
      {CHECK}
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{cited === 0 ? COPY.searchedOnly(searched) : COPY.searchedCited(searched, cited)}</span>
    </div>
  );
}

type AnswerView = Extract<RunView, { kind: "answer" }>;

/** The old card fades out for `restartFadeOutMs` before the recheck line fades in, so the two never overlap. */
function useRestartHold(view: RunView): AnswerView | null {
  const lastAnswer = useRef<AnswerView | null>(null);
  if (view.kind === "answer") lastAnswer.current = view;
  const [released, setReleased] = useState(false);
  useEffect(() => {
    if (view.kind !== "rechecking") {
      setReleased(false);
      return;
    }
    const timer = setTimeout(() => setReleased(true), MOTION.restartFadeOutMs);
    return () => clearTimeout(timer);
  }, [view.kind]);
  return view.kind === "rechecking" && !released ? lastAnswer.current : null;
}

function Rechecking({ copy }: { copy: string }) {
  return (
    <div className="m-restart-in">
      <section style={{ background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "26px 28px 26px" }} data-card="rechecking">
        <div className="lbl" style={{ color: "var(--color-accent)" }}>
          {COPY.answerLabel}
        </div>
        <div style={{ marginTop: 14 }}>
          <RecheckNotice text={copy} nt={RESTART_WHY} />
        </div>
        <div style={{ margin: "22px 0 0 22px", maxWidth: 560 }}>
          <div className="sk" style={{ width: "100%", height: 12 }} />
          <div className="sk" style={{ width: "92%", height: 12, marginTop: 11 }} />
          <div className="sk" style={{ width: "58%", height: 12, marginTop: 11 }} />
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 10 }}>
        <SkeletonRow pos="first" />
        <SkeletonRow pos="last" />
      </section>
      <div style={{ margin: "16px 4px 0" }}>
        <Disclaimer t={COPY.disclaimer} />
      </div>
    </div>
  );
}

export function TurnView({ turn, latest, active, onCite, onPick, onRetry, onCancel }: TurnViewProps) {
  const [open, setOpen] = useState(false);
  const { run } = turn;
  const current = viewOf(run);
  const held = useRestartHold(current);
  const view: RunView = held ?? current;
  const cited = citedOf(run.answer);
  const numberOf = (id: PassageId) => {
    const at = cited.indexOf(id);
    return at === -1 ? null : at + 1;
  };
  const context = { numberOf, active, onCite, sources: run.sources };

  const bubble = (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={BUBBLE_STYLE}>{turn.question}</div>
    </div>
  );
  const answer = view.kind === "answer" ? <AnswerCardView card={view.card} context={context} revealOnArrival={turn.fresh && run.outcome === null} /> : null;

  if (!latest && view.kind === "answer" && view.card.finished) {
    const { headline } = view.card;
    return (
      <div data-turn={turn.key} data-run="done" data-view="earlier" style={{ marginBottom: 14 }}>
        <EarlierTurn
          state={open ? "open" : "closed"}
          question={turn.question}
          verdict={headline?.text ?? ""}
          inferred={headline?.inferred ?? false}
          sources={COPY.earlierSources(cited.length)}
          answer={answer}
          onToggle={() => setOpen(!open)}
        />
      </div>
    );
  }

  return (
    <div data-turn={turn.key} data-run={run.outcome === null ? "running" : "done"} data-view={view.kind} style={{ marginBottom: latest ? 0 : 28 }}>
      {bubble}
      <Status turn={turn} view={view} onCancel={onCancel} />
      {view.kind === "answer" ? <FallbackLine turn={turn} /> : null}
      {view.kind === "rechecking" ? <Rechecking copy={view.copy} /> : null}
      {view.kind === "answer" ? (
        <div className="m-hold" data-leaving={held !== null}>
          {answer}
        </div>
      ) : null}
      {view.kind === "reply" ? (
        <div style={{ marginTop: view.type === "clarify" ? 22 : 18 }}>
          <ReplyView reply={view} onPick={onPick} />
        </div>
      ) : null}
      {view.kind === "notice" ? (
        <div style={{ marginTop: 18 }}>
          <NoticeView notice={view} onRetry={onRetry} />
        </div>
      ) : null}
    </div>
  );
}

function FallbackLine({ turn }: { turn: Turn }) {
  const { fallback } = turn.run;
  if (fallback === null) return null;
  return (
    <p style={{ margin: "-4px 4px 12px", fontSize: 12.5, fontWeight: 500, color: "var(--color-warn)" }} data-fallback={fallback.route.model}>
      {fallbackNotice(fallback.route, fallback.from)}
    </p>
  );
}
