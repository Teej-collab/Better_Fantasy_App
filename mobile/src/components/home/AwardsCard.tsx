import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { SectionTitle } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import type { WeeklyAwards, WeeklyNarrative } from '@/lib/types';

type Tile = { emoji: string; label: string; accent: string; title: string; subtitle: string };

// Same tiles, order and wording as the web's buildAwardTiles
// (frontend/src/app/(home)/page.tsx); accents are Tailwind's -500s.
function buildAwardTiles(a: WeeklyAwards): Tile[] {
  const tiles: Tile[] = [];
  if (a.game_of_the_week) {
    tiles.push({
      emoji: '⭐',
      label: 'Game of the Week',
      accent: '#f59e0b',
      title: a.game_of_the_week.winner,
      subtitle: `Won ${a.game_of_the_week.score}`,
    });
  }
  const boom = a.boom_leaders[0];
  if (boom) {
    tiles.push({
      emoji: '🔥',
      label: 'Boom of the Week',
      accent: '#f97316',
      title: boom.player_name,
      subtitle: `${boom.points_scored.toFixed(1)} pts — ${boom.team_name}`,
    });
  }
  const bust = a.bust_leaders[0];
  if (bust) {
    tiles.push({
      emoji: '🥶',
      label: 'Bust of the Week',
      accent: '#0ea5e9',
      title: bust.player_name,
      subtitle: `${bust.points_scored.toFixed(1)} pts — ${bust.team_name}`,
    });
  }
  if (a.biggest_bench_crime) {
    const bc = a.biggest_bench_crime;
    tiles.push({
      emoji: '💀',
      label: 'Biggest Bench Crime',
      accent: '#64748b',
      title: `${bc.bench_player} > ${bc.started_player}`,
      subtitle: `+${bc.points_diff.toFixed(1)} pts (${bc.severity}) — ${bc.team_name}`,
    });
  }
  if (a.overachiever) {
    tiles.push({
      emoji: '📈',
      label: 'Overachiever',
      accent: '#10b981',
      title: a.overachiever.team_name,
      subtitle: `+${a.overachiever.diff.toFixed(1)} pts vs. expected`,
    });
  }
  if (a.meltdown) {
    tiles.push({
      emoji: '📉',
      label: 'Meltdown',
      accent: '#ef4444',
      title: a.meltdown.team_name,
      subtitle: `${a.meltdown.diff.toFixed(1)} pts vs. expected`,
    });
  }
  if (a.clutch) {
    tiles.push({ emoji: '🎯', label: 'Clutch', accent: '#14b8a6', title: a.clutch.team_name, subtitle: a.clutch.reason });
  }
  if (a.choke) {
    tiles.push({ emoji: '😬', label: 'Choke', accent: '#a855f7', title: a.choke.team_name, subtitle: a.choke.reason });
  }
  return tiles;
}

export function AwardsCard(props: {
  awards: WeeklyAwards;
  awardsWeek: number;
  currentWeek: number;
  recap: { recap: WeeklyNarrative; week: number } | null;
}) {
  const tiles = buildAwardTiles(props.awards);
  return (
    <View style={styles.section}>
      <SectionTitle>{props.awardsWeek === props.currentWeek ? "This Week's Awards" : `Week ${props.awardsWeek} Awards`}</SectionTitle>
      <View style={styles.grid}>
        {tiles.map((t, i) => (
          <View key={i} style={styles.tile}>
            <Text style={[styles.tileLabel, { color: t.accent }]}>
              {t.emoji} {t.label}
            </Text>
            <Text style={styles.tileTitle}>{t.title}</Text>
            <Text style={styles.tileSubtitle}>{t.subtitle}</Text>
          </View>
        ))}
      </View>
      {props.recap && <RecapTeaser recap={props.recap.recap} week={props.recap.week} />}
    </View>
  );
}

const RECAP_TEASER_MAX_CHARS = 220;

// Port of the web's WeeklyRecapTeaser: a 220-character preview that
// expands in place to the full AI recap.
function RecapTeaser({ recap, week }: { recap: WeeklyNarrative; week: number }) {
  const [expanded, setExpanded] = useState(false);
  const full = recap.text.trim();
  const flat = full.replace(/\s+/g, ' ');
  const truncatable = flat.length > RECAP_TEASER_MAX_CHARS;
  const snippet = truncatable ? flat.slice(0, RECAP_TEASER_MAX_CHARS).replace(/\s+\S*$/, '') : flat;

  return (
    <NeonPanel color={SectionColors.awards} contentStyle={styles.recap}>
      <Text style={[styles.recapKicker, { color: SectionColors.awards }]}>📰 Week {week} Recap</Text>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.recapBody}>
        <Text style={styles.recapText}>{expanded ? full : `${snippet}${truncatable ? '…' : ''}`}</Text>
        <View style={[styles.recapButton, { backgroundColor: `${SectionColors.awards}2e` }]}>
          <Text style={styles.recapButtonText}>{expanded ? 'Show less ↑' : 'Read the full recap →'}</Text>
        </View>
      </Pressable>
    </NeonPanel>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    width: '48.5%',
    flexGrow: 1,
    gap: 2,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tileLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  tileTitle: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  tileSubtitle: { color: Colors.textSecondary, fontSize: 12 },
  recap: { gap: Spacing.sm },
  recapKicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  recapBody: { gap: Spacing.sm },
  recapText: { color: 'rgba(255,255,255,0.8)', fontSize: 16, lineHeight: 24 },
  recapButton: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4 },
  recapButtonText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
});
