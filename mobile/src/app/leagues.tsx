import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { useAuth } from '@/lib/auth';
import { canScanQr, joinLinkFor, scanInvite, type ScannedInvite } from '@/lib/qrJoin';
import { queryClient, useMe } from '@/lib/queries';
import type { LeagueInfo } from '@/lib/types';

// Everything a league's data depends on changes when the active league
// or your owner link does — refetch it all.
async function refreshEverything() {
  await queryClient.invalidateQueries();
}

function useMyLeagues() {
  return useQuery({
    queryKey: ['leagues-detail'],
    queryFn: async () => {
      const { leagues, active_league_id } = await api.leaguesMine();
      const details = await Promise.all(
        leagues.map(async (l) => {
          const [teams, unclaimed, members] = await Promise.all([
            api.leagueTeams(l.id).catch(() => []),
            api.unclaimedOwners(l.id).catch(() => []),
            api.leagueMembers(l.id).catch(() => []),
          ]);
          return { league: l, teams, unclaimed, members };
        }),
      );
      return { activeLeagueId: active_league_id, details };
    },
  });
}

// Port of the web's /leagues: your leagues (switch, invite code, create
// your team, claim your history, commissioner rename and roles), then
// create a league and join one by invite code. Plus a co-owner invite
// code box — a co-owner link opens the website, so it can be pasted here.
export default function LeaguesScreen() {
  // ?join=CODE: a scanned league QR opened as an app link.
  const params = useLocalSearchParams<{ focus?: string; join?: string }>();
  const focus = params.join ? 'join' : params.focus;
  const accent = useAppearance().accent;
  const { signInWithToken } = useAuth();
  const myUserId = useMe().data?.user_id;
  const q = useMyLeagues();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [inviteCode, setInviteCode] = useState(params.join ?? '');
  const [coOwnerCode, setCoOwnerCode] = useState('');
  const [teamNames, setTeamNames] = useState<Record<number, string>>({});
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, fallback: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refreshEverything();
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

  async function joinLeague(code: string) {
    if (await run('join', () => api.joinLeague(code), "Couldn't join that league")) {
      setInviteCode('');
      setNotice("You're in — welcome to the league.");
    }
  }

  async function joinAsCoOwner(code: string) {
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

  async function scan() {
    const onInvite = (invite: ScannedInvite) => {
      haptics.success();
      if (invite.kind === 'league') {
        setInviteCode(invite.code);
        void joinLeague(invite.code);
      } else {
        setCoOwnerCode(invite.code);
        void joinAsCoOwner(invite.code);
      }
    };
    const result = await scanInvite(onInvite);
    if (result === 'denied') {
      Alert.alert('Camera is off', 'Allow camera access for The Weekend in Settings to scan a league QR code.');
    } else if (result === 'unavailable') {
      Alert.alert("Can't scan here", 'Type the invite code instead.');
    }
  }

  if (q.isPending) return <LoadingState />;
  const details = q.data?.details ?? [];
  const activeId = q.data?.activeLeagueId ?? null;

  const createSection = (
    <NeonPanel key="create" color={accent} contentStyle={styles.gap}>
      <Text style={styles.sectionTitle}>Create a league</Text>
      <View style={styles.row}>
        <TextInput
          value={newLeagueName}
          onChangeText={setNewLeagueName}
          placeholder="League name"
          placeholderTextColor={Colors.textSecondary}
          autoFocus={focus === 'create'}
          style={[styles.input, styles.flex]}
        />
        <Pressable
          onPress={async () => {
            if (await run('create', () => api.createLeague(newLeagueName.trim()), "Couldn't create the league")) setNewLeagueName('');
          }}
          disabled={busy !== null || !newLeagueName.trim()}
          style={[styles.primary, { backgroundColor: accent }, (busy !== null || !newLeagueName.trim()) && styles.dim]}>
          {busy === 'create' ? <ActivityIndicator color="#06110a" /> : <Text style={styles.primaryText}>Create</Text>}
        </Pressable>
      </View>
    </NeonPanel>
  );

  const joinSection = (
    <NeonPanel key="join" color={accent} contentStyle={styles.gap}>
      <Text style={styles.sectionTitle}>Join a league</Text>
      <View style={styles.row}>
        <TextInput
          value={inviteCode}
          onChangeText={setInviteCode}
          placeholder="Invite code"
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={focus === 'join' && !params.join}
          style={[styles.input, styles.flex]}
        />
        <Pressable
          onPress={() => void joinLeague(inviteCode.trim())}
          disabled={busy !== null || !inviteCode.trim()}
          style={[styles.outline, (busy !== null || !inviteCode.trim()) && styles.dim]}>
          {busy === 'join' ? <ActivityIndicator color={Colors.text} /> : <Text style={styles.outlineText}>Join</Text>}
        </Pressable>
      </View>
      {canScanQr && (
        <Pressable onPress={() => void scan()} disabled={busy !== null} accessibilityRole="button" style={[styles.outline, styles.scanButton]}>
          <Text style={styles.outlineText}>Scan a league QR code</Text>
        </Pressable>
      )}
    </NeonPanel>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl />} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Leagues' }} />
      <View style={{ gap: 4 }}>
        <Display style={styles.title}>Leagues</Display>
        <Text style={styles.soft}>Join an existing league with the invite code your commissioner shares, or start a new one of your own.</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      {/* Someone who came here to join or create sees that step first. */}
      {focus === 'join' && joinSection}
      {focus === 'create' && createSection}

      <NeonPanel color={accent} contentStyle={styles.gap}>
        <Text style={styles.sectionTitle}>Your leagues</Text>
        {details.length === 0 ? (
          <Text style={styles.soft}>You&apos;re not in any leagues yet — create one or join with an invite code below.</Text>
        ) : (
          details.map(({ league, teams, unclaimed, members }) => (
            <LeagueBlock
              key={league.id}
              league={league}
              active={league.id === activeId}
              teams={teams}
              unclaimed={unclaimed}
              members={members}
              myUserId={myUserId}
              busy={busy}
              renaming={renaming === league.id}
              renameValue={renameValue}
              teamName={teamNames[league.id] ?? ''}
              onTeamName={(v) => setTeamNames((prev) => ({ ...prev, [league.id]: v }))}
              onStartRename={() => {
                setRenaming(league.id);
                setRenameValue(league.name);
              }}
              onRenameValue={setRenameValue}
              onCancelRename={() => setRenaming(null)}
              onSaveRename={async () => {
                if (await run(`rename-${league.id}`, () => api.renameLeague(league.id, renameValue.trim()), "Couldn't rename that league")) setRenaming(null);
              }}
              onSwitch={() => run(`switch-${league.id}`, () => api.selectLeague(league.id), "Couldn't switch leagues")}
              onCreateTeam={async () => {
                const name = (teamNames[league.id] ?? '').trim();
                if (!name) return;
                if (await run(`team-${league.id}`, () => api.createTeam(league.id, name), "Couldn't create your team")) {
                  setTeamNames((prev) => ({ ...prev, [league.id]: '' }));
                }
              }}
              onClaim={(ownerId) =>
                run(
                  `claim-${ownerId}`,
                  async () => {
                    const { token } = await api.claimOwner(league.id, ownerId);
                    await signInWithToken(token);
                  },
                  "Couldn't claim that history — someone may have already claimed it.",
                )
              }
              onRole={(userId, role) => run(`role-${userId}`, () => api.setMemberRole(league.id, userId, role), "Couldn't change that member's role")}
            />
          ))
        )}
      </NeonPanel>

      {focus !== 'create' && createSection}
      {focus !== 'join' && joinSection}

      <NeonPanel color={accent} contentStyle={styles.gap}>
        <Text style={styles.sectionTitle}>Join as a co-owner</Text>
        <Text style={styles.small}>
          Got a co-owner invite? Paste its code (the part after code= in the link) to manage that team with its owner.
        </Text>
        <View style={styles.row}>
          <TextInput
            value={coOwnerCode}
            onChangeText={setCoOwnerCode}
            placeholder="Co-owner code"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.flex]}
          />
          <Pressable
            onPress={() => void joinAsCoOwner(coOwnerCode.trim().replace(/^.*[?&]code=/, ''))}
            disabled={busy !== null || !coOwnerCode.trim()}
            style={[styles.outline, (busy !== null || !coOwnerCode.trim()) && styles.dim]}>
            {busy === 'coowner' ? <ActivityIndicator color={Colors.text} /> : <Text style={styles.outlineText}>Join</Text>}
          </Pressable>
        </View>
      </NeonPanel>
    </ScrollView>
  );
}

function LeagueBlock(props: {
  league: LeagueInfo;
  active: boolean;
  teams: { team_id: number; team_name: string; owner_name: string }[];
  unclaimed: { owner_id: number; display_name: string }[];
  members: { user_id: number; display_name: string; role: 'commissioner' | 'member' }[];
  myUserId: number | undefined;
  busy: string | null;
  renaming: boolean;
  renameValue: string;
  teamName: string;
  onTeamName: (v: string) => void;
  onStartRename: () => void;
  onRenameValue: (v: string) => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onSwitch: () => void;
  onCreateTeam: () => void;
  onClaim: (ownerId: number) => void;
  onRole: (userId: number, role: 'commissioner' | 'member') => void;
}) {
  const { league } = props;
  const accent = useAppearance().accent;
  const isCommish = league.role === 'commissioner';
  const [showQr, setShowQr] = useState(false);
  const joinLink = joinLinkFor(league.invite_code);
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        {props.renaming ? (
          <View style={[styles.row, styles.flex]}>
            <TextInput value={props.renameValue} onChangeText={props.onRenameValue} maxLength={40} autoFocus accessibilityLabel="League name" style={[styles.input, styles.flex]} />
            <Pressable onPress={props.onSaveRename} disabled={!props.renameValue.trim()} style={[styles.smallPill, { backgroundColor: accent }]}>
              <Text style={styles.smallPillDark}>{props.busy === `rename-${league.id}` ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable onPress={props.onCancelRename}>
              <Text style={styles.small}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.row, styles.flex, { flexWrap: 'wrap' }]}>
            <Text style={styles.leagueName}>{league.name}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.small}>{league.role}</Text>
            </View>
            {isCommish && (
              <Pressable onPress={props.onStartRename} hitSlop={6}>
                <Text style={styles.small}>Rename</Text>
              </Pressable>
            )}
          </View>
        )}
        {props.active ? (
          <View style={[styles.smallPill, { backgroundColor: accent }]}>
            <Text style={styles.smallPillDark}>Active</Text>
          </View>
        ) : (
          <Pressable onPress={props.onSwitch} disabled={props.busy !== null} style={styles.smallPill}>
            <Text style={styles.smallPillText}>{props.busy === `switch-${league.id}` ? 'Switching…' : 'Switch to this league'}</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Text style={styles.small}>
          Invite code: <Text style={[styles.small, { fontFamily: Fonts.mono }]}>{league.invite_code}</Text>
        </Text>
        <Pressable
          onPress={() =>
            void Share.share({ message: `Join my league "${league.name}" on The Weekend with invite code ${league.invite_code}: ${joinLink}` })
          }
          style={styles.smallPill}>
          <Text style={styles.smallPillText}>Share</Text>
        </Pressable>
        <Pressable onPress={() => setShowQr((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showQr }} style={styles.smallPill}>
          <Text style={styles.smallPillText}>{showQr ? 'Hide QR' : 'Show QR'}</Text>
        </Pressable>
      </View>

      {showQr && (
        <View style={styles.qrBlock}>
          {/* Dark on white with a quiet zone: what every scanner reads best. */}
          <View style={styles.qrCard} accessible accessibilityRole="image" accessibilityLabel={`QR code to join ${league.name}`}>
            <QRCode value={joinLink} size={200} color="#000000" backgroundColor="#ffffff" ecl="M" />
          </View>
          <Text style={[styles.small, styles.qrCaption]}>
            Have a friend scan this in Leagues → Join a league, or with their phone&apos;s camera.
          </Text>
        </View>
      )}

      {props.teams.length > 0 && (
        <View>
          {props.teams.map((t) => (
            <Text key={t.team_id} style={styles.small}>
              {t.team_name} — {t.owner_name}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.row}>
        <TextInput
          value={props.teamName}
          onChangeText={props.onTeamName}
          placeholder="Your team name"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.input, styles.flex]}
        />
        <Pressable onPress={props.onCreateTeam} disabled={props.busy !== null || !props.teamName.trim()} style={[styles.smallPill, { backgroundColor: accent }, !props.teamName.trim() && styles.dim]}>
          <Text style={styles.smallPillDark}>{props.busy === `team-${league.id}` ? 'Creating…' : 'Create my team'}</Text>
        </Pressable>
      </View>

      {isCommish && props.members.length > 0 && (
        <View style={styles.sub}>
          <Text style={styles.small}>Members</Text>
          {props.members.map((m) => (
            <View key={m.user_id} style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={styles.body}>
                {m.display_name} <Text style={styles.small}>· {m.role}</Text>
              </Text>
              {m.user_id !== props.myUserId && (
                <Pressable
                  onPress={() => props.onRole(m.user_id, m.role === 'commissioner' ? 'member' : 'commissioner')}
                  disabled={props.busy !== null}
                  style={styles.smallPill}>
                  <Text style={styles.smallPillText}>
                    {props.busy === `role-${m.user_id}` ? 'Saving…' : m.role === 'commissioner' ? 'Remove commissioner' : 'Make commissioner'}
                  </Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {props.unclaimed.length > 0 && (
        <View style={styles.sub}>
          <Text style={styles.small}>
            Already played in this league before? Claim your existing team&apos;s history — chug debts, keeper picks, past seasons, and awards
            all come with it.
          </Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {props.unclaimed.map((o) => (
              <Pressable key={o.owner_id} onPress={() => props.onClaim(o.owner_id)} disabled={props.busy !== null} style={styles.smallPill}>
                <Text style={styles.smallPillText}>{props.busy === `claim-${o.owner_id}` ? 'Claiming…' : `This is me: ${o.display_name}`}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dim: { opacity: 0.4 },
  title: { fontSize: 26 },
  soft: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20 },
  small: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 17 },
  body: { color: Colors.text, fontSize: 13 },
  error: { color: Colors.loss, fontSize: 14 },
  notice: { color: '#34d399', fontSize: 14 },
  sectionTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
  },
  primary: { borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  primaryText: { color: '#06110a', fontSize: 14, fontWeight: '600' },
  outline: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: 10, minWidth: 70, alignItems: 'center' },
  outlineText: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  block: { gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.tile, padding: Spacing.md },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  leagueName: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  rolePill: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 8, paddingVertical: 1 },
  smallPill: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 10, paddingVertical: 5 },
  smallPillText: { color: Colors.text, fontSize: 12, fontWeight: '500' },
  scanButton: { alignSelf: 'stretch' },
  qrBlock: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  qrCard: { backgroundColor: '#ffffff', padding: 16, borderRadius: Radius.md },
  qrCaption: { textAlign: 'center' },
  smallPillDark: { color: '#06110a', fontSize: 12, fontWeight: '600' },
  sub: { gap: 6, borderRadius: 8, backgroundColor: Colors.tileRaised, padding: Spacing.sm },
});
