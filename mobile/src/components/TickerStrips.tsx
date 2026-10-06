import { StyleSheet, View } from 'react-native';

import { LiveTicker } from '@/components/home/LiveTicker';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import type { TickerItem } from '@/lib/ticker';

// The Lounge's look, everywhere (2026-10): slim strips labelled NFL and
// LEAGUE, one above the other. Each is still the full LiveTicker
// underneath — it auto-scrolls, you can swipe it to find a game, and its
// games open on tap (unless `interactive` is off, as in the Lounge).
export function TickerStrips({
  nfl,
  league,
  fast = false,
  leagueFast = fast,
  interactive = true,
  framed = true,
}: {
  nfl: TickerItem[];
  league: TickerItem[];
  fast?: boolean;
  leagueFast?: boolean;
  interactive?: boolean;
  /** A rounded dark box around both strips (off in the Lounge, edge to edge). */
  framed?: boolean;
}) {
  const accent = useAppearance().accent;
  if (nfl.length === 0 && league.length === 0) return null;
  return (
    <View style={framed ? [styles.frame, fast && styles.frameLive] : undefined}>
      {nfl.length > 0 && <Strip label="NFL" labelColor="#9aa3b2" tint="rgba(255,255,255,0.03)" items={nfl} fast={fast} interactive={interactive} />}
      {league.length > 0 && (
        <Strip label="LEAGUE" labelColor={accent} tint="rgba(57,255,20,0.04)" items={league} fast={leagueFast} interactive={interactive} divided={nfl.length > 0} />
      )}
    </View>
  );
}

function Strip(props: { label: string; labelColor: string; tint: string; items: TickerItem[]; fast: boolean; interactive: boolean; divided?: boolean }) {
  return (
    <View style={[styles.strip, { backgroundColor: props.tint }, props.divided && styles.divided]}>
      <Text style={[styles.label, { color: props.labelColor }]} maxFontSizeMultiplier={1}>
        {props.label}
      </Text>
      <LiveTicker items={props.items} fast={props.fast} interactive={props.interactive} bare />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0d1016' },
  frameLive: { borderColor: 'rgba(239,68,68,0.5)' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32, paddingLeft: 12 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  label: { fontFamily: Fonts.displayBold, fontSize: 10, letterSpacing: 1.2 },
});
