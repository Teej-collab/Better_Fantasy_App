import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { InviteSheet } from '@/components/league/InviteSheet';
import { Door, Kicker, StartScreen, startStyles, Sub, Title } from '@/components/start/StartUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { LeagueInfo } from '@/lib/types';

// Leagues & invites (rebuilt 2026-10 in the league picker's look): your
// leagues as cards — open or switch, invite people, and (commissioner)
// manage — then the same Join / Create doors as the picker, and a
// co-owner code box. Setting up your team in a league you've joined
// without one stays here too.
//
// ?invite=<league id> opens that league's invite sheet straight away
// (the League tab's "Invite friends"); ?join=CODE (an older app link)
// goes to the join screen.
export default function LeaguesScreen() {
  const params = useLocalSearchParams<{ invite?: string; join?: string }>();
  const { signInWithToken } = useAuth();
  const q = useQuery({ queryKey: ['leagues-mine'], queryFn: api.leaguesMine });
  const [inviting, setInviting] = useState<LeagueInfo | null>(null);
  const [inviteParamUsed, setInviteParamUsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [coOwnerCode, setCoOwnerCode] = useState('');

  if (params.join) return <Redirect href={{ pathname: '/start/join', params: { code: params.join } }} />;
  if (q.isPending) return <LoadingState />;
  const leagues = q.data?.leagues ?? [];
  const activeId = q.data?.active_league_id ?? null;
  const fromParam = !inviteParamUsed && params.invite ? (leagues.find((l) => String(l.id) === params.invite) ?? null) : null;
  const sheetLeague = inviting ?? fromParam;

  async function run(key: string, action: () => Promise<unknown>, fallback: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await queryClient.invalidateQueries();
      haptics.success();
      return true;
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : fallback);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function open(l: LeagueInfo) {
    haptics.tap();
    if (l.id !== activeId) {
      if (!(await run(`switch-${l.id}`, () => api.selectLeague(l.id), "Couldn't switch leagues"))) return;
    }
    router.navigate('/');
  }

  async function manage(l: LeagueInfo) {
    // Commissioner Tools work on the active league — switch first.
    if (l.id !== activeId && !(await run(`switch-${l.id}`, () => api.selectLeague(l.id), "Couldn't switch leagues"))) return;
    router.push('/commissioner');
  }

  async function joinAsCoOwner() {
    const code = coOwnerCode.trim().replace(/^.*[?&]code=/, '');
    const ok = await run(
      'coowner',
      async () => {
        const { token } = await api.redeemCoOwnerInvite(code);
        await signInWithToken(token);
      },
      "Couldn't join as co-owner",
    );
    if (ok) {
      setCoOwnerCode('');
      setNotice("You're in — that team is now yours to manage too.");
    }
  }

  return (
    <StartScreen>
      <Stack.Screen options={{ title: 'Leagues & Invites' }} />
      <View style={styles.hero}>
        <Kicker>Your leagues</Kicker>
        <Title>Leagues &amp; invites</Title>
        <Sub>Switch leagues, bring friends in with an invite, or start something new.</Sub>
      </View>
      {error && <Text style={startStyles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.list}>
        {leagues.length === 0 && <Text style={startStyles.muted}>You&apos;re not in any leagues yet — join one or start your own below.</Text>}
        {leagues.map((l) => {
          const active = l.id === activeId;
          const noTeam = !l.summary?.team_name;
          return (
            <View key={l.id} style={[startStyles.card, active && startStyles.cardLit]}>
              <View style={styles.cardTop}>
                <Text style={[startStyles.cardTitle, styles.flex]} numberOfLines={1}>
                  {l.name}
                </Text>
                {active && (
                  <View style={styles.activePill}>
                    <Text style={styles.activeText}>Active</Text>
                  </View>
                )}
              </View>
              <Text style={startStyles.muted}>{cardLine(l)}</Text>
              {noTeam && <TeamSetup league={l} busy={busy} run={run} onSignIn={signInWithToken} />}
              <View style={styles.actions}>
                <ActionButton label={active ? 'Open' : busy === `switch-${l.id}` ? 'Switching…' : 'Switch'} primary={!active} onPress={() => void open(l)} />
                <ActionButton
                  label="Invite"
                  onPress={() => {
                    haptics.tap();
                    setInviting(l);
                  }}
                />
                {l.role === 'commissioner' && <ActionButton label="Manage" onPress={() => void manage(l)} />}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.list}>
        <Kicker>Add a league</Kicker>
        <Door title="Join a league" text="Got an invite link, code or QR from your commissioner?" accent="#39ff14" icon="users" onPress={() => router.push('/start/join')} />
        <Door title="Create a league" text="Start your own and run it as commissioner." accent="#2fd0ff" icon="plus" onPress={() => router.push('/start/create')} />
      </View>

      <View style={styles.coOwner}>
        <Text style={styles.coOwnerTitle}>Got a co-owner invite?</Text>
        <Text style={startStyles.muted}>Paste the link or code to manage that team alongside its owner.</Text>
        <View style={styles.row}>
          <TextInput
            value={coOwnerCode}
            onChangeText={setCoOwnerCode}
            placeholder="Co-owner link or code"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.flex]}
          />
          <Pressable onPress={() => void joinAsCoOwner()} disabled={busy !== null || !coOwnerCode.trim()} style={[styles.ghost, (busy !== null || !coOwnerCode.trim()) && styles.dim]} accessibilityRole="button">
            {busy === 'coowner' ? <ActivityIndicator color={Colors.text} /> : <Text style={styles.ghostText}>Join</Text>}
          </Pressable>
        </View>
      </View>

      <InviteSheet
        league={sheetLeague}
        onClose={() => {
          setInviting(null);
          setInviteParamUsed(true);
        }}
      />
    </StartScreen>
  );
}

// "Bucky'd Up · 2–1 · Week 4 · Commissioner", like the league picker.
function cardLine(l: LeagueInfo): string {
  const s = l.summary;
  const role = l.role === 'commissioner' ? 'Commissioner' : 'Member';
  if (!s?.team_name) return s && s.team_count ? `${s.teams} of ${s.team_count} teams in · ${role}` : role;
  const bits = [s.team_name];
  if (s.record && s.draft_status === 'complete') bits.push(s.record.replace('-', '–'));
  if (s.week && s.draft_status === 'complete') bits.push(`Week ${s.week}`);
  bits.push(role);
  return bits.join(' · ');
}

function ActionButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

// In a league without a team of your own: claim the history of a team
// you played as before, or start a new one.
function TeamSetup({
  league,
  busy,
  run,
  onSignIn,
}: {
  league: LeagueInfo;
  busy: string | null;
  run: (key: string, action: () => Promise<unknown>, fallback: string) => Promise<boolean>;
  onSignIn: (token: string) => Promise<void>;
}) {
  const unclaimed = useQuery({ queryKey: ['unclaimed-owners', league.id], queryFn: () => api.unclaimedOwners(league.id) }).data ?? [];
  const [name, setName] = useState('');
  return (
    <View style={styles.setup}>
      <Text style={styles.setupTitle}>Set up your team</Text>
      {unclaimed.length > 0 && (
        <>
          <Text style={styles.small}>Played here before? Claim your team — its history, chug debts and keepers come with it.</Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {unclaimed.map((o) => (
              <Pressable
                key={o.owner_id}
                disabled={busy !== null}
                onPress={() =>
                  void run(
                    `claim-${o.owner_id}`,
                    async () => {
                      const { token } = await api.claimOwner(league.id, o.owner_id);
                      await onSignIn(token);
                    },
                    "Couldn't claim that team — someone may have already claimed it.",
                  )
                }
                style={styles.chip}
                accessibilityRole="button">
                <Text style={styles.chipText}>{busy === `claim-${o.owner_id}` ? 'Claiming…' : `I'm ${o.display_name}`}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <View style={styles.row}>
        <TextInput value={name} onChangeText={setName} placeholder="New team name" placeholderTextColor={Colors.textSecondary} style={[styles.input, styles.flex]} />
        <Pressable
          disabled={busy !== null || !name.trim()}
          onPress={async () => {
            if (await run(`team-${league.id}`, () => api.createTeam(league.id, name.trim()), "Couldn't create your team")) setName('');
          }}
          style={[styles.ghost, (busy !== null || !name.trim()) && styles.dim]}
          accessibilityRole="button">
          <Text style={styles.ghostText}>{busy === `team-${league.id}` ? 'Creating…' : 'Create'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  hero: { gap: Spacing.sm, paddingTop: Spacing.sm },
  list: { gap: Spacing.md },
  notice: { color: '#34d399', fontSize: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  activePill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(57,255,20,0.14)' },
  activeText: { color: Colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderColor: Colors.accent, backgroundColor: 'rgba(57,255,20,0.1)' },
  actionText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  actionTextPrimary: { color: Colors.accent },
  setup: { gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', backgroundColor: 'rgba(251,191,36,0.06)' },
  setupTitle: { color: '#fbbf24', fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  small: { color: '#aab2bf', fontSize: 12, lineHeight: 17 },
  chip: { borderRadius: Radius.pill, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  input: { borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, color: Colors.text, fontSize: 15, paddingHorizontal: Spacing.md, height: 44 },
  ghost: { height: 44, minWidth: 80, borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  ghostText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  coOwner: { gap: Spacing.sm, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2a303a' },
  coOwnerTitle: { color: Colors.text, fontSize: 15, fontWeight: '700', fontFamily: Fonts.body },
});
