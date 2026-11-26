import { useEffect, useRef, useState } from "react";
import type { PassageId } from "@hpt/server/client";
import { Aura, StateNotice } from "../ui/index.ts";
import { ComposerBar } from "./ComposerBar.tsx";
import { connectionOf } from "./connection.ts";
import { useChat, useHost } from "./context.tsx";
import { COPY } from "./copy.ts";
import { Sidebar } from "./Sidebar.tsx";
import { SourcesPanel, type EarlierPanel } from "./SourcesPanel.tsx";
import { isBusy } from "./store.ts";
import { TurnView } from "./TurnView.tsx";
import { panelOf } from "./view.ts";

const TITLE_CHARS = 48;
const COLUMN = 688;

const titleOf = (question: string): string => (question.length <= TITLE_CHARS ? question : `${question.slice(0, TITLE_CHARS).replace(/\s+\S*$/, "")}…`);

const clock = (at: number): string => {
  const date = new Date(at);
  return `Hari ini, ${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`;
};

function HostNotice() {
  const host = useHost();
  if (host.kind === "down") return <StateNotice kind="koneksi" title="Mesin jawaban berhenti" body={host.reason} />;
  if (host.kind === "ready" && host.status.index.state === "unavailable") return <StateNotice kind="koneksi" title={COPY.indexUnavailableTitle} body={host.status.index.message} />;
  return null;
}

export function ChatScreen() {
  const host = useHost();
  const turns = useChat((state) => state.turns);
  const draft = useChat((state) => state.draft);
  const choice = useChat((state) => state.choice);
  const active = useChat((state) => state.openSource);
  const busy = useChat(isBusy);
  const { setDraft, chooseModel, selectSource, send, cancel, retry, newConversation } = useChat((state) => state);
  const [closed, setClosed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const latest = turns.at(-1);
  const panel = latest === undefined ? null : panelOf(latest.run);
  const earlier: EarlierPanel[] = turns.slice(0, -1).flatMap((turn, index) => {
    const found = panelOf(turn.run);
    return found === null ? [] : [{ turn: index + 1, question: turn.question, panel: found }];
  });
  const models = host.kind === "ready" ? host.status.models : [];
  const connection = connectionOf(host, turns);
  const unusable = host.kind !== "ready" || host.status.index.state === "unavailable";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  const cite = (id: PassageId) => {
    setClosed(false);
    selectSource(id);
  };
  const ask = (text: string) => {
    setClosed(false);
    send(text);
  };
  const showPanel = panel !== null && !closed;
  const bar = (
    <ComposerBar
      draft={draft}
      busy={busy}
      followUp={turns.length > 0}
      disabled={unusable}
      models={models}
      choice={choice}
      connected={connection.state === "connected"}
      onDraft={setDraft}
      onChoose={chooseModel}
      onSend={() => ask(draft)}
    />
  );

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--color-surface)" }} data-host={host.kind} data-screen={turns.length === 0 ? "home" : "chat"}>
      <Sidebar title={turns[0] === undefined ? null : titleOf(turns[0].question)} connection={connection} canStartNew={!busy && turns.length > 0} onNew={newConversation} />
      <main style={{ position: "relative", flex: 1, minWidth: 0, margin: showPanel ? "8px 0" : "8px 8px 8px 0", background: "var(--color-ground)", borderRadius: showPanel ? "var(--radius-lg) 0 0 var(--radius-lg)" : "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {turns.length === 0 ? (
          <>
            <Aura state={draft === "" ? "idle" : "compose"} />
            <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 32px 40px", textAlign: "center" }}>
              <h1 style={{ fontFamily: "var(--font-read)", fontWeight: 400, fontSize: 40, lineHeight: 1.15, letterSpacing: "-.01em", textWrap: "balance" }}>{COPY.greeting}</h1>
              <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: "var(--color-ink-muted)", marginTop: 10, textWrap: "balance" }}>{COPY.greetingHint}</p>
              <div style={{ width: COLUMN, marginTop: 36, textAlign: "left" }}>
                <div style={{ marginBottom: 16 }}>
                  <HostNotice />
                </div>
                {bar}
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 68, flex: "none", padding: "0 20px 0 28px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{turns[0] === undefined ? "" : titleOf(turns[0].question)}</div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-ink-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {COPY.questionCount(turns.length)} · {clock(turns[0]?.at ?? Date.now())}
                </div>
              </div>
            </div>
            <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 0 20px" }}>
              <div style={{ width: COLUMN, margin: "0 auto" }}>
                {turns.map((turn, index) => (
                  <TurnView key={turn.key} turn={turn} latest={index === turns.length - 1} active={active} onCite={cite} onPick={ask} onRetry={retry} onCancel={cancel} />
                ))}
                <div style={{ marginTop: 16 }}>
                  <HostNotice />
                </div>
              </div>
            </div>
            <div style={{ flex: "none", width: COLUMN, margin: "0 auto", padding: "0 0 18px" }}>{bar}</div>
          </>
        )}
      </main>
      {panel === null || !showPanel ? null : <SourcesPanel panel={panel} earlier={earlier} active={active} onClose={() => setClosed(true)} />}
    </div>
  );
}
