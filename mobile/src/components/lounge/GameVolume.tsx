import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { GAME_NORMAL, GAME_STEPS, gameLabel, setGameStep, useLoungeVolume } from '@/lib/loungeVolume';

// The game's volume as ten steps you tap or drag across, with a tick
// on each step (lib/loungeVolume.ts has why it isn't a slider anymore).
// The same setting on the TV's pill and in the sound board.
export function GameVolume({ accent, showLabel = true }: { accent: string; showLabel?: boolean }) {
  const { game } = useLoungeVolume();
  // Unmute goes back to where it was.
  const lastOn = useRef(game > 0 ? game : GAME_NORMAL);
  useEffect(() => {
    if (game > 0) lastOn.current = game;
  }, [game]);
  const [width, setWidth] = useState(0);
  const shown = useRef(game);

  function fromTouch(e: GestureResponderEvent) {
    if (!width) return;
    const step = Math.max(1, Math.min(GAME_STEPS, Math.ceil((e.nativeEvent.locationX / width) * GAME_STEPS)));
    if (step === shown.current) return;
    shown.current = step;
    haptics.tap();
    setGameStep(step);
  }

  return (
    <View style={styles.row}>
      <Pressable
        hitSlop={10}
        onPress={() => {
          haptics.tap();
          shown.current = game > 0 ? 0 : lastOn.current;
          setGameStep(shown.current);
        }}
        accessibilityLabel={game > 0 ? 'Mute the game for you' : 'Unmute the game for you'}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M11 5L6 9H2v6h4l5 4V5z" />
          {game > 0 ? <Path d="M15.5 8.5a5 5 0 010 7" /> : <Path d="M22 9l-6 6M16 9l6 6" />}
        </Svg>
      </Pressable>
      <View
        style={styles.bars}
        hitSlop={{ top: 10, bottom: 10 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          shown.current = game;
          fromTouch(e);
        }}
        onResponderMove={fromTouch}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Game volume, only for you"
        accessibilityValue={{ min: 0, max: GAME_STEPS, now: game, text: `${game} of ${GAME_STEPS}, ${gameLabel(game)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => setGameStep(game + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}>
        {Array.from({ length: GAME_STEPS }, (_, i) => (
          <View key={i} pointerEvents="none" style={[styles.bar, { height: 7 + i * 1.6, backgroundColor: i < game ? accent : 'rgba(255,255,255,0.22)' }]} />
        ))}
      </View>
      {showLabel && <Text style={styles.label}>{gameLabel(game)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 26, paddingVertical: 2 },
  bar: { width: 5, borderRadius: 2 },
  label: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: Fonts.mono, minWidth: 70 },
});
