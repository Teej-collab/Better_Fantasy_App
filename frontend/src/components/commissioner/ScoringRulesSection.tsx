"use client";

import { useEffect, useState } from "react";
import { getScoringRules, updateScoringRules, type ScoringRule } from "@/lib/leaguesApi";
import { humanizeStatCategory } from "@/lib/scoringLabels";

// The DB only stores flat stat_category strings (no grouping/label
// metadata table) — this groups them by prefix and title-cases the
// label, rather than a hand-authored 45-entry map that would silently
// go stale if a category is ever added/renamed server-side.
const GROUP_ORDER = ["Passing", "Rushing", "Receiving", "Kicking", "Defense", "Points Allowed", "Yards Allowed", "Misc"];

function groupFor(key: string): string {
  if (key.startsWith("pass_")) return "Passing";
  if (key.startsWith("rush_")) return "Rushing";
  if (key.startsWith("rec")) return "Receiving";
  if (key.startsWith("fg_") || key === "xp_made") return "Kicking";
  if (key === "qb_tackle") return "Passing";
  if (key.startsWith("def_")) return "Defense";
  if (key.startsWith("pts_allow_")) return "Points Allowed";
  if (key.startsWith("yds_allow_")) return "Yards Allowed";
  return "Misc";
}

// ESPN's own tackle data isn't restricted to defensive positions — a
// QB who records a real tackle (e.g. after his own interception gets
// returned) shows up in the exact same raw stat as any defender. This
// league's own rule (2026-09): nobody except a QB is ever awarded
// points for a tackle — D/ST is scored on sacks, not tackles — so the
// backend (app/domain/weekly_stats.py) drops the stat outright for
// anyone else, and def_tackle no longer exists as a selectable
// category at all (see migration 224c44524737). This caption is the
// only place that split is explained, since nothing about the
// qb_tackle label alone says so.
const HINTS: Record<string, string> = {
  qb_tackle: "A QB's own tackle — e.g. after his own interception gets returned. The only position awarded points for a tackle in this league.",
};

type Panel = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function ScoringRulesSection() {
  const [season, setSeason] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [panel, setPanel] = useState<Panel>({ status: "idle" });

  useEffect(() => {
    const id = setTimeout(() => {
      getScoringRules()
        .then(({ season: s, rules }) => {
          setSeason(s);
          setValues(Object.fromEntries(rules.map((r) => [r.stat_category, r.points_per_unit])));
        })
        .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load scoring rules." }));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function save() {
    if (season === null) return;
    setPanel({ status: "saving" });
    try {
      const { rules } = await updateScoringRules(season, values);
      setValues(Object.fromEntries(rules.map((r: ScoringRule) => [r.stat_category, r.points_per_unit])));
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't save scoring rules." });
    }
  }

  if (season === null) {
    return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;
  }

  const byGroup = new Map<string, string[]>();
  for (const key of Object.keys(values)) {
    const group = groupFor(key);
    byGroup.set(group, [...(byGroup.get(group) ?? []), key]);
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Scoring Rules</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          Points per stat category for the {season} season — changes apply immediately, including mid-season.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{group}</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {byGroup
                .get(group)!
                .sort()
                .map((key) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 flex-col text-black/70 dark:text-white/70">
                      {humanizeStatCategory(key)}
                      {HINTS[key] && (
                        <span className="text-xs font-normal text-black/45 dark:text-white/45">{HINTS[key]}</span>
                      )}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={values[key]}
                      onChange={(e) => setValues((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                      className="w-20 shrink-0 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-right tabular-nums dark:border-white/10"
                    />
                  </label>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={panel.status === "saving"}
          className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {panel.status === "saving" ? "Saving…" : "Save scoring rules"}
        </button>
        {panel.status === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
        {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
      </div>
    </section>
  );
}
