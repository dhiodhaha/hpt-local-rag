import type { ReactNode } from "react";
import { ModelChip, type ModelChipProps } from "./ModelChip";

export const COMPOSER_MODELS = ["claude", "claude-open", "codex"] as const;
export type ComposerModel = (typeof COMPOSER_MODELS)[number];

export type ComposerProps = {
  model?: ComposerModel;
  placeholder: string;
  collection?: string;
  chip?: ReactNode;
  field?: ReactNode;
  onAttach?: () => void;
  onCollection?: () => void;
  onSend?: () => void;
};

const BUILT_IN_CHIPS: Record<ComposerModel, ModelChipProps> = {
  claude: { provider: "claude", model: "Sonnet 5.5" },
  "claude-open": { provider: "claude", state: "open", model: "Sonnet 5.5" },
  codex: { provider: "codex", model: "Codex · model bawaan" },
};

export function Composer({
  model = "claude",
  placeholder,
  collection = "Semua koleksi",
  chip,
  field,
  onAttach,
  onCollection,
  onSend,
}: ComposerProps) {
  return (
    <div className="cmp">
      {field ?? <div className="ph">{placeholder}</div>}
      <div className="cmp-row">
        {onAttach === undefined ? null : (
        <button type="button" className="ib" aria-label="Lampirkan" onClick={onAttach}>
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        )}
        {onCollection === undefined ? (
          <span className="col" style={{ cursor: "default" }}>
            {collection}
          </span>
        ) : (
          <button type="button" className="col" onClick={onCollection}>
            {collection}
          </button>
        )}
        <span className="mdl">{chip ?? <ModelChip {...BUILT_IN_CHIPS[model]} />}</span>
        <button type="button" className="send" aria-label="Kirim" onClick={onSend}>
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 7-7 7 7M12 19V5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
