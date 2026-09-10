// Shared with ScoringRulesSection.tsx (the commissioner editor) and
// StarterComparisonTable.tsx's score-breakdown modal — both need to
// turn a raw stat_category key ("fg_0_39", "pts_allow_14_17") into a
// human label. The DB only stores flat stat_category strings (no
// grouping/label metadata table), so this derives it algorithmically
// rather than hand-maintaining a 45-entry map that would silently go
// stale if a category is ever added/renamed server-side.

// A handful of stat_category names are real acronyms, not plain words
// — title-casing "fg"/"xp"/"td"/"int" like every other word produces
// "Fg"/"Xp"/"Td"/"Int", which reads as a typo rather than the actual
// abbreviation it is.
const ACRONYMS: Record<string, string> = { fg: "FG", xp: "XP", td: "TD", int: "INT", qb: "QB" };

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
export function humanizeStatCategory(key: string): string {
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
