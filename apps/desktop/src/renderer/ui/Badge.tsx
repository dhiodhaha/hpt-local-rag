export const BADGE_TONES = [
  "inferred",
  "kind",
  "berlaku",
  "direvisi",
  "pengecualian",
  "praktis",
  "perbedaan",
  "revisi",
  "rujukan",
] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

export type BadgeProps = {
  tone?: BadgeTone;
  t?: string;
};

export function Badge({ tone = "inferred", t = "Disimpulkan" }: BadgeProps) {
  return (
    <span className="b" data-tone={tone}>
      <span className="dot" />
      <span className="t">{t}</span>
    </span>
  );
}
