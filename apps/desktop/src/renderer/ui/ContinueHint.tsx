export type ContinueHintProps = {
  topic: string;
  action?: string;
  onAction?: () => void;
};

export function ContinueHint({ topic, action = "Topik baru", onAction }: ContinueHintProps) {
  return (
    <div className="ctx">
      <svg
        className="ctx-ic"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 4v7a4 4 0 0 0 4 4h12" />
        <path d="m15 10 5 5-5 5" />
      </svg>
      <span>
        Melanjutkan: <b>{topic}</b>
      </span>
      <button type="button" className="new" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
