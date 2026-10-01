import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { BetLeg, DraftLeg } from '@/lib/types';

// Bet tracking helpers — tracking only; nothing here places a bet.

// Same keys as backend app/domain/bets.py's STAT_KEYS.
export const BET_STATS: { key: string; label: string }[] = [
  { key: 'pass_yd', label: 'Passing yards' },
  { key: 'pass_td', label: 'Passing TDs' },
  { key: 'pass_int', label: 'Interceptions thrown' },
  { key: 'pass_cmp', label: 'Completions' },
  { key: 'pass_att', label: 'Pass attempts' },
  { key: 'rush_yd', label: 'Rushing yards' },
  { key: 'rush_att', label: 'Rush attempts' },
  { key: 'rec', label: 'Receptions' },
  { key: 'rec_yd', label: 'Receiving yards' },
  { key: 'rush_rec_yd', label: 'Rush + rec yards' },
  { key: 'pass_rush_yd', label: 'Pass + rush yards' },
  { key: 'anytime_td', label: 'Touchdowns' },
  { key: 'long_rush', label: 'Longest rush' },
  { key: 'long_rec', label: 'Longest reception' },
  { key: 'sacks', label: 'Sacks' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'kick_pts', label: 'Kicking points' },
  { key: 'fg_made', label: 'Field goals made' },
];

export function statLabel(key: string | null): string {
  return BET_STATS.find((s) => s.key === key)?.label ?? key ?? '';
}

export function formatOdds(odds: number | null | undefined): string {
  if (odds === null || odds === undefined) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(2)}`;
}

export function formatStat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// "Over 79.5 Rushing yards", "Anytime TD", "DET -3.5"...
export function legPick(leg: Pick<BetLeg, 'market' | 'stat_key' | 'line' | 'direction' | 'team_abbr' | 'description'> & { stat_label?: string | null }): string {
  if (leg.market === 'player_prop') {
    if (leg.stat_key === 'anytime_td') {
      const n = leg.line && leg.line >= 2 ? `${leg.line}+ TDs` : 'Anytime TD';
      return leg.direction === 'no' ? `No ${n}` : n;
    }
    return `${leg.direction === 'under' ? 'Under' : 'Over'} ${leg.line ?? '?'} ${leg.stat_label ?? statLabel(leg.stat_key)}`.trim();
  }
  if (leg.market === 'spread') return `${leg.team_abbr ?? '?'} ${leg.line !== null && leg.line > 0 ? '+' : ''}${leg.line ?? ''}`;
  if (leg.market === 'moneyline') return `${leg.team_abbr ?? '?'} to win`;
  if (leg.market === 'total') return `${leg.direction === 'under' ? 'Under' : 'Over'} ${leg.line ?? '?'} total points`;
  return leg.description;
}

export function describeDraftLeg(leg: DraftLeg): string {
  if (leg.description.trim()) return leg.description.trim();
  if (leg.market === 'player_prop') return `${leg.player_name ?? ''} ${leg.direction ?? ''} ${leg.line ?? ''} ${statLabel(leg.stat_key)}`.trim();
  if (leg.market === 'spread') return `${leg.team_abbr ?? ''} ${leg.line ?? ''}`.trim();
  if (leg.market === 'moneyline') return `${leg.team_abbr ?? ''} moneyline`.trim();
  if (leg.market === 'total') return `${leg.direction ?? ''} ${leg.line ?? ''} total points`.trim();
  return 'Bet';
}

// A bet-slip screenshot from the photo library, as a JPEG small enough to
// send (long edge ≤ 1800px). Null if the person canceled. The image goes
// straight to the server to be read and is never stored.
export async function pickSlipScreenshot(): Promise<{ base64: string; mediaType: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  let context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > 1800) {
    context = asset.height >= asset.width ? context.resize({ height: 1800 }) : context.resize({ width: 1800 });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) return null;
  return { base64: saved.base64, mediaType: 'image/jpeg' };
}
