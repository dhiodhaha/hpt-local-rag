import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import type { PassageId } from "@hpt/server/client";
import { MOTION } from "../motion.ts";
import { auraStateOf, isFirstAsk } from "../aura.ts";
import { Aura, StateNotice, TipButton } from "../ui/index.ts";
import { ReaderLayer } from "../reader/index.ts";
import { AllConversations } from "./AllConversations.tsx";
import { ComposerBar } from "./ComposerBar.tsx";
import { connectionOf } from "./connection.ts";
import { useChat, useHost } from "./context.tsx";
import { Conversation } from "./Conversation.tsx";
import { COPY } from "./copy.ts";
import { Home } from "./Home.tsx";
import { provenanceOf, type Provenance } from "./provenance.ts";
import { RiwayatLayer } from "./RiwayatLayer.tsx";
import { stampOf } from "./riwayat.ts";
import { useLeaveHold } from "./useLeaveHold.ts";
import { Sidebar } from "./Sidebar.tsx";
import { SourcesPanel, type EarlierPanel, type Preview } from "./SourcesPanel.tsx";
import { isBusy } from "./store.ts";
import { conversationShowsDisclaimer, panelOf } from "./view.ts";

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

const PANEL_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9.5 4v16" />
  </svg>
);

const isShortcut = (event: KeyboardEvent, key: string) => (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === key;

export function ChatScreen() {
  const host = useHost();
  const turns = useChat((state) => state.turns);
  const draft = useChat((state) => state.draft);
  const choice = useChat((state) => state.choice);
  const reader = useChat((state) => state.reader);
  const screen = useChat((state) => state.screen);
  const conversation = useChat((state) => state.conversation);
  const history = useChat((state) => state.history);
  const busy = useChat(isBusy);
  const { setDraft, chooseModel, openReader, send, cancel, retry, newConversation, refreshHistory } = useChat((state) => state);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const hits = useRef(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);

  const latest = turns.at(-1);
  const panel = latest === undefined || screen === "all" ? null : panelOf(latest.run);
  const earlier: EarlierPanel[] = turns.slice(0, -1).flatMap((turn, index) => {
    const found = panelOf(turn.run);
    return found === null ? [] : [{ turn: index + 1, turnKey: turn.key, question: turn.question, panel: found }];
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
  const firstTurn = turns[0]?.key ?? null;

  useEffect(() => {
    if (hostReady) void refreshHistory();
  }, [hostReady, refreshHistory]);

  useEffect(() => {
    const onFocus = () => void refreshHistory();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshHistory]);

  useEffect(() => {
    setSourcesOpen(false);
    setPreview(null);
  }, [firstTurn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isShortcut(event, "k")) {
        event.preventDefault();
        if (canStartNew) newConversation();
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus());
      } else if (isShortcut(event, "b")) {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canStartNew, newConversation]);

  const ask = (text: string, provenance: Provenance) => send(text, provenance);
  const setSources = (next: boolean) => {
    if (next === sourcesOpen) return;
    if (!next) setPreview((current) => (current === null ? null : { turn: current.turn, passage: current.passage }));
    setSourcesOpen(next);
    if (!next) requestAnimationFrame(() => document.querySelector<HTMLElement>(".cv-src")?.focus());
  };
  const showSource = (turnKey: string, passage: PassageId) => {
    setSources(true);
    hits.current += 1;
    setPreview({ turn: turnKey, passage, hit: hits.current });
  };
  const toggleSource = (turnKey: string, passage: PassageId) => setPreview(preview?.turn === turnKey && preview.passage === passage ? null : { turn: turnKey, passage });
  const showPanel = panel !== null && sourcesOpen;

  useEffect(() => {
    if (showPanel) document.querySelector<HTMLElement>("[data-panel='sources']")?.focus({ preventScroll: true });
  }, [showPanel]);

  const closeFromKeyboard = useRef(() => {});
  closeFromKeyboard.current = () => setSources(false);
  useEffect(() => {
    if (!showPanel || reader !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!document.querySelector("[data-panel='sources']")?.contains(document.activeElement)) return;
      event.preventDefault();
      closeFromKeyboard.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPanel, reader]);
  const active = reader?.passage ?? (showPanel ? (preview?.passage ?? null) : null);
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
      onSend={(provenance) => ask(draft, provenance)}
      boxRef={setBox}
    />
  );

  const screens = {
    all: <AllConversations />,
    home: <Home notice={<HostNotice />} bar={bar} firstVisit={firstVisit} unusable={unusable} onAsk={ask} />,
    chat: (
      <Conversation
        turns={turns}
        conversation={conversation}
        title={title}
        meta={`${COPY.questionCount(turns.length)} · ${stampOf(turns[0]?.at ?? Date.now(), new Date())}`}
        active={active}
        sources={panel === null ? null : panel.heading.count}
        sourcesOpen={showPanel}
        disclaimer={conversationShowsDisclaimer(turns.map((turn) => turn.run))}
        notice={<HostNotice />}
        bar={bar}
        onSources={() => setSources(!sourcesOpen)}
        onCite={showSource}
        onOpen={openReader}
        onPick={(option, event) => ask(option, provenanceOf("clarify", event))}
        onRetry={(event) => retry(provenanceOf("retry", event))}
        onCancel={cancel}
      />
    ),
  } as const;

  const leaving = useLeaveHold(screenName, "chat", "home", MOTION.restartFadeOutMs);
  const lastChat = useRef<ReactNode>(null);
  if (screenName === "chat") lastChat.current = screens.chat;
  const shownName = leaving ? "chat" : screenName;

  useEffect(() => {
    if (leaving || screenName !== "home") return;
    if (document.activeElement === null || document.activeElement === document.body) document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [leaving, screenName]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="cs-root" data-host={host.kind} data-screen={screenName} data-sidebar={sidebarOpen ? "open" : "closed"}>
      <div style={{ display: "contents" }} inert={reader !== null}>
        <div className="rw-wrap" inert={!sidebarOpen}>
          <Sidebar connection={connection} canStartNew={canStartNew} onNew={newConversation} onHide={() => setSidebarOpen(false)} />
        </div>
        <main className="cv-main" data-panel={showPanel ? "open" : "closed"}>
          {sidebarOpen ? null : (
            <div className="cv-show">
              <TipButton label={COPY.showSidebar} kbd={COPY.sidebarKbd} onClick={() => setSidebarOpen(true)}>
                {PANEL_ICON}
              </TipButton>
            </div>
          )}
          <Aura state={auraStateOf({ screen: screenName, firstAsk: isFirstAsk(turns), busy, draft })} box={box} />
          <div key={shownName} className="cv-screen" data-leaving={leaving} inert={leaving}>
            {leaving ? lastChat.current : screens[screenName]}
          </div>
        </main>
        <AnimatePresence>
          {panel === null || !showPanel || latest === undefined ? null : (
            <SourcesPanel key="sumber-panel" panel={panel} turnKey={latest.key} earlier={earlier} preview={preview} onPreview={toggleSource} onOpen={openReader} onClose={() => setSources(false)} />
          )}
        </AnimatePresence>
      </div>
      <ReaderLayer />
      <RiwayatLayer />
    </div>
    </MotionConfig>
  );
}
