"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getPlayerView, type PlayerViewColumn, type PlayerViewData, type PlayerViewKey } from "@/lib/api";
import { formatOrdinal, rankColorVar } from "@/lib/positionRank";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";

// Same set and order as ESPN's own Views sheet (2026-09 reference
// recording). Matchup Stats is each list's existing layout.
export const PLAYER_VIEW_OPTIONS: { key: PlayerViewKey; label: string }[] = [
  { key: "matchup", label: "Matchup Stats" },
  { key: "proj_2026", label: "2026 Proj" },
  { key: "stats_2026", label: "2026 Stats" },
  { key: "stats_2025", label: "2025 Stats" },
  { key: "scoring", label: "Scoring" },
  { key: "research", label: "Research" },
  { key: "schedule", label: "Schedule" },
  { key: "rankings", label: "Rankings" },
  { key: "ppr_rankings", label: "PPR Rankings" },
];

const VALID_KEYS = new Set(PLAYER_VIEW_OPTIONS.map((o) => o.key));

/**
 * The chosen view for one list, remembered per device (a convenience,
 * not state anyone else needs) — every storage access guarded, since it
 * can throw or come back empty in a private window.
 */
export function usePlayerView(storageKey: string): [PlayerViewKey, (view: PlayerViewKey) => void] {
  const [view, setView] = useState<PlayerViewKey>("matchup");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storageKey);
    } catch {}
    if (saved && VALID_KEYS.has(saved as PlayerViewKey)) {
      // Deferred a tick — same lint-satisfying mount pattern as MyTeamApp.
      const id = setTimeout(() => setView(saved as PlayerViewKey), 0);
      return () => clearTimeout(id);
    }
  }, [storageKey]);

  function choose(next: PlayerViewKey) {
    setView(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {}
  }
  return [view, choose];
}

/** The pill + bottom sheet ("Views · Close", checkmark on the active one). */
export function PlayerViewsPill({ view, onChange }: { view: PlayerViewKey; onChange: (view: PlayerViewKey) => void }) {
  const [open, setOpen] = useState(false);
  const label = PLAYER_VIEW_OPTIONS.find((o) => o.key === view)?.label ?? "Matchup Stats";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-black px-3.5 py-1.5 text-xs font-semibold text-white dark:border-white/15"
        aria-haspopup="dialog"
      >
        {label}
        <span aria-hidden className="text-[10px]">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Views"
            className="w-full max-w-md rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)] sm:rounded-2xl"
            style={{ background: "var(--wl-surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex items-center justify-center border-b border-white/10 px-4 py-3.5">
              <h2 className="text-sm font-semibold">Views</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-4 text-sm text-black/60 dark:text-white/60"
              >
                Close
              </button>
            </div>
            <ul>
              {PLAYER_VIEW_OPTIONS.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left text-sm ${
                      o.key === view ? "font-semibold text-[var(--wl-accent)]" : ""
                    }`}
                  >
                    {o.label}
                    {o.key === view && <span aria-hidden>✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

export type PlayerViewRow = {
  id: string;
  // Fantasy position (QB/RB/WR/TE/K/DEF) — splits the stat views into
  // per-position sections.
  position: string;
  // The fixed left column's content — name/team/etc. plus whatever the
  // list puts in front of it (an Add button, a slot pill).
  cell: ReactNode;
};

// The season stat views get one section per position family, each with
// only its own columns — one mixed table carried Passing, Rushing,
// Receiving, Kicking and Defense columns for every row, so a phone
// showed QBs' passing numbers and "-" for everyone else, with their
// real stats scrolled out of sight (2026-09 report: "most data is
// missing").
const STAT_VIEWS = new Set<PlayerViewKey>(["proj_2026", "stats_2026", "stats_2025"]);
const POSITION_FAMILIES: { label: string; positions: string[] }[] = [
  { label: "Quarterbacks", positions: ["QB"] },
  { label: "RB / WR / TE", positions: ["RB", "WR", "TE"] },
  { label: "Kickers", positions: ["K"] },
  { label: "D/ST", positions: ["DEF"] },
];

export function PlayerViewTable({
  view,
  rows,
  beta = false,
}: {
  view: Exclude<PlayerViewKey, "matchup">;
  rows: PlayerViewRow[];
  beta?: boolean;
}) {
  if (!STAT_VIEWS.has(view)) return <ViewSection view={view} rows={rows} beta={beta} />;
  const sections = POSITION_FAMILIES.map((family) => ({
    ...family,
    rows: rows.filter((r) => family.positions.includes(r.position)),
  })).filter((section) => section.rows.length > 0);
  // One family only (a position filter's on) — no need for a heading.
  if (sections.length === 1) return <ViewSection view={view} rows={sections[0].rows} beta={beta} />;
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <section key={section.label} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            {section.label}
          </h3>
          <ViewSection view={view} rows={section.rows} beta={beta} />
        </section>
      ))}
    </div>
  );
}

/**
 * One view's stat columns for a list of players — the player column
 * stays pinned on the left while the stats scroll sideways, like ESPN.
 */
function ViewSection({
  view,
  rows,
  beta = false,
}: {
  view: Exclude<PlayerViewKey, "matchup">;
  rows: PlayerViewRow[];
  beta?: boolean;
}) {
  const ids = rows.map((r) => r.id);
  const idsKey = ids.join(",");
  const [data, setData] = useState<{ key: string; data: PlayerViewData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${view}|${idsKey}`;

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    getPlayerView(view, idsKey.split(","))
      .then((d) => {
        if (!cancelled) {
          setData({ key: requestKey, data: d });
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load this view");
      });
    return () => {
      cancelled = true;
    };
  }, [view, idsKey, requestKey]);

  useOnAppRefresh(() => {
    if (!idsKey) return;
    return getPlayerView(view, idsKey.split(","))
      .then((d) => setData({ key: requestKey, data: d }))
      .catch(() => {});
  });

  const current = data?.key === requestKey ? data.data : null;
  const surface = beta ? "wl-card" : "neon-panel bg-black/[0.015] dark:bg-white/[0.03]";

  if (error && !current) {
    return <p className={`rounded-lg px-4 py-3 text-sm text-red-500 ${surface}`}>{error}</p>;
  }

  const columns = current?.columns ?? [];
  const groups = groupSpans(columns);

  return (
    <div className={`flex flex-col rounded-lg ${surface}`}>
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead>
            {groups.length > 0 && (
              <tr className="text-[10px] tracking-wide text-black/40 uppercase dark:text-white/40">
                <th className="sticky left-0 z-10" style={{ background: "var(--wl-surface)" }} />
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} className="border-b border-white/10 px-2 pt-2 pb-1 text-center font-semibold">
                    {g.label}
                  </th>
                ))}
              </tr>
            )}
            <tr className="text-[11px] font-semibold tracking-wide text-black/40 uppercase dark:text-white/40">
              <th
                className="sticky left-0 z-10 px-3 py-2 text-left font-semibold"
                style={{ background: "var(--wl-surface)" }}
              >
                Players
              </th>
              {columns.map((c) => (
                <th key={c.key} className="px-2.5 py-2 text-right font-semibold whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {rows.map((r) => (
              <tr key={r.id}>
                <td
                  className="sticky left-0 z-10 max-w-[55vw] min-w-[10rem] px-3 py-2.5 sm:max-w-xs"
                  style={{ background: "var(--wl-surface)" }}
                >
                  {r.cell}
                </td>
                {current
                  ? columns.map((c) => (
                      <td key={c.key} className="px-2.5 py-2.5 text-right tabular-nums whitespace-nowrap text-black/70 dark:text-white/70">
                        <Cell column={c} value={current.rows[r.id]?.[c.key] ?? null} />
                      </td>
                    ))
                  : r === rows[0] && (
                      <td rowSpan={rows.length} className="px-4 py-2.5 text-black/40 dark:text-white/40">
                        Loading…
                      </td>
                    )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current?.note && <p className="px-3 py-2 text-[11px] text-black/40 dark:text-white/40">{current.note}</p>}
    </div>
  );
}

function groupSpans(columns: PlayerViewColumn[]): { label: string; span: number }[] {
  if (!columns.some((c) => c.group)) return [];
  const spans: { label: string; span: number }[] = [];
  for (const c of columns) {
    const label = c.group ?? "";
    const last = spans[spans.length - 1];
    if (last && last.label === label) last.span += 1;
    else spans.push({ label, span: 1 });
  }
  return spans;
}

function Cell({ column, value }: { column: PlayerViewColumn; value: string | number | null }) {
  if (value === null || value === undefined || value === "") return <>-</>;
  if (typeof value === "string") return <>{value}</>;
  switch (column.format) {
    case "int":
      return <>{Math.round(value)}</>;
    case "number1":
      return <>{value.toFixed(1)}</>;
    case "number2":
      return <>{Number(value.toFixed(2))}</>;
    case "ordinal":
      return <>{formatOrdinal(value)}</>;
    case "ordinal_matchup":
      return <span style={{ color: rankColorVar(value) }}>{formatOrdinal(value)}</span>;
    case "signed_int":
      return (
        <span className={value > 0 ? "text-emerald-500" : value < 0 ? "text-red-500" : ""}>
          {value > 0 ? "+" : ""}
          {compact(value)}
        </span>
      );
    default:
      return <>{value}</>;
  }
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
