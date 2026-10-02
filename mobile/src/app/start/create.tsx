import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Field, GhostButton, Icon, Kicker, NeonButton, OptionCard, Segments, StartScreen, startStyles, StepDots, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { joinLinkFor } from '@/lib/qrJoin';
import { queryClient } from '@/lib/queries';
import type { LeagueInfo, ScoringPreset } from '@/lib/types';

// Create a league (port of the web's StartFlow create steps): 1) name +
// start fresh or from ESPN, 2) the basics — teams, scoring, draft,
// keepers, 3) your team; then the invite screen with the league's QR.
// ?from=espn preselects "Bring it over from ESPN".

const SCORING: { key: ScoringPreset; label: string }[] = [
  { key: 'ppr', label: 'PPR' },
  { key: 'half', label: 'Half PPR' },
  { key: 'standard', label: 'Standard' },
];
const TIMES = [18, 19, 20, 21];

// The next two weeks, for picking a draft day without a date wheel.
function upcomingDays(): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, i) => new Date(today.getTime() + (i + 1) * 86_400_000));
}

export default function CreateScreen() {
  const params = useLocalSearchParams<{ from?: string }>();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState('');
  const [source, setSource] = useState<'fresh' | 'espn'>(params.from === 'espn' ? 'espn' : 'fresh');
  const [teamCount, setTeamCount] = useState(12);
  const [scoring, setScoring] = useState<ScoringPreset>('ppr');
  const [draftDay, setDraftDay] = useState<number | null>(null);
  const [draftHour, setDraftHour] = useState(19);
  const [keepers, setKeepers] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = upcomingDays();

  const draftAt = draftDay !== null ? new Date(days[draftDay].getTime() + draftHour * 3_600_000) : null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createLeague(name.trim(), { teamCount, scoring, keepers, makeActive: true });
      await api.createTeam(created.id, teamName.trim());
      if (draftAt) await api.setDraftSchedule(draftAt.toISOString()).catch(() => {});
      await queryClient.invalidateQueries();
      haptics.success();
      setLeague(created);
      setStep(4);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't create the league — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === 4 && league) {
    const link = joinLinkFor(league.invite_code);
    return (
      <StartScreen
        footer={
          <>
            {source === 'espn' && <GhostButton label="Connect ESPN to import your history" onPress={() => router.replace('/commissioner/espn')} />}
            {!draftAt && <GhostButton label="Set your draft date" onPress={() => router.replace('/draft')} />}
            <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={styles.textButton}>
              <Text style={startStyles.muted}>Go to my league</Text>
            </Pressable>
          </>
        }>
        <Stack.Screen options={{ title: 'Invite Your League', headerBackVisible: false }} />
        <View style={styles.center}>
          <View style={startStyles.found}>
            <Icon name="check" color={Colors.accent} size={18} />
            <Text style={startStyles.foundText}>{league.name} is live</Text>
          </View>
          <Title>Now bring your league</Title>
          <Sub>Everyone who scans this or opens the link lands right in your league.</Sub>
        </View>
        <View style={styles.qr} accessible accessibilityRole="image" accessibilityLabel={`QR code to join ${league.name}`}>
          <QRCode value={link} size={196} color="#0d1016" backgroundColor="#ffffff" ecl="M" />
        </View>
        <View style={styles.progressWrap}>
          <View style={styles.progressTop}>
            <Text style={startStyles.muted}>Teams in</Text>
            <Text style={styles.mono}>1 / {teamCount}</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${100 / teamCount}%` }]} />
          </View>
        </View>
        <View style={styles.linkRow}>
          <Text style={styles.linkText} numberOfLines={1}>
            {link.replace(/^https?:\/\//, '')}
          </Text>
          {/* The share sheet has Copy too. */}
          <Pressable onPress={() => void Share.share({ message: link })} accessibilityRole="button" accessibilityLabel="Copy or share the invite link" style={styles.copy}>
            <Text style={styles.copyText}>Copy</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <NeonButton
              label="Share"
              onPress={() => void Share.share({ message: `Join my league "${league.name}" on The Weekend — code ${league.invite_code}: ${link}` })}
            />
          </View>
          <View style={[styles.codeBox, styles.flex]} accessible accessibilityLabel={`League code ${league.invite_code}`}>
            <Text style={startStyles.muted}>Code</Text>
            <Text style={styles.code}>{league.invite_code}</Text>
          </View>
        </View>
      </StartScreen>
    );
  }

  if (step === 3) {
    return (
      <StartScreen footer={<NeonButton label="Create league" onPress={() => void create()} disabled={!teamName.trim()} busy={busy} />}>
        <Stack.Screen options={{ title: 'Create a League' }} />
        <StepDots step={3} />
        <View style={styles.head}>
          <Kicker>Create a league · 3 of 3</Kicker>
          <Title>Now your team</Title>
          <Sub>This is what everyone sees in standings, matchups and chat. Add a logo any time in Settings.</Sub>
        </View>
        <Field label="Team name" value={teamName} onChangeText={setTeamName} maxLength={40} placeholder="Name your team" style={styles.bigField} />
        <View style={startStyles.card}>
          <Kicker>Your league</Kicker>
          <Text style={startStyles.cardTitle}>{name}</Text>
          <Text style={startStyles.muted}>
            {teamCount} teams · {SCORING.find((s) => s.key === scoring)?.label} · {draftAt ? `Draft ${formatDraft(draftAt)}` : 'Draft date later'} · Keepers{' '}
            {keepers ? 'on' : 'off'}
          </Text>
        </View>
        {error && <Text style={startStyles.error}>{error}</Text>}
        <GhostButton label="Back" onPress={() => setStep(2)} />
      </StartScreen>
    );
  }

  if (step === 2) {
    return (
      <StartScreen footer={<NeonButton label="Continue" onPress={() => setStep(3)} />}>
        <Stack.Screen options={{ title: 'Create a League' }} />
        <StepDots step={2} />
        <View style={styles.head}>
          <Kicker>Create a league · 2 of 3</Kicker>
          <Title>Set the basics</Title>
        </View>
        <Segments label="How many teams?" options={[8, 10, 12, 14].map((n) => ({ key: n, label: String(n) }))} value={teamCount} onChange={setTeamCount} />
        <Segments label="Scoring" options={SCORING} value={scoring} onChange={setScoring} />
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Draft</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Decide later" on={draftDay === null} onPress={() => setDraftDay(null)} />
            {days.map((d, i) => (
              <Chip key={i} label={d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} on={draftDay === i} onPress={() => setDraftDay(i)} />
            ))}
          </ScrollView>
          {draftDay !== null && (
            <View style={styles.chipsWrap}>
              {TIMES.map((h) => (
                <Chip key={h} label={`${h - 12}:00 PM`} on={draftHour === h} onPress={() => setDraftHour(h)} />
              ))}
            </View>
          )}
        </View>
        <View style={[startStyles.card, styles.switchRow]}>
          <View style={styles.flex}>
            <Text style={styles.switchTitle}>Keepers</Text>
            <Text style={startStyles.muted}>Teams keep players into next season</Text>
          </View>
          <Switch value={keepers} onValueChange={setKeepers} accessibilityLabel="Keepers" trackColor={{ true: Colors.accent, false: '#2a303a' }} />
        </View>
        <Text style={styles.note}>Roster spots, playoffs and every scoring rule are in Commissioner Tools whenever you want them.</Text>
        <GhostButton label="Back" onPress={() => setStep(1)} />
      </StartScreen>
    );
  }

  return (
    <StartScreen footer={<NeonButton label="Continue" onPress={() => setStep(2)} disabled={!name.trim()} />}>
      <Stack.Screen options={{ title: 'Create a League' }} />
      <StepDots step={1} />
      <View style={styles.head}>
        <Kicker>Create a league · 1 of 3</Kicker>
        <Title>Name your league</Title>
      </View>
      <Field label="League name" value={name} onChangeText={setName} maxLength={40} placeholder="Sunday Scaries" style={styles.bigField} />
      <View style={styles.group}>
        <Kicker>Start from</Kicker>
        <OptionCard on={source === 'fresh'} onPress={() => setSource('fresh')} icon="plus" color={Colors.accent} title="Start fresh" text="A new league with good defaults. Tweak anything later." />
        <OptionCard
          on={source === 'espn'}
          onPress={() => setSource('espn')}
          icon="download"
          color="#fbbf24"
          title="Bring it over from ESPN"
          text="After it's created, connect ESPN to import every past season, owner, matchup and record."
        />
      </View>
    </StartScreen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function formatDraft(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  head: { gap: Spacing.sm },
  center: { alignItems: 'center', gap: Spacing.sm },
  group: { gap: Spacing.sm },
  groupLabel: { color: '#aab2bf', fontSize: 13, fontWeight: '600' },
  bigField: { fontSize: 18, fontWeight: '600' },
  chips: { gap: Spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { minHeight: 40, borderRadius: Radius.pill, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, paddingHorizontal: 14, justifyContent: 'center' },
  chipOn: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.12)' },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: Colors.accent },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  note: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  qr: { alignSelf: 'center', padding: 16, borderRadius: 20, backgroundColor: '#ffffff', shadowColor: Colors.accent, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  progressWrap: { gap: 6 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between' },
  mono: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 14 },
  bar: { height: 8, borderRadius: 4, backgroundColor: Colors.border, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.accent },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.tile, paddingLeft: 14, paddingRight: 6 },
  linkText: { flex: 1, color: Colors.text, fontFamily: Fonts.mono, fontSize: 13 },
  copy: { minHeight: 40, minWidth: 64, borderRadius: 10, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  copyText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  codeBox: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  code: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 16, letterSpacing: 2 },
  textButton: { alignItems: 'center', paddingVertical: Spacing.md },
});
