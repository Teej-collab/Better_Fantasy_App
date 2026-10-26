import { router, Stack, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Display, Text } from '@/components/Text';
import { TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { queryClient, useFriends, useMyUsername, usePlayedWith } from '@/lib/queries';
import type { FriendPerson, FriendRelationship } from '@/lib/types';

// Friends (2026-10-26): people you know from any league, or none. Find
// them by @username or from the leagues you've played in, then invite
// them to a private Lounge (app/lounge-private.tsx) — they get in
// without the password. Nothing here changes a league.

function refresh() {
  for (const key of ['friends', 'played-with', 'friend-search']) void queryClient.invalidateQueries({ queryKey: [key] });
}

function subline(p: FriendPerson): string {
  const parts: string[] = [];
  if (p.username) parts.push(`@${p.username}`);
  if (p.shared_leagues?.length) parts.push(p.shared_leagues.join(', '));
  return parts.join(' · ');
}

export default function FriendsScreen() {
  const accent = useAppearance().accent;
  const friends = useFriends();
  const playedWith = usePlayedWith();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ term: string; people: FriendPerson[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search as you type, a beat after the last keystroke.
  const term = q.trim().replace(/^@/, '');
  useEffect(() => {
    if (term.length < 2) return;
    const t = setTimeout(() => {
      api
        .searchFriends(term)
        .then((people) => setFound({ term, people }))
        .catch(() => setFound({ term, people: [] }));
    }, 300);
    return () => clearTimeout(t);
  }, [term]);
  const results = term.length >= 2 && found?.term === term ? found.people : null;

  async function act(userId: number, run: () => Promise<unknown>, after?: (r: unknown) => void) {
    if (busy !== null) return;
    haptics.tap();
    setBusy(userId);
    setError(null);
    try {
      const r = await run();
      after?.(r);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  function add(userId: number) {
    void act(
      userId,
      () => api.sendFriendRequest(userId),
      (r) => {
        const rel = (r as { relationship: FriendRelationship }).relationship;
        setFound((cur) => cur && { ...cur, people: cur.people.map((p) => (p.user_id === userId ? { ...p, relationship: rel } : p)) });
      },
    );
  }

  function confirmRemove(p: FriendPerson) {
    Alert.alert(`Remove ${p.name}?`, 'They won’t be told. Any Lounge invites between you go away too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void act(p.user_id, () => api.removeFriend(p.user_id)) },
    ]);
  }

  const data = friends.data;
  const people = playedWith.data ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'Friends' }} />
      <UsernameCard />

      <View style={styles.gap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Find someone by @username"
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Find someone by username"
        />
        {results !== null &&
          (results.length === 0 ? (
            <Text style={styles.muted}>Nobody with that username yet.</Text>
          ) : (
            results.map((p) => (
              <PersonRow key={p.user_id} person={p}>
                {p.relationship === 'friends' ? (
                  <Text style={styles.muted}>Friends</Text>
                ) : p.relationship === 'outgoing' ? (
                  <Text style={styles.muted}>Asked</Text>
                ) : (
                  <SmallBtn label={p.relationship === 'incoming' ? 'Accept' : 'Add'} accent={accent} busy={busy === p.user_id} onPress={() => add(p.user_id)} />
                )}
              </PersonRow>
            ))
          ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {!!data?.incoming.length && (
        <Section title="Friend requests">
          {data.incoming.map((p) => (
            <PersonRow key={p.user_id} person={p}>
              <SmallBtn label="Accept" accent={accent} busy={busy === p.user_id} onPress={() => void act(p.user_id, () => api.acceptFriend(p.user_id))} />
              <SmallBtn label="Decline" busy={false} onPress={() => void act(p.user_id, () => api.removeFriend(p.user_id))} />
            </PersonRow>
          ))}
        </Section>
      )}

      <Section title={data?.friends.length ? `Friends · ${data.friends.length}` : 'Friends'}>
        {friends.isLoading ? (
          <ActivityIndicator color={accent} />
        ) : data?.friends.length ? (
          <>
            {data.friends.map((p) => (
              <PersonRow key={p.user_id} person={p} onLongPress={() => confirmRemove(p)}>
                <Pressable onPress={() => confirmRemove(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
                  <Text style={styles.more}>•••</Text>
                </Pressable>
              </PersonRow>
            ))}
            <Pressable onPress={() => router.push('/lounge-private' as Href)} style={[styles.cta, { backgroundColor: accent }]} accessibilityRole="button">
              <Text style={styles.ctaText}>Start a Lounge with friends</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.muted}>No friends yet. Add people from your leagues below, or search by username.</Text>
        )}
      </Section>

      {!!data?.outgoing.length && (
        <Section title="Waiting on them">
          {data.outgoing.map((p) => (
            <PersonRow key={p.user_id} person={p}>
              <SmallBtn label="Cancel" busy={busy === p.user_id} onPress={() => void act(p.user_id, () => api.removeFriend(p.user_id))} />
            </PersonRow>
          ))}
        </Section>
      )}

      {people.length > 0 && (
        <Section title="People you've played with">
          {people.map((p) => (
            <PersonRow key={p.user_id} person={p}>
              <SmallBtn label="Add" accent={accent} busy={busy === p.user_id} onPress={() => add(p.user_id)} />
            </PersonRow>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

/** Pick or change your @username — how people outside your leagues find you. */
function UsernameCard() {
  const accent = useAppearance().accent;
  const mine = useMyUsername();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = mine.data ?? null;

  if (mine.isLoading) return null;
  if (current && !editing) {
    return (
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text style={styles.muted}>Your username</Text>
          <Text style={styles.handle}>@{current}</Text>
        </View>
        <SmallBtn
          label="Change"
          busy={false}
          onPress={() => {
            setValue(current);
            setEditing(true);
          }}
        />
      </View>
    );
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.setUsername(value);
      queryClient.setQueryData(['my-username'], r.username);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <Display style={styles.cardTitle}>{current ? 'Change your username' : 'Pick a username'}</Display>
      <Text style={styles.muted}>So friends outside your leagues can find you. Letters, numbers, _ and . only.</Text>
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="@username"
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={21}
          style={[styles.input, { flex: 1 }]}
          onSubmitEditing={() => void save()}
          accessibilityLabel="Username"
        />
        <SmallBtn label={saving ? '…' : 'Save'} accent={accent} busy={saving} onPress={() => void save()} />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.gap}>
      <Text style={styles.section}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function PersonRow({ person, children, onLongPress }: { person: FriendPerson; children?: React.ReactNode; onLongPress?: () => void }) {
  const sub = subline(person);
  return (
    <Pressable onLongPress={onLongPress} style={styles.person} accessible={false}>
      <TeamAvatar name={person.name} logoUrl={person.photo_url} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {person.name}
        </Text>
        {!!sub && (
          <Text style={styles.muted} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {children}
    </Pressable>
  );
}

function SmallBtn({ label, onPress, busy, accent }: { label: string; onPress: () => void; busy: boolean; accent?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[styles.btn, accent ? { backgroundColor: accent, borderColor: accent } : null, busy && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Text style={[styles.btnText, accent ? { color: '#06110a' } : null]}>{busy ? '…' : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  gap: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: Spacing.lg },
  cardTitle: { fontSize: 18, textTransform: 'none', letterSpacing: 0 },
  handle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  input: { backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', color: Colors.text, fontSize: 15, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  section: { color: '#9aa3b2', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  muted: { color: '#9aa3b2', fontSize: 12 },
  more: { color: '#9aa3b2', fontSize: 16, paddingHorizontal: 4 },
  error: { color: Colors.loss, fontSize: 14 },
  btn: { height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: Colors.text, fontSize: 12, fontWeight: '800' },
  cta: { height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  ctaText: { color: '#06110a', fontSize: 14, fontWeight: '800' },
});
