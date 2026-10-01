import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';

import { BetCard } from '@/components/bets/BetCard';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useBetsInGame } from '@/lib/queries';

// The Gamecast's Your Bets panel: every bet of yours with a leg in this
// game, graded live from the box score. Nothing shows when bet tracking
// is off or you have no bets on the game. A leg cashing mid-game buzzes
// and flashes a line, the bet's own big moment.
export function GamecastBets({ gameId, live }: { gameId: string; live: boolean }) {
  const q = useBetsInGame(gameId, live);
  const [justHit, setJustHit] = useState<string | null>(null);
  const won = useRef<Set<number> | null>(null);
  const bets = q.data?.enabled ? q.data.bets : [];

  useEffect(() => {
    if (!q.data) return;
    const legs = q.data.bets.flatMap((b) => b.legs.filter((l) => l.espn_event_id === gameId));
    const nowWon = new Set(legs.filter((l) => l.status === 'won').map((l) => l.id));
    const previous = won.current;
    won.current = nowWon;
    if (!previous) return;
    const fresh = legs.find((l) => nowWon.has(l.id) && !previous.has(l.id));
    if (!fresh) return;
    const text = `${fresh.player_name ?? fresh.description} cashed ✅`;
    // From a callback, not the effect body (see MomentBanner).
    const id = setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(`Bet leg hit: ${text}`);
      setJustHit(text);
    }, 0);
    return () => clearTimeout(id);
  }, [q.data, gameId]);

  useEffect(() => {
    if (!justHit) return;
    const id = setTimeout(() => setJustHit(null), 6000);
    return () => clearTimeout(id);
  }, [justHit]);

  if (bets.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text style={styles.title}>Your bets</Text>
        <Pressable onPress={() => router.push('/bets')} hitSlop={8} accessibilityRole="link">
          <Text style={styles.link}>My Bets →</Text>
        </Pressable>
      </View>
      {justHit && (
        <View style={styles.hit} accessibilityLiveRegion="polite">
          <Text style={styles.hitText}>{justHit}</Text>
        </View>
      )}
      {bets.map((bet) => (
        <BetCard key={bet.id} bet={bet} onlyEventId={gameId} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  link: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
  hit: { backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  hitText: { color: Colors.win, fontSize: 14, fontWeight: '700' },
});
