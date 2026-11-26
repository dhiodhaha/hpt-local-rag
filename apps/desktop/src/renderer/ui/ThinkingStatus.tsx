export type ThinkingStatusProps = {
  t: string;
};

export function ThinkingStatus({ t }: ThinkingStatusProps) {
  return (
    <div className="st" role="status">
      <svg className="sp" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10Z" />
      </svg>
      <span className="t">{t}</span>
    </div>
  );
}
