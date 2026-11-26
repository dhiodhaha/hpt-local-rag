import { useEffect, useRef, useState } from "react";
import type { PassageId } from "@hpt/server/client";
import { Aura, StateNotice, SuggestionChip } from "../ui/index.ts";
import { AllConversations } from "./AllConversations.tsx";
import { ComposerBar } from "./ComposerBar.tsx";
import { connectionOf } from "./connection.ts";
import { useChat, useHost } from "./context.tsx";
import { COPY } from "./copy.ts";
import { RiwayatLayer } from "./RiwayatLayer.tsx";
import { stampOf } from "./riwayat.ts";
import { Sidebar } from "./Sidebar.tsx";
import { SourcesPanel, type EarlierPanel } from "./SourcesPanel.tsx";
import { isBusy } from "./store.ts";
import { TurnView } from "./TurnView.tsx";
import { panelOf } from "./view.ts";

const COLUMN = 688;
const FOLLOW_PX = 120;

type ScreenName = "all" | "home" | "chat";

function screenNameOf(screen: "chat" | "all", turnCount: number): ScreenName {
  if (screen === "all") return "all";
  return turnCount === 0 ? "home" : "chat";
}

function HostNotice() {
  const host = useHost();
  if (host.kind === "down") return <StateNotice kind="koneksi" title="Mesin jawaban berhenti" body={host.reason} />;
  if (host.kind === "ready" && host.status.index.state === "unavailable") return <StateNotice kind="koneksi" title={COPY.indexUnavailableTitle} body={host.status.index.message} />;
  return null;
}

function useFollow(turnCount: number, conversation: string | null) {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    const inner = column.current;
    if (element === null || inner === null) return;
    const onScroll = () => {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
    };
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTo({ top: element.scrollHeight });
    });
    element.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(inner);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [turnCount > 0]);

  useEffect(() => {
    following.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turnCount, conversation]);

  return { scroller, column };
}

export function ChatScreen() {
  const host = useHost();
  const turns = useChat((state) => state.turns);
  const draft = useChat((state) => state.draft);
  const choice = useChat((state) => state.choice);
  const active = useChat((state) => state.openSource);
  const screen = useChat((state) => state.screen);
  const conversation = useChat((state) => state.conversation);
  const history = useChat((state) => state.history);
  const busy = useChat(isBusy);
  const { setDraft, chooseModel, selectSource, send, cancel, retry, newConversation, refreshHistory } = useChat((state) => state);
  const [closed, setClosed] = useState(false);
  const { scroller, column } = useFollow(turns.length, conversation);

  const latest = turns.at(-1);
  const panel = latest === undefined || screen === "all" ? null : panelOf(latest.run);
  const earlier: EarlierPanel[] = turns.slice(0, -1).flatMap((turn, index) => {
    const found = panelOf(turn.run);
    return found === null ? [] : [{ turn: index + 1, question: turn.question, panel: found }];
  });
  const models = host.kind === "ready" ? host.status.models : [];
  const connection = connectionOf(host, turns);
  const screenName = screenNameOf(screen, turns.length);
  const unusable = host.kind !== "ready" || host.status.index.state === "unavailable";
  const hostReady = host.kind === "ready";
  const canStartNew = !busy && (turns.length > 0 || screen === "all");
  const firstVisit = history.state === "ready" && history.conversations.length === 0;
  const stored = history.conversations.find((entry) => entry.id === conversation);
  const title = stored?.title ?? turns[0]?.question ?? "";

  useEffect(() => {
    if (hostReady) void refreshHistory();
  }, [hostReady, refreshHistory]);

  useEffect(() => {
    const onFocus = () => void refreshHistory();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshHistory]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (canStartNew) newConversation();
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canStartNew, newConversation]);

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

  const home = (
    <>
      <Aura state={draft === "" ? "idle" : "compose"} />
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 32px 40px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-read)", fontWeight: 400, fontSize: 46, lineHeight: 1.1, letterSpacing: "-.015em", textWrap: "balance" }}>{COPY.greeting}</h1>
        <p style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.5, color: "var(--color-ink-muted)", marginTop: 12, textWrap: "balance" }}>{COPY.greetingHint}</p>
        <div style={{ width: COLUMN, marginTop: 36, textAlign: "left" }}>
          <div style={{ marginBottom: 16 }}>
            <HostNotice />
          </div>
          {bar}
          {firstVisit ? (
            <div style={{ marginTop: 28 }}>
              <div className="lbl" style={{ padding: "0 4px 10px", color: "var(--color-ink-muted)" }}>
                {COPY.riwayat.suggestLabel}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {COPY.riwayat.suggestions.map((text) => (
                  <SuggestionChip key={text} label={text} disabled={unusable} onClick={() => ask(text)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );

  const chat = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 68, flex: "none", padding: "0 20px 0 28px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-ink-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {COPY.questionCount(turns.length)} · {stampOf(turns[0]?.at ?? Date.now(), new Date())}
          </div>
        </div>
      </div>
      <div ref={scroller} className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 0 28px" }}>
        <div ref={column} style={{ width: COLUMN, margin: "0 auto" }}>
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
  );

  const screens = { all: <AllConversations />, home, chat } as const;

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--color-surface)" }} data-host={host.kind} data-screen={screenName}>
      <Sidebar connection={connection} canStartNew={canStartNew} onNew={newConversation} />
      <main style={{ position: "relative", flex: 1, minWidth: 0, margin: showPanel ? "8px 0" : "8px 8px 8px 0", background: "var(--color-ground)", borderRadius: showPanel ? "var(--radius-lg) 0 0 var(--radius-lg)" : "var(--radius-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {screens[screenName]}
      </main>
      {panel === null || !showPanel ? null : <SourcesPanel panel={panel} earlier={earlier} active={active} onClose={() => setClosed(true)} />}
      <RiwayatLayer />
    </div>
  );
}
