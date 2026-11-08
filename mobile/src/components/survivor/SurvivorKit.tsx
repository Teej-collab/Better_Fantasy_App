import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ANTON, Elite, Hex } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { teamLogoUrl } from '@/lib/nflTeams';

// Shared pieces of the survivor screens (2026-11-07, canvas "Elite
// Survivor Pools"): team logos, the lives pips and the status hex.

/** A win chance's color: neon for big favorites, orange for underdogs. */
export function pctColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return Elite.blue;
  return pct >= 70 ? Elite.green : pct >= 58 ? Elite.mint : pct >= 50 ? Elite.cream : Elite.peach;
}

export function TeamLogo({ team, size = 30, dim = false }: { team: string | null; size?: number; dim?: boolean }) {
  const uri = teamLogoUrl(team);
  if (!uri) return <View style={{ width: size, height: size }} />;
  return <Image source={{ uri }} style={{ width: size, height: size, opacity: dim ? 0.3 : 1 }} contentFit="contain" accessibilityIgnoresInvertColors />;
}

export function LivesPips({ left, total }: { left: number; total: number }) {
  return (
    <View style={styles.pips} accessibilityLabel={`${left} of ${total} ${total === 1 ? 'life' : 'lives'} left`}>
      {Array.from({ length: total }, (_, i) => (
        <Hex key={i} width={10} color={i < left ? Elite.green : '#2a323d'} fill={i < left ? Elite.green : '#2a323d'} strokeWidth={1} />
      ))}
    </View>
  );
}

/** ALIVE / OUT / a count, in a hex. */
export function StatusHex({ label, alive, width = 46 }: { label: string; alive: boolean; width?: number }) {
  return (
    <Hex width={width} color={alive ? Elite.green : '#3a414b'} fill={alive ? '#0d1a0b' : '#161b22'} glow={alive}>
      <Text style={[styles.hexText, { color: alive ? Elite.green : '#a3aab4' }]}>{label}</Text>
    </Hex>
  );
}

export function livesText(left: number): string {
  return `${left} ${left === 1 ? 'life' : 'lives'} left`;
}

export function rulesLine(pool: { lives: number; tie_counts_as: string; double_from_week: number | null; buyback_until_week: number | null; missed_pick: string }): string {
  return [
    `${pool.lives} ${pool.lives === 1 ? 'life' : 'lives'}`,
    `ties count as ${pool.tie_counts_as === 'win' ? 'wins' : 'losses'}`,
    pool.double_from_week ? `two picks a week from week ${pool.double_from_week}` : null,
    pool.buyback_until_week ? `buyback through week ${pool.buyback_until_week}` : null,
    pool.missed_pick === 'auto' ? 'a missed pick gets the biggest favorite you have left' : 'a missed pick is a loss',
  ]
    .filter(Boolean)
    .join(' · ');
}

const styles = StyleSheet.create({
  pips: { flexDirection: 'row', gap: 3 },
  hexText: { fontFamily: ANTON, fontSize: 12 },
});
