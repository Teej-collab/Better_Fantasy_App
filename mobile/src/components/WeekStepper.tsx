import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

// Same range as the matchup screen's stepper.
export const MAX_WEEK = 17;

// ‹ Week N › with a "Back to Week N" link when off the current week —
// My Team and any other team's roster page (like ESPN's team sheet).
export function WeekStepper(props: {
  week: number;
  currentWeek: number | null;
  onChange: (week: number) => void;
  loading?: boolean;
}) {
  const { week, currentWeek, onChange } = props;
  function goTo(next: number) {
    if (next < 1 || next > MAX_WEEK || next === week) return;
    haptics.tap();
    onChange(next);
  }
  return (
    <View style={styles.row}>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => goTo(week - 1)}
          disabled={week <= 1}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          style={[styles.button, week <= 1 && styles.disabled]}
          hitSlop={6}>
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <Text style={styles.week}>Week {week}</Text>
        <Pressable
          onPress={() => goTo(week + 1)}
          disabled={week >= MAX_WEEK}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          style={[styles.button, week >= MAX_WEEK && styles.disabled]}
          hitSlop={6}>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>
      {props.loading && <ActivityIndicator size="small" color={Colors.textSecondary} />}
      {currentWeek !== null && week !== currentWeek && (
        <Pressable onPress={() => goTo(currentWeek)} hitSlop={6}>
          <Text style={styles.back}>Back to Week {currentWeek} →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  button: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  disabled: { opacity: 0.25 },
  arrow: { color: Colors.text, fontSize: 20, lineHeight: 22 },
  week: { fontFamily: Fonts.display, color: Colors.text, fontSize: 16, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: Spacing.sm },
  back: { color: Colors.accent, fontSize: 12, fontWeight: '600' },
});
