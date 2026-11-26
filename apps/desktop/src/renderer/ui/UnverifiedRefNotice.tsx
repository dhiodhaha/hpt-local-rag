export type UnverifiedRefNoticeProps = {
  /** The title line. Left out when the headline already says the reference was not found. */
  tt?: string;
  rl: string;
  rq: string;
  nt: string;
};

export function UnverifiedRefNotice({ tt, rl, rq, nt }: UnverifiedRefNoticeProps) {
  return (
    <div className="un">
      <svg
        className="un-ic"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <div className="bd">
        {tt === undefined ? null : <div className="tt">{tt}</div>}
        <div className="rf">
          <span className="rl">{rl}</span>
          <span className="rq">{rq}</span>
        </div>
        <p className="un-nt">{nt}</p>
      </div>
    </div>
  );
}
