import type { CatalogStat, ScoringCatalog } from "@/lib/leaguesApi";

// The league’s scoring rules as members read them (2026-10-22, the
// League → Scoring page): every stat the league scores, grouped like
// the commissioner’s editor, with ESPN-style per-yard math spelled out.
// Same logic as the app’s mobile/src/lib/scoringDisplay.ts.

/** "+6", "-2", "+0.04": the value as a signed number, no trailing zeros. */
export function pointsLabel(value: number): string {
  const n = Number(value.toFixed(3));
  return `${n > 0 ? "+" : ""}${n}`;
}

const YARD_KEYS = new Set(["pass_yd", "rush_yd", "rec_yd", "fg_yds"]);

/** The plain-English line under a stat: "1 point every 25 yards". */
export function detailLabel(stat: CatalogStat): string {
  const v = stat.value ?? 0;
  if (stat.key === "fg_yds" && v !== 0) return `${pointsLabel(v)} per yard of each made kick (a 46-yarder = ${Number((46 * v).toFixed(2))})`;
  if (YARD_KEYS.has(stat.key) && v !== 0) {
    const per = 1 / Math.abs(v);
    if (Math.abs(per - Math.round(per)) < 0.01 && Math.round(per) > 1) {
      return `${v > 0 ? "1 point" : "-1 point"} every ${Math.round(per)} yards`;
    }
  }
  return stat.hint ? stat.hint.charAt(0).toUpperCase() + stat.hint.slice(1) : "";
}

export type ScoringGroup = { key: string; label: string; icon: string; color: string; stats: CatalogStat[] };

// Each group's header badge and accent (2026-10-23), so Passing, Rushing,
// D/ST and the rest read as clear sections rather than small gray text.
const GROUP_LOOK: Record<string, { icon: string; color: string }> = {
  passing: { icon: "🎯", color: "#38bdf8" },
  rushing: { icon: "🏃", color: "#f97316" },
  receiving: { icon: "🙌", color: "#a855f7" },
  kicking: { icon: "🦵", color: "#facc15" },
  dst: { icon: "🛡️", color: "#ef4444" },
  defenders: { icon: "💪", color: "#f43f5e" },
  bonuses: { icon: "⭐", color: "#4ade80" },
};
const OTHER_LOOK = { icon: "➕", color: "#94a3b8" };

/** Groups with every stat the league has a rule for (a 0 the commissioner set too, so brackets have no gaps), in editor order. IDP only in IDP leagues. */
export function scoredGroups(catalog: ScoringCatalog): ScoringGroup[] {
  return catalog.groups
    .filter((g) => g.key !== "defenders" || catalog.idp)
    .map((g) => ({ ...g, ...(GROUP_LOOK[g.key] ?? OTHER_LOOK), stats: catalog.stats.filter((s) => s.group === g.key && s.value !== null) }))
    .filter((g) => g.stats.length > 0);
}

/** The headline chips: reception format, passing TD value, anything unusual. */
export function scoringSummary(catalog: ScoringCatalog): string[] {
  const value = (key: string) => catalog.stats.find((s) => s.key === key)?.value ?? 0;
  const out: string[] = [];
  const rec = value("rec");
  out.push(rec === 1 ? "PPR" : rec === 0.5 ? "Half PPR" : rec === 0 ? "Standard (no PPR)" : `${pointsLabel(rec)} per catch`);
  const passTd = value("pass_td");
  if (passTd) out.push(`${Number(passTd.toFixed(2))}-pt passing TDs`);
  const te = value("te_rec");
  if (te) out.push(`TE premium ${pointsLabel(te)}`);
  if (value("fg_yds")) out.push("FGs score by distance");
  if (catalog.idp) out.push("IDP");
  return out;
}
