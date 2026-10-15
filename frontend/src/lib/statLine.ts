// "5 REC, 56 YDS" from a player's raw stat counts — the same line the
// native app shows (mobile/src/lib/matchups.ts's formatStatLine).
export function formatStatLine(rawStats: Record<string, number> | null): string | null {
  if (!rawStats) return null;
  const n = (key: string) => rawStats[key] ?? 0;
  const yardageKeys = ["rush_yd", "rec_yd", "pass_yd"].filter((k) => n(k) > 0);
  const yardLabel = (key: string, prefix: string) =>
    n(key) > 0 ? `${Math.round(n(key))} ${yardageKeys.length > 1 ? `${prefix} ` : ""}YDS` : null;
  const parts = [
    n("pass_td") > 0 && `${n("pass_td")} PASS TD`,
    yardLabel("pass_yd", "PASS"),
    n("pass_int") > 0 && `${n("pass_int")} INT`,
    n("rush_td") > 0 && `${n("rush_td")} RUSH TD`,
    yardLabel("rush_yd", "RUSH"),
    n("rec") > 0 && `${n("rec")} REC`,
    yardLabel("rec_yd", "REC"),
    n("rec_td") > 0 && `${n("rec_td")} REC TD`,
    (n("def_return_td") > 0 || n("ret_td") > 0) && `${n("def_return_td") + n("ret_td")} TD`,
    n("def_sack") > 0 && `${n("def_sack")} SACK`,
    n("def_int") > 0 && `${n("def_int")} INT`,
    n("def_fum_rec") > 0 && `${n("def_fum_rec")} FR`,
    n("def_safety") > 0 && `${n("def_safety")} SFTY`,
    n("fum_lost") > 0 && `${n("fum_lost")} FUM`,
    n("xp_made") > 0 && `${n("xp_made")} XP`,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(", ") : null;
}
