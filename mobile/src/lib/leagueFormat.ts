// League formats (2026-10) — the Create a League flow's League Type
// step and its basics. Mirrors backend/app/domain/league_format.py;
// the web's frontend/src/lib/leagueFormat.ts is the same list.
// Whether each option can be picked yet comes from GET /leagues/formats.

export type LeagueType = 'redraft' | 'keeper' | 'dynasty' | 'bestball' | 'guillotine';
export type MatchupType = 'h2h' | 'points';
export type DraftType = 'snake' | 'auction';
export type RosterPreset = 'standard' | 'superflex' | '2qb' | 'idp';

export type LeagueFormat = {
  league_type: LeagueType;
  matchup_type: MatchupType;
  draft_type: DraftType;
  roster_preset: RosterPreset;
  type_settings: Record<string, number>;
};

export const LEAGUE_TYPES: { key: LeagueType; name: string; text: string; badge?: string }[] = [
  { key: 'redraft', name: 'Redraft', text: 'Fresh draft every season. The classic.', badge: 'Most popular' },
  { key: 'keeper', name: 'Keeper', text: 'Keep a few players into next season.' },
  { key: 'dynasty', name: 'Dynasty', text: 'Keep your whole roster. Rookie drafts and a taxi squad.' },
  { key: 'bestball', name: 'Best Ball', text: 'Draft and done. Your best lineup is set for you.' },
  { key: 'guillotine', name: 'Guillotine', text: 'Lowest score each week is cut. Last team standing wins.' },
];

export const ROSTER_PRESETS: { key: RosterPreset; label: string; sub: string }[] = [
  { key: 'standard', label: 'Standard', sub: '1 QB' },
  { key: 'superflex', label: 'Superflex', sub: 'QB/flex' },
  { key: '2qb', label: '2-QB', sub: '2 QB' },
  { key: 'idp', label: 'IDP', sub: '+ defenders' },
];

export const MATCHUP_TYPES: { key: MatchupType; label: string; sub: string }[] = [
  { key: 'h2h', label: 'Head-to-head', sub: 'Win your week' },
  { key: 'points', label: 'Total points', sub: 'Most points wins' },
];

export const DRAFT_TYPES: { key: DraftType; label: string; sub?: string }[] = [
  { key: 'snake', label: 'Snake' },
  { key: 'auction', label: 'Auction', sub: '$200 budget' },
];

// Each type's own settings on the basics screen: a stepper per number.
export type TypeSetting = { key: string; title: string; text: string; step?: number; prefix?: string };
export const TYPE_SETTINGS: Record<LeagueType, TypeSetting[]> = {
  redraft: [],
  keeper: [{ key: 'keepers_per_team', title: 'Keepers per team', text: 'Picked before the draft' }],
  dynasty: [
    { key: 'rookie_draft_rounds', title: 'Rookie draft rounds', text: 'Each offseason, worst team picks first' },
    { key: 'taxi_squad_size', title: 'Taxi squad', text: "Rookies who don't count against your roster" },
  ],
  bestball: [{ key: 'bench_size', title: 'Bench size', text: 'Deeper benches suit best ball' }],
  guillotine: [{ key: 'faab_budget', title: 'FAAB budget', text: 'For bidding on cut players', step: 100, prefix: '$' }],
};

// One line for each type's rule that isn't a number, shown above its settings.
export const TYPE_NOTE: Partial<Record<LeagueType, string>> = {
  bestball: 'Your highest scorers start every week. No trades or waivers after the draft.',
  guillotine: 'The lowest score each week is eliminated, and their players hit free agents.',
};

export type FormatLimits = { default: number; min: number; max: number };
export type FormatOptions = {
  league_type: { key: LeagueType; available: boolean }[];
  matchup_type: { key: MatchupType; available: boolean }[];
  draft_type: { key: DraftType; available: boolean }[];
  roster_preset: { key: RosterPreset; available: boolean }[];
  type_settings: Record<string, Record<string, FormatLimits>>;
};

export function isAvailable(options: FormatOptions | null, field: keyof Omit<FormatOptions, 'type_settings'>, key: string): boolean {
  if (!options) return key === 'redraft' || key === 'keeper' || key === 'h2h' || key === 'snake' || key === 'standard';
  return options[field].some((o) => o.key === key && o.available);
}

export function leagueTypeName(type: LeagueType): string {
  return LEAGUE_TYPES.find((t) => t.key === type)?.name ?? 'Redraft';
}

// 'Redraft · PPR · Superflex · Total points · Auction' — a league's
// format in one line; leaves out the standard choices.
export function formatSummary(f: Pick<LeagueFormat, 'league_type' | 'matchup_type' | 'draft_type' | 'roster_preset'>): string {
  const bits = [leagueTypeName(f.league_type)];
  if (f.roster_preset !== 'standard') bits.push(ROSTER_PRESETS.find((r) => r.key === f.roster_preset)?.label ?? '');
  if (f.matchup_type === 'points' && f.league_type !== 'guillotine') bits.push('Total points');
  if (f.draft_type === 'auction') bits.push('Auction');
  return bits.filter(Boolean).join(' · ');
}
