import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ModelOption as Option } from "@hpt/server/client";
import { Composer, ModelChip, ModelGroupHead, ModelMenu, ModelOption } from "../ui/index.ts";
import { COPY } from "./copy.ts";
import { provenanceOf, type Provenance } from "./provenance.ts";

type PickerProps = {
  models: readonly Option[];
  /** The picked model id, or null for the default route. */
  choice: string | null;
  connected: boolean;
  onChoose: (model: string | null) => void;
};

function ModelPicker({ models, choice, connected, onChoose }: PickerProps) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const current = models.find((entry) => (choice === null ? entry.isDefault : entry.model === choice));

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (current === undefined) return null;
  return (
    <span ref={holder} style={{ position: "relative", display: "inline-flex" }}>
      <ModelChip provider="claude" model={current.label} state={open ? "open" : "default"} onClick={() => setOpen(!open)} />
      {open ? (
        <div style={{ position: "absolute", left: 0, bottom: "calc(100% + 10px)", zIndex: 5 }}>
          <ModelMenu
            footer={COPY.modelFooter}
            groups={
              <>
                <ModelGroupHead provider="claude" tone={connected ? "ok" : "off"} name={COPY.modelGroup} status={connected ? "Terhubung" : "Belum terhubung"} />
                {models.map((entry) => (
                  <ModelOption
                    key={entry.model}
                    state={entry === current ? "current" : "default"}
                    label={entry.label}
                    note={entry.isDefault ? COPY.modelDefaultNote : COPY.modelFallbackNote}
                    onClick={() => {
                      onChoose(entry.isDefault ? null : entry.model);
                      setOpen(false);
                    }}
                  />
                ))}
              </>
            }
          />
        </div>
      ) : null}
    </span>
  );
}

export type ComposerBarProps = {
  draft: string;
  busy: boolean;
  followUp: boolean;
  disabled: boolean;
  models: readonly Option[];
  choice: string | null;
  connected: boolean;
  onDraft: (text: string) => void;
  onChoose: (model: string | null) => void;
  onSend: (provenance: Provenance) => void;
};

export function ComposerBar({ draft, busy, followUp, disabled, models, choice, connected, onDraft, onChoose, onSend }: ComposerBarProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);

  /** Only a trusted event sends. An untrusted one (a script's) is ignored here, and again by the store and by the main process. */
  const submit = (provenance: Provenance) => {
    if (provenance.trusted && !busy && !disabled && draft.trim() !== "") onSend(provenance);
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit(provenanceOf("enter", event));
  };
  return (
    <div data-busy={busy || disabled ? "true" : "false"}>
      <Composer
        placeholder={followUp ? COPY.placeholderFollowUp : COPY.placeholder}
        field={<textarea ref={field} rows={1} value={draft} placeholder={followUp ? COPY.placeholderFollowUp : COPY.placeholder} aria-label={COPY.placeholder} onChange={(event) => onDraft(event.target.value)} onKeyDown={onKey} autoFocus />}
        chip={<ModelPicker models={models} choice={choice} connected={connected} onChoose={onChoose} />}
        onSend={(event) => submit(provenanceOf("button", event))}
      />
    </div>
  );
}
