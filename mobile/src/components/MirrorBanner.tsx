import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useLeagueSwitch } from '@/lib/queries';

// Mirror mode (2026-10-24, backend app/domain/league_mode.py): a league
// still on ESPN/Sleeper. Roster moves are locked here and copied over from
// there, so say so where people would try to make one.
export function MirrorBanner() {
  const s = useLeagueSwitch().data;
  if (!s?.mirrored) return null;
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text style={styles.title}>Your league runs on {s.platform_name} for now</Text>
      <Text style={styles.body}>
        Make lineup moves, adds, drops and trades there. They show up here within a few minutes.
        {s.pending ? ` Moving to The Weekend for good in Week ${s.pending.effective_week}.` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: 'rgba(56,189,248,0.1)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.45)', borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  title: { color: Colors.text, fontSize: 14, fontWeight: '800' },
  body: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
});
