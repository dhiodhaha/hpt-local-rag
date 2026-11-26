export type RecheckNoticeProps = {
  text: string;
  nt: string;
};

export function RecheckNotice({ text, nt }: RecheckNoticeProps) {
  return (
    <div className="rc">
      <div className="ln">
        <span className="rc-dot" />
        <span>{text}</span>
      </div>
      <p className="nt">{nt}</p>
    </div>
  );
}
