import { useEffect, useRef, useState, type MouseEvent } from "react";
import { RESTART_WHY, fallbackNotice, type PassageId } from "@hpt/server/client";
import { MOTION } from "../motion.ts";
import { Button, Presence, RecheckNotice, ThinkingStatus, VerifyMark } from "../ui/index.ts";
import { AnswerArticle } from "./AnswerArticle.tsx";
import { citedInReadingOrder } from "./cited.ts";
import { COPY } from "./copy.ts";
import { NoticeView } from "./NoticeView.tsx";
import { ReplyView } from "./ReplyView.tsx";
import type { Turn } from "./store.ts";
import { viewOf, type RunView } from "./view.ts";

export type TurnViewProps = {
  turn: Turn;
  active: PassageId | null;
  /** A citation mark or a margin note: the Sumber panel previews that source. */
  onCite: (id: PassageId) => void;
  /** "Buka sumber": the reader. */
  onOpen: (id: PassageId) => void;
  onPick: (option: string, event: MouseEvent<HTMLButtonElement>) => void;
  onRetry: (event: MouseEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
};

type AnswerView = Extract<RunView, { kind: "answer" }>;

function Status({ view, onCancel }: { view: RunView; onCancel: () => void }) {
  const text = view.kind === "working" && view.step === "searching" ? COPY.searching : COPY.thinking;
  const verifying = view.kind === "answer" && view.card.lead.headline?.verifying === true;
  return (
    <div className="cv-status">
      <ThinkingStatus t={text} />
      <Presence show={verifying} exitMs={MOTION.verifyPillFadeMs}>
        {(closing) => (
          <span className="m-verify" data-closing={closing} data-headline={closing ? "settling" : "verifying"}>
            <VerifyMark />
          </span>
        )}
      </Presence>
      <span style={{ marginLeft: "auto" }}>
        <Button tone="ghost" label={COPY.cancel} onClick={onCancel} />
      </span>
    </div>
  );
}

/** The old answer fades out for `restartFadeOutMs` before the recheck line fades in, so the two never overlap. */
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
    <div className="m-restart-in cv-text" data-card="rechecking">
      <RecheckNotice text={copy} nt={RESTART_WHY} />
      <div className="cv-recheck-sk">
        <div className="sk" style={{ width: "100%", height: 14 }} />
        <div className="sk" style={{ width: "92%", height: 14, marginTop: 11 }} />
        <div className="sk" style={{ width: "58%", height: 14, marginTop: 11 }} />
      </div>
    </div>
  );
}

function FallbackLine({ turn }: { turn: Turn }) {
  const { fallback } = turn.run;
  if (fallback === null) return null;
  return (
    <p className="cv-text cv-fallback" data-fallback={fallback.route.model}>
      {fallbackNotice(fallback.route, fallback.from)}
    </p>
  );
}

export function TurnView({ turn, active, onCite, onOpen, onPick, onRetry, onCancel }: TurnViewProps) {
  const { run } = turn;
  const current = viewOf(run);
  const held = useRestartHold(current);
  const view: RunView = held ?? current;
  const cited = citedInReadingOrder(run.answer);
  const numberOf = (id: PassageId) => {
    const at = cited.indexOf(id);
    return at === -1 ? null : at + 1;
  };
  const running = run.outcome === null && view.kind !== "notice" && view.kind !== "reply";
  return (
    <div className="cv-turn" data-turn={turn.key} data-run={run.outcome === null ? "running" : "done"} data-view={view.kind}>
      <div className="cv-text">
        <div className="cv-bub">{turn.question}</div>
      </div>
      {running ? (
        <div className="cv-text">
          <Status view={view} onCancel={onCancel} />
        </div>
      ) : null}
      {view.kind === "answer" ? <FallbackLine turn={turn} /> : null}
      {view.kind === "rechecking" ? <Rechecking copy={view.copy} /> : null}
      {view.kind === "answer" ? (
        <div className="m-hold" data-leaving={held !== null}>
          <AnswerArticle article={view.card} context={{ numberOf, active, onCite, onOpen }} revealOnArrival={turn.fresh && run.outcome === null} settled={run.summaryDone} />
        </div>
      ) : null}
      {view.kind === "reply" ? (
        <div className="cv-text" style={{ marginTop: view.type === "clarify" ? 22 : 18 }}>
          <ReplyView reply={view} onPick={onPick} />
        </div>
      ) : null}
      {view.kind === "notice" ? (
        <div className="cv-text" style={{ marginTop: 18 }}>
          <NoticeView notice={view} onRetry={onRetry} />
        </div>
      ) : null}
    </div>
  );
}

