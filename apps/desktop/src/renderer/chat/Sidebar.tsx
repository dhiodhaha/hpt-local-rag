import { ConnectionStatus, GroupLabel, NewChatButton, RiwayatRow } from "../ui/index.ts";
import { PROVIDER_LOGOS } from "../ui/providerLogos.ts";
import { COPY } from "./copy.ts";
import type { ConnectionView } from "./connection.ts";

export type SidebarProps = {
  /** The conversation on screen, as the one row of today's list. Riwayat will replace this with the stored list. */
  title: string | null;
  connection: ConnectionView;
  canStartNew: boolean;
  onNew: () => void;
};

export function Sidebar({ title, connection, canStartNew, onNew }: SidebarProps) {
  return (
    <aside style={{ width: 264, flex: "none", display: "flex", flexDirection: "column", padding: "12px 12px 16px" }}>
      <div style={{ margin: "18px 0 6px" }} aria-disabled={!canStartNew}>
        <NewChatButton size="sidebar" label={COPY.newChat} onClick={canStartNew ? onNew : undefined} />
      </div>
      {title === null ? null : (
        <>
          <div style={{ marginTop: 12 }}>
            <GroupLabel t={COPY.historyToday} />
          </div>
          <RiwayatRow size="sidebar" state="active" title={title} />
        </>
      )}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        <ConnectionStatus state={connection.state} logo={PROVIDER_LOGOS.claude} provider={COPY.modelGroup} status={connection.status} />
      </div>
    </aside>
  );
}
