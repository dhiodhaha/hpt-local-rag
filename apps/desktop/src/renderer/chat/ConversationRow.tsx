import type { ConversationHit, ConversationSummary } from "@hpt/server/client";
import { RiwayatRow, type RiwayatRowState } from "../ui/index.ts";
import { useChat } from "./context.tsx";
import { dayOf, metaOf, snippetPieces, titlePieces, whenOf, type Piece } from "./riwayat.ts";

const marked = (pieces: readonly Piece[]) => pieces.map((piece, index) => (piece.marked ? <mark key={index}>{piece.text}</mark> : piece.text));

function rowState(flags: { menuOpen: boolean; highlighted: boolean; current: boolean }): RiwayatRowState {
  if (flags.menuOpen) return "menu";
  if (flags.highlighted) return "hover";
  return flags.current ? "active" : "default";
}

export type ConversationRowProps = {
  conversation: ConversationSummary;
  hit?: ConversationHit;
  terms?: readonly string[];
  highlighted?: boolean;
  size?: "sidebar" | "drawer";
  now: Date;
};

export function ConversationRow({ conversation, hit, terms = [], highlighted = false, size = "sidebar", now }: ConversationRowProps) {
  const current = useChat((state) => state.conversation === conversation.id && state.screen === "chat");
  const menuOpen = useChat((state) => state.menu?.conversation === conversation.id);
  const renaming = useChat((state) => state.renaming === conversation.id);
  const busy = useChat((state) => state.opening === conversation.id);
  const { openConversation, openMenu, commitRename, cancelRename } = useChat((state) => state);
  const state = rowState({ menuOpen, highlighted, current });
  const title = terms.length === 0 ? conversation.title : marked(titlePieces(conversation.title, terms));
  const meta = hit?.snippet != null ? marked(snippetPieces(hit.snippet)) : metaOf(conversation);
  return (
    <RiwayatRow
      size={size}
      state={state}
      snippet={hit === undefined ? "off" : "on"}
      busy={busy}
      title={title}
      meta={meta}
      time={size === "drawer" ? dayOf(conversation.updatedAt) : whenOf(conversation.updatedAt, now)}
      edit={renaming ? { value: conversation.title, onCommit: (value) => void commitRename(conversation.id, value), onCancel: cancelRename } : null}
      onSelect={() => void openConversation(conversation.id)}
      onMore={(anchor) => openMenu({ conversation: conversation.id, ...anchor })}
    />
  );
}
