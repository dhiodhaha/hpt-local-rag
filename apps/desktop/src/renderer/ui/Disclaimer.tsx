export type DisclaimerProps = {
  t: string;
};

export function Disclaimer({ t }: DisclaimerProps) {
  return (
    <div className="d">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      </svg>
      <span className="t">{t}</span>
    </div>
  );
}
