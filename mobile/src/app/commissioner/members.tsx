import { Image } from 'expo-image';
import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, TextInput, View } from 'react-native';

import { CommishScreen, ErrorText, errorMessage, Picker } from '@/components/commissioner/CommishUI';
import { BigButton, PageTitle, Panel, partStyles as p, SmallButton, TONES } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { timeAgo } from '@/components/admin/AdminUI';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { joinLinkFor } from '@/lib/qrJoin';
import { refreshCommish, useCommishMembers } from '@/lib/queries';
import type { CommishMember } from '@/lib/types';

// Members & teams (2026-10-23 overhaul, mockup 4): the old Members and
// Teams screens in one. Each member shows their team, record, role and
// when they were last around (someone gone 10+ days stands out). Tap a
// member for what you can do: make them co-commissioner, give their
// team to someone else (or make them one), fix their lineup, remove
// them.

const QUIET_DAYS = 10;
function isQuiet(lastActiveAt: string | null): boolean {
  return !lastActiveAt || Date.now() - new Date(lastActiveAt).getTime() > QUIET_DAYS * 86_400_000;
}

const AVATAR_COLORS = ['#39ff14', '#38bdf8', '#f472b6', '#facc15', '#a855f7', '#fb923c', '#2dd4bf', '#f87171'];

export default function MembersScreen() {
  const q = useCommishMembers();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const data = q.data;
  const term = search.trim().toLowerCase();
  const members = (data?.members ?? []).filter(
    (m) => !term || m.display_name.toLowerCase().includes(term) || (m.team?.team_name ?? '').toLowerCase().includes(term),
  );

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Members & Teams' }} />
      <PageTitle title="Members & teams" />
      {!data ? (
        q.isPending ? <LoadingState /> : <ErrorText>{errorMessage(q.error, "Couldn't load your members.")}</ErrorText>
      ) : (
        <>
          <Panel>
            <View style={styles.invite}>
              <View style={p.flex}>
                <Text style={p.sub}>Invite code</Text>
                <Text style={styles.code}>{data.invite_code}</Text>
              </View>
              <BigButton
                label="Share invite"
                onPress={() => void Share.share({ message: `Join my league on The Weekend — code ${data.invite_code}: ${joinLinkFor(data.invite_code)}` })}
              />
            </View>
          </Panel>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Find a member or team"
            placeholderTextColor="rgba(255,255,255,0.4)"
            accessibilityLabel="Find a member or team"
            autoCorrect={false}
            style={p.input}
          />
          <View style={styles.list}>
            {members.map((m, i) => (
              <MemberCard
                key={m.user_id}
                member={m}
                color={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                isMe={m.user_id === data.me}
                open={open === m.user_id}
                onToggle={() => {
                  haptics.select();
                  setOpen(open === m.user_id ? null : m.user_id);
                }}
                leagueId={data.league_id}
                everyone={data.members}
              />
            ))}
          </View>
        </>
      )}
    </CommishScreen>
  );
}

function MemberCard({ member: m, color, isMe, open, onToggle, leagueId, everyone }: {
  member: CommishMember;
  color: string;
  isMe: boolean;
  open: boolean;
  onToggle: () => void;
  leagueId: number;
  everyone: CommishMember[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [giveTo, setGiveTo] = useState<number | null>(null);
  const [teamName, setTeamName] = useState('');
  const quiet = !!m.team && isQuiet(m.last_active_at);
  const record = m.team ? `${m.team.wins}–${m.team.losses}${m.team.ties ? `–${m.team.ties}` : ''}` : null;

  async function run(label: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      haptics.success();
      await refreshCommish();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.card, quiet && { borderColor: `${TONES.orange}66` }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.cardHead}>
        {m.photo_url ? (
          <Image source={{ uri: m.photo_url }} style={styles.avatar} contentFit="cover" transition={150} accessible={false} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.initial}>{m.display_name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={p.flex}>
          <Text style={styles.name} numberOfLines={1}>
            {m.display_name}
            {isMe ? <Text style={p.sub}> (you)</Text> : null}
            {m.role === 'commissioner' ? <Text style={styles.role}>  {isMe ? 'COMMISH' : 'CO-COMMISH'}</Text> : null}
          </Text>
          <Text style={[p.sub, !m.team && { color: TONES.purple }]} numberOfLines={1}>
            {m.team ? `${m.team.team_name} · ${record}` : 'No team yet'}
          </Text>
        </View>
        <Text style={[styles.seen, quiet && { color: TONES.orange }]}>{m.last_active_at ? timeAgo(m.last_active_at) : 'never'}</Text>
      </Pressable>

      {open && !isMe ? (
        <View style={styles.actions}>
          <View style={styles.actionRow}>
            <SmallButton
              label={m.role === 'commissioner' ? 'Make regular member' : 'Make co-commish'}
              disabled={!!busy}
              onPress={() =>
                void run('role', () => api.setMemberRole(leagueId, m.user_id, m.role === 'commissioner' ? 'member' : 'commissioner'), "Couldn't change their role.")
              }
            />
            {m.team ? (
              <SmallButton label="Fix their lineup" onPress={() => router.push(`/commissioner/lineup?team=${m.team!.team_id}` as Href)} />
            ) : null}
          </View>
          {m.team ? (
            <View style={styles.actionRow}>
              <Picker
                value={giveTo}
                placeholder="Give their team to…"
                options={everyone.filter((o) => o.user_id !== m.user_id && !o.team).map((o) => ({ value: o.user_id, label: o.display_name }))}
                onChange={setGiveTo}
              />
              {giveTo !== null ? (
                <SmallButton
                  label={busy === 'give' ? 'Giving…' : 'Give team'}
                  disabled={!!busy}
                  onPress={() => void run('give', () => api.reassignTeam(leagueId, m.team!.team_id, giveTo), "Couldn't give that team away.")}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.actionRow}>
              <TextInput
                value={teamName}
                onChangeText={setTeamName}
                placeholder="Team name"
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={[p.input, p.flex]}
              />
              <SmallButton
                label={busy === 'team' ? 'Making…' : 'Make their team'}
                disabled={!!busy || !teamName.trim()}
                onPress={() => void run('team', () => api.createTeamForMember(leagueId, m.user_id, teamName.trim()), "Couldn't make their team.")}
              />
            </View>
          )}
          {confirmRemove ? (
            <View style={styles.confirm}>
              <Text style={p.sub}>Remove {m.display_name}? They lose access to the league. Their team and history stay.</Text>
              <View style={styles.actionRow}>
                <SmallButton
                  label={busy === 'remove' ? 'Removing…' : 'Yes, remove'}
                  color="#f87171"
                  disabled={!!busy}
                  onPress={() => void run('remove', () => api.removeMember(leagueId, m.user_id), "Couldn't remove them.")}
                />
                <SmallButton label="Cancel" color="#8790a0" onPress={() => setConfirmRemove(false)} />
              </View>
            </View>
          ) : (
            <SmallButton label="Remove from league…" color="#f87171" onPress={() => setConfirmRemove(true)} />
          )}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  invite: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 14 },
  code: { fontFamily: Fonts.display, fontSize: 22, letterSpacing: 2, color: Colors.text },
  list: { gap: Spacing.sm },
  card: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 12, gap: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#0d1016', fontWeight: '800', fontSize: 16 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  role: { color: '#a78bfa', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  seen: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  actions: { gap: Spacing.sm },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  confirm: { gap: Spacing.sm, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', padding: 10 },
});
