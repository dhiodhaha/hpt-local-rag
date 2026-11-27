export type FadeEdgeProps = {
  side: "top" | "bottom";
  height: number;
  /** The colour the edge fades into: the surface the content scrolls on. */
  tone?: "ground" | "surface";
};

/** A progressive blur: four layers that blur a little more toward the edge, then fade into the surface. Content scrolls under it. */
export function FadeEdge({ side, height, tone = "ground" }: FadeEdgeProps) {
  return (
    <div className="pb" data-side={side} data-tone={tone} style={{ height }} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
