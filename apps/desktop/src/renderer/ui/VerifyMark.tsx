export type VerifyMarkProps = {
  text?: string;
};

export function VerifyMark({ text = "memeriksa…" }: VerifyMarkProps) {
  return (
    <span className="vm">
      <span className="vm-dot" />
      <span>{text}</span>
    </span>
  );
}
