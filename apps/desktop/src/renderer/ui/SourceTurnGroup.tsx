export const SOURCE_TURN_GROUP_STATES = ["current", "earlier"] as const;
export type SourceTurnGroupState = (typeof SOURCE_TURN_GROUP_STATES)[number];

export type SourceTurnGroupProps = {
  state?: SourceTurnGroupState;
  turn: string;
  count: string;
  question: string;
  onClick?: () => void;
};

export function SourceTurnGroup({ state = "current", turn, count, question, onClick }: SourceTurnGroupProps) {
  const content = (
    <>
      <div className="top">
        <span className="sg-turn">{turn}</span>
        <span className="sg-dot" />
        <span className="cnt">{count}</span>
        <svg
          className="chev"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      <div className="sg-q">{question}</div>
    </>
  );

  if (state === "earlier") {
    return (
      <button type="button" className="sg" data-state={state} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className="sg" data-state={state}>
      {content}
    </div>
  );
}
