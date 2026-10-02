import type { ChugLedgerEvent } from "@/lib/api";

// "Why?" under a Chug Leaderboard row: the owner's chug history, one
// short line per event, folded away until opened so the page stays its
// usual size. A plain <details> — no client JavaScript needed.

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

function playerLabel(r: { player_name: string; position: string | null; points: number }): string {
  const name = r.position === "DEF" || r.position === "D/ST" ? `${r.player_name} D/ST` : r.player_name;
  const pts = r.points < 0 ? `−${Math.abs(r.points)}` : `${r.points}`;
  return `${name} (${pts})`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function describeChugEvent(e: ChugLedgerEvent): { label: string; detail: string } {
  switch (e.kind) {
    case "earned":
      return {
        label: `Wk ${e.week}`,
        detail: e.reasons.length ? e.reasons.map(playerLabel).join(", ") : `${e.chugs} starter${e.chugs === 1 ? "" : "s"} scored 0 or less`,
      };
    case "doubled":
      return { label: `Wk ${e.week} deadline`, detail: `Missed — doubled ${e.owed_before} → ${e.owed_after}` };
    case "fined":
      return { label: `Wk ${e.week} deadline`, detail: `3rd miss — ${e.owed_before} chugs became a $${e.fine_amount ?? 0} fine` };
    case "waived":
      return { label: `Wk ${e.week} deadline`, detail: "Doubling waived by the commissioner" };
    case "chug":
      return {
        label: new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        detail: `Chug posted${e.score !== null ? ` · ${e.score.toFixed(1)}/10` : ""}${e.change === 0 ? " · nothing owed, just for fun" : ""}`,
      };
    case "paid":
      return {
        label: "Paid",
        detail: `Paid Commissioner $${e.dollars}${e.amount > 1 ? ` (${e.amount} chugs)` : ""}${e.at ? ` · ${shortDate(e.at)}` : ""}`,
      };
    case "fine_paid":
      return { label: "Fine paid", detail: `Paid Commissioner $${e.dollars} fine${e.at ? ` · ${shortDate(e.at)}` : ""}` };
    case "correction":
      return { label: "Correction", detail: `${e.note || "Commissioner correction"} · ${shortDate(e.at)}` };
    case "adjustment":
      return { label: "Adjustment", detail: "Commissioner correction" };
  }
}

export function ChugBreakdown({ events }: { events: ChugLedgerEvent[] }) {
  if (events.length === 0) return null;
  return (
    <details className="group ml-8 text-xs">
      <summary className="cursor-pointer list-none text-black/50 select-none hover:text-black/80 dark:text-white/50 dark:hover:text-white/80">
        <span className="group-open:hidden">Why? ▾</span>
        <span className="hidden group-open:inline">Hide ▴</span>
      </summary>
      <ol className="mt-1.5 flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.03] px-2.5 dark:divide-white/5 dark:bg-white/[0.04]">
        {events.map((e, i) => {
          const { label, detail } = describeChugEvent(e);
          return (
            <li key={i} className="flex items-baseline gap-2 py-1.5">
              <span className="w-24 shrink-0 font-medium text-black/60 dark:text-white/60">{label}</span>
              <span className="min-w-0 flex-1 wrap-break-word">{detail}</span>
              <span
                className={`w-8 shrink-0 text-right font-mono tabular-nums ${
                  e.change > 0 ? "text-amber-600 dark:text-amber-400" : e.change < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-black/40 dark:text-white/40"
                }`}
              >
                {signed(e.change)}
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-black/40 tabular-nums dark:text-white/40" title="Owed after this">
                = {e.balance}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
