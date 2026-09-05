"use client";

import { useEffect, useState } from "react";
import { getScoringRules, updateScoringRules, type ScoringRule } from "@/lib/leaguesApi";

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
  if (key.startsWith("def_")) return "Defense";
  if (key.startsWith("pts_allow_")) return "Points Allowed";
  if (key.startsWith("yds_allow_")) return "Yards Allowed";
  return "Misc";
}

// A handful of stat_category names are real acronyms, not plain words
// — title-casing "fg"/"xp"/"td"/"int" like every other word produces
// "Fg"/"Xp"/"Td"/"Int", which reads as a typo rather than the actual
// abbreviation it is.
const ACRONYMS: Record<string, string> = { fg: "FG", xp: "XP", td: "TD", int: "INT" };

// stat_category encodes numeric ranges as separate underscore-joined
// tokens (fg_0_39, pts_allow_14_17, yds_allow_lt100, fg_60_plus) since
// the DB has no range-typed column — title-casing each token
// independently loses that structure entirely ("Fg 0 39" reads as
// three unrelated words, not the range it actually is). This
// reconstructs it: two adjacent numeric tokens become "0-39", a
// numeric token followed by "plus" becomes "60+", and "lt100" becomes
// "<100" — the three range shapes that actually appear in this app's
// stat_category values (verified against every real row in
// league_scoring_rules, not just the ones a screenshot happened to
// show).
function humanize(key: string): string {
  const words = key.split("_");
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lessThanMatch = w.match(/^lt(\d+)$/);
    if (lessThanMatch) {
      parts.push(`<${lessThanMatch[1]}`);
      continue;
    }
    if (w === "plus" && parts.length > 0 && /^\d/.test(words[i - 1])) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}+`;
      continue;
    }
    if (/^\d+$/.test(w) && i + 1 < words.length && /^\d+$/.test(words[i + 1])) {
      parts.push(`${w}-${words[i + 1]}`);
      i++;
      continue;
    }
    parts.push(ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1));
  }
  return parts.join(" ");
}

// A couple of category names read as narrower than they actually are
// — "Def Tackle" groups under Defense purely because of its DB naming
// convention (matching every other def_-prefixed category here), but
// ESPN's own tackle data was never restricted to defensive positions:
// whoever actually recorded a real tackle that game shows up, QB
// included (verified live against a real game where a QB did exactly
// that). Without this caption, "is there a setting for QB tackles?" is
// a completely reasonable question to still be asking after finding
// this row, since nothing about its label says so.
const HINTS: Record<string, string> = {
  def_tackle: "Any player who records a tackle — including a QB after his own pick gets returned.",
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
                      {humanize(key)}
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
