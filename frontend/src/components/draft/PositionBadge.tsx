import { positionColor } from "@/lib/positionColors";

// Small colored position pill shared by the draft pool list, the queue
// panel, and DraftBoard.tsx's round×team grid — one place for the
// tinted-background-plus-matching-text treatment so all three stay
// visually consistent.
export function PositionBadge({ position, className = "" }: { position: string | null | undefined; className?: string }) {
  const color = positionColor(position);
  return (
    <span
      className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${className}`}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      {position ?? "—"}
    </span>
  );
}
