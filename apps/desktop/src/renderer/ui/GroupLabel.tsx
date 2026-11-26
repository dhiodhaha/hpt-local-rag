export type GroupLabelProps = {
  t: string;
};

export function GroupLabel({ t }: GroupLabelProps) {
  return <div className="gl">{t}</div>;
}
