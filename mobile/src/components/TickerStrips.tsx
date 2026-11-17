import { StyleSheet, View } from 'react-native';

import { LiveTicker } from '@/components/home/LiveTicker';
import { Text } from '@/components/Text';
import { OB } from '@/components/ob/Ob';
import { Fonts, OwnersBox } from '@/constants/theme';
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
    <View style={framed ? [styles.frame, fast && styles.frameLive, OwnersBox && styles.obFrame] : undefined}>
      {nfl.length > 0 && <Strip label="NFL" labelColor={OwnersBox ? OB.mute : '#9aa3b2'} tint={OwnersBox ? 'transparent' : 'rgba(255,255,255,0.03)'} items={nfl} fast={fast} interactive={interactive} />}
      {league.length > 0 && (
        <Strip label="LEAGUE" labelColor={OwnersBox ? OB.lamp : accent} tint={OwnersBox ? 'transparent' : 'rgba(57,255,20,0.04)'} items={league} fast={leagueFast} interactive={interactive} divided={nfl.length > 0} />
      )}
    </View>
  );
}

function Strip(props: { label: string; labelColor: string; tint: string; items: TickerItem[]; fast: boolean; interactive: boolean; divided?: boolean }) {
  return (
    <View style={[styles.strip, { backgroundColor: props.tint }, props.divided && styles.divided]}>
      <Text style={[styles.label, OwnersBox && styles.obLabel, { color: props.labelColor }]} maxFontSizeMultiplier={1}>
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
  // Owners Box: edge lines instead of a box, mono labels.
  obFrame: { borderRadius: 0, borderWidth: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: OB.rim, backgroundColor: 'rgba(6,7,8,0.6)' },
  obLabel: { fontFamily: Fonts.mono, fontSize: 9.5, letterSpacing: 1.6 },
});
