// Matchup-screen helpers, ported from the web's components/matchups/
// (orientMatchup.ts, StarterComparisonTable.tsx) and lib/injuryStatus.ts,
// lib/positionRank.ts and lib/scoringLabels.ts.
import { Colors } from '@/constants/theme';
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, slotDisplayLabel, starterSortIndex } from '@/lib/rosterSlots';
import type { PositionRank, RosterPlayer, WeekMatchupContextItem } from '@/lib/types';

// Put the viewer's own team on the left ("home") side, flipping every
// home/away-relative number with it.
export function orientMatchupForViewer(m: WeekMatchupContextItem, viewerOwnerId: number | null): WeekMatchupContextItem {
  if (viewerOwnerId === null || m.away.owner_id !== viewerOwnerId || m.home.owner_id === viewerOwnerId) return m;
  const h2h = m.head_to_head;
  return {
    ...m,
    home: m.away,
    away: m.home,
    rivalry: m.rivalry
      ? { ...m.rivalry, all_time_wins_home: m.rivalry.all_time_wins_away, all_time_wins_away: m.rivalry.all_time_wins_home }
      : null,
    head_to_head: {
      ...h2h,
      wins_home: h2h.wins_away,
      wins_away: h2h.wins_home,
      recent_meetings: h2h.recent_meetings.map((g) => ({
        ...g,
        home_won: !g.tie && !g.home_won,
        home_score: g.away_score,
        away_score: g.home_score,
      })),
    },
  };
}

// "P. Mahomes"; a defense shows just its nickname ("Bills").
export function displayName(player: RosterPlayer): string {
  const parts = player.player_name.trim().split(/\s+/);
  if (player.position === 'DEF') return parts[parts.length - 1];
  if (parts.length < 2) return player.player_name;
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`;
}

export function starters(roster: RosterPlayer[]): RosterPlayer[] {
  return roster
    .filter((p) => p.lineup_slot !== BENCH_SLOT_LABEL && p.lineup_slot !== IR_SLOT_LABEL)
    .sort((a, b) => {
      const ai = starterSortIndex(a.lineup_slot ?? '');
      const bi = starterSortIndex(b.lineup_slot ?? '');
      return ai !== bi ? ai - bi : a.player_name.localeCompare(b.player_name);
    });
}

const BENCH_SLOT_ORDER = [BENCH_SLOT_LABEL, IR_SLOT_LABEL];
export function benchSortIndex(slot: string): number {
  const i = BENCH_SLOT_ORDER.indexOf(slot);
  return i === -1 ? BENCH_SLOT_ORDER.length : i;
}

export function bench(roster: RosterPlayer[]): RosterPlayer[] {
  return roster
    .filter((p) => p.lineup_slot === BENCH_SLOT_LABEL || p.lineup_slot === IR_SLOT_LABEL)
    .sort((a, b) => benchSortIndex(a.lineup_slot ?? '') - benchSortIndex(b.lineup_slot ?? ''));
}

export type ComparisonRow = { home: RosterPlayer | null; away: RosterPlayer | null; slot: string };

// One row per slot occupant, pairing each side's players slot by slot
// (two RBs face two RBs), so a missing starter leaves a blank.
export function buildComparisonRows(
  homeList: RosterPlayer[],
  awayList: RosterPlayer[],
  sortIndex: (slot: string) => number,
): ComparisonRow[] {
  const group = (list: RosterPlayer[]) => {
    const map = new Map<string, RosterPlayer[]>();
    for (const p of list) {
      const key = p.lineup_slot ?? '';
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  };
  const home = group(homeList);
  const away = group(awayList);
  const slots = Array.from(new Set([...home.keys(), ...away.keys()])).sort((a, b) => sortIndex(a) - sortIndex(b));
  const rows: ComparisonRow[] = [];
  for (const slot of slots) {
    const h = home.get(slot) ?? [];
    const a = away.get(slot) ?? [];
    for (let i = 0; i < Math.max(h.length, a.length); i++) {
      rows.push({ home: h[i] ?? null, away: a[i] ?? null, slot: slotDisplayLabel(slot) });
    }
  }
  return rows;
}

// "2 PASS TD, 287 PASS YDS, 1 INT" — the web's formatStatLine.
export function formatStatLine(rawStats: Record<string, number> | null): string | null {
  if (!rawStats) return null;
  const n = (key: string) => rawStats[key] ?? 0;
  const yardageKeys = ['rush_yd', 'rec_yd', 'pass_yd'].filter((k) => n(k) > 0);
  const yardLabel = (key: string, prefix: string) =>
    n(key) > 0 ? `${Math.round(n(key))} ${yardageKeys.length > 1 ? `${prefix} ` : ''}YDS` : null;
  const parts = [
    n('pass_td') > 0 && `${n('pass_td')} PASS TD`,
    yardLabel('pass_yd', 'PASS'),
    n('pass_int') > 0 && `${n('pass_int')} INT`,
    n('rush_td') > 0 && `${n('rush_td')} RUSH TD`,
    yardLabel('rush_yd', 'RUSH'),
    n('rec') > 0 && `${n('rec')} REC`,
    yardLabel('rec_yd', 'REC'),
    n('rec_td') > 0 && `${n('rec_td')} REC TD`,
    (n('def_return_td') > 0 || n('ret_td') > 0) && `${n('def_return_td') + n('ret_td')} TD`,
    n('def_sack') > 0 && `${n('def_sack')} SACK`,
    n('def_int') > 0 && `${n('def_int')} INT`,
    n('def_fum_rec') > 0 && `${n('def_fum_rec')} FR`,
    n('def_safety') > 0 && `${n('def_safety')} SFTY`,
    n('fum_lost') > 0 && `${n('fum_lost')} FUM`,
    n('xp_made') > 0 && `${n('xp_made')} XP`,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(', ') : null;
}

const ACRONYMS: Record<string, string> = { fg: 'FG', xp: 'XP', td: 'TD', int: 'INT', qb: 'QB' };

// "fg_made_40_49" → "FG Made 40-49", "pts_allow_lt7" → "Pts Allow <7".
export function humanizeStatCategory(key: string): string {
  const words = key.split('_');
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lessThan = w.match(/^lt(\d+)$/);
    if (lessThan) {
      parts.push(`<${lessThan[1]}`);
      continue;
    }
    if (w === 'plus' && parts.length > 0 && /^\d/.test(words[i - 1])) {
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
  return parts.join(' ');
}

const INJURY_SHORT_CODE: Record<string, string> = { QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'O', IR: 'IR', PUP: 'PUP', SUSPENDED: 'S' };

export function injuryShortCode(status: string): string {
  return INJURY_SHORT_CODE[status] ?? status.slice(0, 1);
}

export function hasInjuryBadge(status: string | null | undefined): status is string {
  return Boolean(status) && status !== 'ACTIVE';
}

export const IN_GAME_INJURY_LABELS = {
  left: 'Hurt',
  questionable_return: 'Q-return',
  doubtful_return: 'D-return',
  ruled_out: 'Out',
} as const;

function ordinal(rank: number): string {
  const r100 = rank % 100;
  if (r100 >= 11 && r100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

// "17th vs QB"; tough matchups (top 10) red, easy ones (23+) green.
export function formatPositionRank(rank: PositionRank, position: string | null): string | null {
  return rank && position ? `${ordinal(rank.rank)} vs ${position}` : null;
}

export function positionRankColor(rank: number): string {
  if (rank <= 10) return Colors.live;
  if (rank <= 22) return Colors.textSecondary;
  return Colors.win;
}
