import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { ConversationHit } from "@hpt/server/client";
import { ConnectionStatus, GroupLabel, NavItem, NewChatButton, SearchField } from "../ui/index.ts";
import { PROVIDER_LOGOS } from "../ui/providerLogos.ts";
import { ConversationRow } from "./ConversationRow.tsx";
import { useChat } from "./context.tsx";
import { COPY } from "./copy.ts";
import type { ConnectionView } from "./connection.ts";
import { groupByDay } from "./riwayat.ts";

export type SidebarProps = {
  connection: ConnectionView;
  canStartNew: boolean;
  onNew: () => void;
};

const SIDEBAR_ROWS = 30;

const SEARCH_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const LIST_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
);

const LOCK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

function EmptyHistory() {
  return (
    <>
      <GroupLabel t={COPY.riwayat.groupLabel} />
      <div className="rw-empty" data-state="empty">
        <p className="rw-empty-t">{COPY.riwayat.emptyTitle}</p>
        <p className="rw-empty-b">{COPY.riwayat.emptyBody}</p>
        <p className="rw-empty-n">
          {LOCK}
          {COPY.riwayat.onDevice}
        </p>
      </div>
    </>
  );
}

function LoadingHistory() {
  return (
    <div className="rw-loading" aria-hidden="true" data-state="loading">
      {[72, 54, 64, 48].map((width) => (
        <div key={width} className="sk" style={{ width: `${width}%`, height: 12 }} />
      ))}
    </div>
  );
}

function History({ now }: { now: Date }) {
  const history = useChat((state) => state.history);
  const { refreshHistory } = useChat((state) => state);
  let left = SIDEBAR_ROWS;
  const groups = groupByDay(history.conversations, now).flatMap((group) => {
    const rows = group.conversations.slice(0, left);
    left -= rows.length;
    return rows.length === 0 ? [] : [{ ...group, conversations: rows }];
  });
  if (history.state === "loading") return <LoadingHistory />;
  if (history.state === "failed" && history.conversations.length === 0) {
    return (
      <div className="rw-empty" data-state="failed">
        <p className="rw-empty-b">{COPY.riwayat.failed}</p>
        <button type="button" className="rw-link" onClick={() => void refreshHistory()}>
          {COPY.riwayat.retry}
        </button>
      </div>
    );
  }
  if (history.conversations.length === 0) return <EmptyHistory />;
  return groups.map((group) => (
    <section key={group.key} aria-label={group.label}>
      <GroupLabel t={group.label} />
      {group.conversations.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} now={now} />
      ))}
    </section>
  ));
}

function Results({ hits, terms, query, now, highlighted }: { hits: readonly ConversationHit[]; terms: readonly string[]; query: string; now: Date; highlighted: number }) {
  const questions = hits.filter((hit) => hit.where === "question");
  const answers = hits.filter((hit) => hit.where === "answer");
  const found = COPY.riwayat.foundCount(hits.length, terms);
  const section = (label: string, list: readonly ConversationHit[], offset: number) =>
    list.length === 0 ? null : (
      <section aria-label={label}>
        <GroupLabel t={label} />
        {list.map((hit, index) => (
          <ConversationRow key={hit.conversation.id} conversation={hit.conversation} hit={hit} terms={terms} highlighted={highlighted === offset + index} now={now} />
        ))}
      </section>
    );
  if (hits.length === 0) return <p className="rw-count">{COPY.riwayat.noMatch(query)}</p>;
  return (
    <>
      <p className="rw-count" role="status">
        <b>{found.count}</b>
        {found.rest}
      </p>
      {section(COPY.riwayat.inQuestions, questions, 0)}
      {section(COPY.riwayat.inAnswers, answers, questions.length)}
    </>
  );
}

function SearchPane({ now }: { now: Date }) {
  const search = useChat((state) => state.search);
  const { setQuery, closeSearch, openConversation } = useChat((state) => state);
  const [highlighted, setHighlighted] = useState(0);
  const hits = useMemo(() => {
    const found = search.result?.hits ?? [];
    return [...found.filter((hit) => hit.where === "question"), ...found.filter((hit) => hit.where === "answer")];
  }, [search.result]);
  useEffect(() => setHighlighted(0), [search.result]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (hits.length > 0) setHighlighted((at) => (at + (event.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      const target = hits[highlighted];
      if (target !== undefined) void openConversation(target.conversation.id);
    }
  };
  return (
    <>
      <SearchField value={search.query} placeholder={COPY.riwayat.search} label={COPY.riwayat.searchLabel} clearLabel={COPY.riwayat.clearSearch} autoFocus onChange={setQuery} onClear={() => setQuery("")} onKeyDown={onKeyDown} />
      <div className="rw-scroll">
        {search.result === null ? null : <Results hits={hits} terms={search.result.terms} query={search.settled ?? search.query} now={now} highlighted={highlighted} />}
        <p className="rw-scope">{COPY.riwayat.searchScope}</p>
        <p className="rw-keys">
          <kbd>Enter</kbd> {COPY.riwayat.hintOpen} <kbd>Esc</kbd> {COPY.riwayat.hintClose}
        </p>
      </div>
    </>
  );
}

export function Sidebar({ connection, canStartNew, onNew }: SidebarProps) {
  const searching = useChat((state) => state.search.open);
  const screen = useChat((state) => state.screen);
  const { openSearch, showAll } = useChat((state) => state);
  const now = new Date();
  return (
    <aside className="rw-side" aria-label="Riwayat">
      {searching ? (
        <SearchPane now={now} />
      ) : (
        <>
          <div className="rw-top">
            <button type="button" className="icon-btn rw-search" aria-label={COPY.riwayat.openSearch} onClick={openSearch}>
              {SEARCH_ICON}
            </button>
          </div>
          <div className="rw-new" aria-disabled={!canStartNew}>
            <NewChatButton size="sidebar" label={COPY.newChat} kbd={COPY.riwayat.newChatKbd} onClick={canStartNew ? onNew : undefined} />
          </div>
          <div className="rw-scroll">
            <History now={now} />
          </div>
          <NavItem state={screen === "all" ? "active" : "default"} label={COPY.riwayat.all} icon={LIST_ICON} onClick={showAll} />
        </>
      )}
      <div className="rw-conn">
        <ConnectionStatus state={connection.state} logo={PROVIDER_LOGOS.claude} provider={COPY.modelGroup} status={connection.status} />
      </div>
    </aside>
  );
}
