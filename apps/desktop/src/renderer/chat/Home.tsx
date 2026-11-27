import type { ReactNode } from "react";
import { SuggestionChip } from "../ui/index.ts";
import { COPY } from "./copy.ts";
import { provenanceOf, type Provenance } from "./provenance.ts";

const COLUMN = 688;

export type HomeProps = {
  notice: ReactNode;
  bar: ReactNode;
  firstVisit: boolean;
  unusable: boolean;
  onAsk: (text: string, provenance: Provenance) => void;
};

/** The first screen: a greeting, the question box, and on a first visit a few questions to try. */
export function Home({ notice, bar, firstVisit, unusable, onAsk }: HomeProps) {
  return (
    <>
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 32px 40px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-read)", fontWeight: 400, fontSize: 46, lineHeight: 1.1, letterSpacing: "-.015em", textWrap: "balance" }}>{COPY.greeting}</h1>
        <p style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.5, color: "var(--color-ink-muted)", marginTop: 12, textWrap: "balance" }}>{COPY.greetingHint}</p>
        <div style={{ width: COLUMN, maxWidth: "100%", marginTop: 36, textAlign: "left" }}>
          <div style={{ marginBottom: 16 }}>{notice}</div>
          <div className="cv-box">{bar}</div>
          {firstVisit ? (
            <div style={{ marginTop: 28 }}>
              <div className="lbl" style={{ padding: "0 4px 10px", color: "var(--color-ink-muted)" }}>
                {COPY.riwayat.suggestLabel}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {COPY.riwayat.suggestions.map((text) => (
                  <SuggestionChip key={text} label={text} disabled={unusable} onClick={(event) => onAsk(text, provenanceOf("suggestion", event))} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
