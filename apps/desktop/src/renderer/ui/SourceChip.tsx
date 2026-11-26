export type SourceChipProps = {
  n: string;
  title: string;
  meta: string;
};

export function SourceChip({ n, title, meta }: SourceChipProps) {
  return (
    <div className="src">
      <span className="n">{n}</span>
      <div className="t">
        <div className="src-title">{title}</div>
        <div className="src-meta">{meta}</div>
      </div>
    </div>
  );
}
