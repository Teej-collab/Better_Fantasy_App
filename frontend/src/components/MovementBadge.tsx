// Shared by the Power Rankings page and the homepage's Power Rankings
// card — was a private helper duplicated once already when the
// homepage card needed the exact same up/down indicator.
export function MovementBadge({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) {
    return <span className="text-black/30 dark:text-white/30">—</span>;
  }
  const up = movement > 0;
  return (
    <span className={up ? "text-emerald-500" : "text-red-500"}>
      {up ? "▲" : "▼"} {Math.abs(movement)}
    </span>
  );
}
