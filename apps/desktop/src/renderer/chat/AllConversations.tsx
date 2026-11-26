import { useState } from "react";
import type { ConversationHit, ConversationSummary } from "@hpt/server/client";
import { FilterChip, SearchField } from "../ui/index.ts";
import { ConversationRow } from "./ConversationRow.tsx";
import { useChat } from "./context.tsx";
import { COPY } from "./copy.ts";
import { groupByMonth, monthKeyOf, monthLabelOf, monthsOf } from "./riwayat.ts";

type Entry = { readonly conversation: ConversationSummary; readonly hit?: ConversationHit };

export function AllConversations() {
  const history = useChat((state) => state.history);
  const search = useChat((state) => state.search);
  const { setQuery } = useChat((state) => state);
  const [month, setMonth] = useState<string | null>(null);
  const now = new Date();

  const searching = search.query.trim() !== "";
  const entries: Entry[] = searching ? (search.result?.hits ?? []).map((hit) => ({ conversation: hit.conversation, hit })) : history.conversations.map((conversation) => ({ conversation }));
  const months = monthsOf(entries.map((entry) => entry.conversation));
  const shown = month === null ? entries : entries.filter((entry) => monthKeyOf(entry.conversation.updatedAt) === month);
  const byConversation = new Map(shown.map((entry) => [entry.conversation.id, entry]));
  const groups = groupByMonth(shown.map((entry) => entry.conversation));
  const oldest = history.conversations.reduce<string | null>((first, entry) => (first === null || entry.startedAt < first ? entry.startedAt : first), null);
  const filtered = searching || month !== null;
  const terms = search.result?.terms ?? [];
  const about = [searching ? `memuat “${search.query.trim()}”` : "", month === null ? "" : `di ${monthLabelOf(month)}`].filter((part) => part !== "").join(" ");
  const summary = COPY.riwayat.filtered(shown.length, about);

  return (
    <div className="al">
      <div className="al-head">
        <div>
          <h1 className="al-title">{COPY.riwayat.pageTitle}</h1>
          <p className="al-sub">{oldest === null ? COPY.riwayat.onDevice : COPY.riwayat.pageCount(history.conversations.length, monthLabelOf(monthKeyOf(oldest)))}</p>
        </div>
        <div className="al-search">
          <SearchField size="page" value={search.query} placeholder={COPY.riwayat.searchPage} label={COPY.riwayat.searchLabel} clearLabel={COPY.riwayat.clearSearch} onChange={setQuery} onClear={() => setQuery("")} />
        </div>
      </div>
      {months.length < 2 && !filtered ? null : (
        <div className="al-filters" role="group" aria-label={COPY.riwayat.month}>
          <span className="al-fl">{COPY.riwayat.month}</span>
          <FilterChip label={COPY.riwayat.allMonths} count={entries.length} on={month === null} onClick={() => setMonth(null)} />
          {months.map((entry) => (
            <FilterChip key={entry.key} label={entry.label} count={entry.count} on={month === entry.key} onClick={() => setMonth(month === entry.key ? null : entry.key)} />
          ))}
        </div>
      )}
      {!filtered ? null : (
        <div className="al-line" role="status">
          <span>
            <b>{summary.count}</b>
            {summary.rest}
          </span>
          <button
            type="button"
            className="rw-link"
            onClick={() => {
              setMonth(null);
              setQuery("");
            }}
          >
            {COPY.riwayat.clearFilter}
          </button>
        </div>
      )}
      <div className="al-list">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="al-month">{group.label}</h2>
            {group.conversations.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} hit={byConversation.get(conversation.id)?.hit} terms={terms} size="drawer" now={now} />
            ))}
          </section>
        ))}
        {shown.length === 0 && filtered ? <p className="al-none">{COPY.riwayat.noMatch(search.query)}</p> : null}
      </div>
    </div>
  );
}
