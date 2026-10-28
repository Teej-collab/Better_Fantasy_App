import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { NeonButton, startStyles } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';

// Matching you to your team in a league brought in from ESPN or Sleeper
// (2026-10-28). Teams are matched by the ESPN/Sleeper account that runs
// them, never by name; these cover the cases that match can't settle.

// Claiming a team links it to your account in every league, so it asks
// first: a wrong tap is the one way a team gets mixed up.
export function confirmClaim(teamName: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      `Is ${teamName} your team?`,
      'Claiming it links it to your account in every league. Only claim your own team.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Claim it', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

// One ESPN/Sleeper login runs several teams here (a family league, say):
// you pick yours, and each of the others is left for its real manager.
export function SharedLoginPicker({
  leagueId,
  teams,
  platform,
  onPicked,
}: {
  leagueId: number;
  teams: { team_id: number; team_name: string }[];
  platform: string;
  onPicked: (team: { team_id: number; team_name: string }) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const team = teams.find((t) => t.team_id === picked);
    if (!team) return;
    setBusy(true);
    setError(null);
    try {
      await api.chooseMyTeam(leagueId, team.team_id);
      haptics.success();
      onPicked(team);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.block}>
      <Text style={startStyles.muted}>
        Your {platform} account runs {teams.length} teams in this league. Which one is yours? The others stay open for
        whoever really manages them.
      </Text>
      {teams.map((t) => {
        const on = picked === t.team_id;
        return (
          <Pressable
            key={t.team_id}
            onPress={() => {
              haptics.select();
              setPicked(t.team_id);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={[styles.team, on && styles.teamOn]}>
            <Text style={styles.teamName}>{t.team_name}</Text>
          </Pressable>
        );
      })}
      {error && <Text style={startStyles.error}>{error}</Text>}
      <NeonButton label="This one's mine" onPress={() => void save()} disabled={picked === null} busy={busy} />
    </View>
  );
}

// "Not my team?" under a team the app matched you to. It only reports;
// changing nothing on its own (a wrong unlink is worse than a wrong match).
export function NotMyTeamLink({ leagueId }: { leagueId: number }) {
  const [sent, setSent] = useState(false);
  const report = () =>
    Alert.alert('Not your team?', "We'll tell the people who run The Weekend and fix it by hand.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report it',
        onPress: () =>
          void api
            .notMyTeam(leagueId)
            .then(() => setSent(true))
            .catch(() => Alert.alert('Couldn’t send that', 'Try again in a minute.')),
      },
    ]);
  if (sent) return <Text style={startStyles.muted}>Thanks. We&apos;ll look into it.</Text>;
  return (
    <Pressable onPress={report} accessibilityRole="button" hitSlop={8} style={styles.link}>
      <Text style={styles.linkText}>Not my team?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  team: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  teamOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.08)' },
  teamName: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkText: { color: Colors.textSecondary, fontSize: 14, textDecorationLine: 'underline' },
});
