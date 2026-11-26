import { Disclaimer } from "../ui/index.ts";
import { COPY } from "./copy.ts";
import type { RunView } from "./view.ts";

type Reply = Extract<RunView, { kind: "reply" }>;

const LABEL_STYLE = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-ink-muted)" } as const;
const TITLE_STYLE = { fontFamily: "var(--font-read)", fontWeight: 400, fontSize: 25, lineHeight: 1.2, marginTop: 8, textWrap: "balance" } as const;
const BODY_STYLE = { fontSize: 14.5, fontWeight: 500, lineHeight: 1.55, color: "var(--color-ink-muted)", marginTop: 8, textWrap: "pretty" } as const;

const CARD = { background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "22px 26px 22px" } as const;

/** Clarify, insufficient, out of scope and declined: the four replies that are not an answer (Doop 6a to 6d). */
export function ReplyView({ reply, onPick }: { reply: Reply; onPick: (option: string) => void }) {
  if (reply.type === "clarify") {
    return (
      <section data-card="clarify">
        <div style={{ ...LABEL_STYLE, margin: "0 4px 8px" }}>{COPY.reply.clarify.label}</div>
        <h3 style={{ ...TITLE_STYLE, fontSize: 26, margin: "0 4px" }}>{reply.question}</h3>
        {reply.message === null ? null : <p style={{ ...BODY_STYLE, margin: "8px 4px 0" }}>{reply.message}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          {reply.options.map((option) => (
            <button key={option} type="button" className="rv-chip" onClick={() => onPick(option)}>
              {option}
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (reply.type === "declined") {
    return (
      <section style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "16px 18px" }} data-card="declined">
        <span style={{ display: "inline-flex", width: 32, height: 32, flex: "none", borderRadius: 999, background: "var(--color-ground)", color: "var(--color-ink-muted)", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="m5.7 5.7 12.6 12.6" />
          </svg>
        </span>
        <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.45, textWrap: "pretty", minWidth: 0 }}>{reply.message ?? COPY.reply.declined.title}</p>
      </section>
    );
  }
  const copy = COPY.reply[reply.type];
  const warn = reply.type === "insufficient";
  return (
    <>
      <section style={CARD} data-card={reply.type}>
        <div style={{ ...LABEL_STYLE, color: warn ? "var(--color-warn)" : LABEL_STYLE.color }}>{copy.label}</div>
        <h3 style={TITLE_STYLE}>{copy.title}</h3>
        <p style={BODY_STYLE}>{reply.message ?? copy.body}</p>
      </section>
      <div style={{ margin: "14px 4px 0" }}>
        <Disclaimer t={COPY.disclaimer} />
      </div>
    </>
  );
}
