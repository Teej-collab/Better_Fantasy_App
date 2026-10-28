import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';

import { IntroOverlay } from '@/components/IntroOverlay';

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

const PLATFORM_NAMES: Record<string, string> = { espn: 'ESPN', sleeper: 'Sleeper' };

// The pop-up when joining puts you straight onto a team the app matched
// to your ESPN/Sleeper account (2026-10-28): it says so, and offers
// "Not my team" (a report) or "Send it", which plays the Welcome to The
// Weekend intro and lands you on Home (onEnter).
export function MatchedTeamBanner({
  visible,
  leagueId,
  leagueName,
  teamName,
  platform,
  displayName,
  onEnter,
}: {
  visible: boolean;
  leagueId: number;
  leagueName: string;
  teamName: string;
  platform?: string | null;
  displayName?: string | null;
  onEnter: () => void;
}) {
  const [reported, setReported] = useState<'no' | 'sending' | 'yes'>('no');
  const [intro, setIntro] = useState(false);
  const account = platform ? `${PLATFORM_NAMES[platform] ?? platform} account` : 'fantasy account';

  const notMine = () => {
    setReported('sending');
    haptics.select();
    api
      .notMyTeam(leagueId)
      .then(() => setReported('yes'))
      .catch(() => {
        setReported('no');
        Alert.alert('Couldn’t send that', 'Try again in a minute.');
      });
  };

  if (intro) {
    return (
      <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onEnter}>
        <IntroOverlay displayName={displayName ?? null} onDone={onEnter} />
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onEnter}>
      <View style={styles.backdrop}>
        <View style={styles.banner} accessibilityViewIsModal>
          <Text style={styles.kicker}>{reported === 'yes' ? 'Got it' : 'Matched to your team'}</Text>
          <Text style={styles.title}>{reported === 'yes' ? 'Thanks for telling us' : `You're ${teamName}`}</Text>
          <Text style={styles.body}>
            {reported === 'yes'
              ? `We'll sort out ${teamName} in ${leagueName} and fix it by hand. You can head in now.`
              : `We matched your ${account} to this team in ${leagueName}, so you're all set.`}
          </Text>
          <View style={styles.pills}>
            {reported !== 'yes' && (
              <Pressable
                onPress={notMine}
                disabled={reported === 'sending'}
                accessibilityRole="button"
                style={({ pressed }) => [styles.pill, styles.pillGhost, (pressed || reported === 'sending') && styles.pressed]}>
                <Text style={styles.pillGhostText}>{reported === 'sending' ? 'Sending…' : 'Not my team'}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                haptics.success();
                setIntro(true);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.pill, styles.pillSolid, pressed && styles.pressed]}>
              <Text style={styles.pillSolidText}>Send it</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.lg },
  banner: { gap: Spacing.sm, padding: Spacing.lg, borderRadius: 20, borderWidth: 1, borderColor: Colors.accent, backgroundColor: Colors.surface },
  kicker: { color: Colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { color: Colors.text, fontSize: 24, fontWeight: '800' },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  pill: { flexGrow: 1, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pillGhost: { borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(255,255,255,0.04)' },
  pillGhostText: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  pillSolid: { backgroundColor: Colors.accent },
  pillSolidText: { color: '#0d1016', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  block: { gap: Spacing.sm },
  team: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  teamOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.08)' },
  teamName: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkText: { color: Colors.textSecondary, fontSize: 14, textDecorationLine: 'underline' },
});
