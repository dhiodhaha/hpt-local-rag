export const SKELETON_ROW_POSITIONS = ["single", "first", "middle", "last"] as const;
export type SkeletonRowPosition = (typeof SKELETON_ROW_POSITIONS)[number];

export type SkeletonRowProps = {
  pos?: SkeletonRowPosition;
};

export function SkeletonRow({ pos = "single" }: SkeletonRowProps) {
  return (
    <div className="sr" data-pos={pos} aria-hidden="true">
      <div className="sk sr-a" />
      <div className="sk sr-b" />
    </div>
  );
}
