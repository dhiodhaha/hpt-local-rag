import { modelName, type ConnectionState } from "@hpt/server/client";
import type { Turn } from "./store.ts";

/**
 * The sidebar's ConnectionStatus row. The host's login check says what is true at launch, and what the last answers did says what
 * is true now: a refused login or a spent limit shows at once, without waiting for a new check.
 */
export type ConnectionView = {
  /** The component's state. "offline" is the hollow dot, which also stands for "not known yet". */
  readonly state: "connected" | "offline" | "limit";
  readonly status: string;
};

const NOT_SIGNED_IN = "Belum masuk";

function fromAnswers(turns: readonly Turn[]): ConnectionView | null {
  const last = [...turns].reverse().find((turn) => turn.run.outcome !== null);
  if (last === undefined) return null;
  const { outcome, fallback } = last.run;
  if (outcome?.kind === "failed" && outcome.code === "not_signed_in") return { state: "offline", status: NOT_SIGNED_IN };
  if (outcome?.kind === "failed" && outcome.code === "rate_limited") return { state: "limit", status: "Batas pemakaian tercapai" };
  if (fallback !== null) return { state: "limit", status: `Batas ${modelName(fallback.from)} tercapai` };
  return null;
}

export function connectionOf(state: ConnectionState, turns: readonly Turn[]): ConnectionView {
  if (state.kind === "down") return { state: "offline", status: "Mesin jawaban berhenti" };
  if (state.kind === "starting") return { state: "offline", status: "Memulai mesin jawaban…" };
  const answered = fromAnswers(turns);
  if (answered !== null) return answered;
  const { connection } = state;
  switch (connection.state) {
    case "checking":
      return { state: "offline", status: "Memeriksa koneksi…" };
    case "not_signed_in":
      return { state: "offline", status: NOT_SIGNED_IN };
    case "unknown":
      return { state: "offline", status: "Status belum diketahui" };
    case "connected":
      return { state: "connected", status: connection.subscription === null ? "Tersambung" : `Tersambung · ${connection.subscription}` };
  }
}
