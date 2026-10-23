import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { CommishScreen, ErrorText, errorMessage, fromLocalInput } from '@/components/commissioner/CommishUI';
import { BigButton, Chips, formatWhen, GroupTitle, PageTitle, Panel, partStyles as p, SmallButton, SwitchRow, TONES } from '@/components/commissioner/CommishParts';
import { timeAgo } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, refreshCommish, useCommishAnnouncements, useCommishLog } from '@/lib/queries';

// Commish Corner + change log (2026-10-23 overhaul, mockup 7). Write an
// announcement and post it now or schedule it; it lands in the league's
// Commish Corner chat, with a push unless you turn that off. Below,
// every change a commissioner has made, which the league can read in
// League → Activity unless you switch that off.

type When = 'now' | 'tonight' | 'morning' | 'sunday' | 'custom';

function at(when: When): Date | null {
  const d = new Date();
  if (when === 'tonight') d.setHours(20, 0, 0, 0);
  else if (when === 'morning') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else if (when === 'sunday') {
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    d.setHours(11, 0, 0, 0);
  } else return null;
  return d;
}

export default function CornerScreen() {
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Commish Corner' }} />
      <PageTitle title="Commish Corner" subtitle="Announcements go to everyone in the league." />
      <Composer />
      <Scheduled />
      <ChangeLog />
    </CommishScreen>
  );
}

function Composer() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [when, setWhen] = useState<When>('now');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function post() {
    let sendAt: string | null = null;
    if (when === 'custom') {
      const iso = fromLocalInput(custom);
      if (!iso || iso === 'invalid') {
        setError('Type the time like 2026-11-20 18:00.');
        return;
      }
      sendAt = iso;
    } else {
      sendAt = at(when)?.toISOString() ?? null;
    }
    setBusy(true);
    setError(null);
    try {
      await api.postAnnouncement(title.trim(), body.trim(), notify, sendAt);
      haptics.success();
      setDone(sendAt ? `Scheduled for ${formatWhen(sendAt)}.` : 'Posted to Commish Corner.');
      setTitle('');
      setBody('');
      setWhen('now');
      await Promise.all([refreshCommish(), queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })]);
    } catch (e) {
      haptics.error();
      setError(errorMessage(e, "Couldn't post that."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel color={TONES.yellow}>
      <View style={styles.composer}>
        <View style={styles.field}>
          <Text style={p.sub}>Headline</Text>
          <TextInput value={title} onChangeText={setTitle} maxLength={200} placeholder="Trade deadline moved to Nov 20" placeholderTextColor="rgba(255,255,255,0.35)" style={p.input} />
        </View>
        <View style={styles.field}>
          <Text style={p.sub}>Message</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            placeholder="What does the league need to know?"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[p.input, styles.body]}
          />
        </View>
        <Text style={p.label}>When</Text>
        <Chips<When>
          options={[
            { value: 'now', label: 'Now' },
            { value: 'tonight', label: 'Tonight 8 PM' },
            { value: 'morning', label: 'Tomorrow 9 AM' },
            { value: 'sunday', label: 'Sunday 11 AM' },
            { value: 'custom', label: 'Pick a time' },
          ]}
          value={when}
          onChange={setWhen}
        />
        {when === 'custom' ? (
          <TextInput value={custom} onChangeText={setCustom} placeholder="2026-11-20 18:00" placeholderTextColor="rgba(255,255,255,0.35)" autoCorrect={false} style={p.input} />
        ) : null}
      </View>
      <SwitchRow title="Send a notification" sub="To everyone with notifications on" value={notify} onChange={setNotify} />
      <View style={styles.composerFoot}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {done ? <Text style={styles.done}>{done}</Text> : null}
        <BigButton
          label={when === 'now' ? 'Post now' : 'Schedule'}
          busyLabel={when === 'now' ? 'Posting…' : 'Scheduling…'}
          busy={busy}
          disabled={!title.trim() || !body.trim()}
          onPress={() => void post()}
        />
      </View>
    </Panel>
  );
}

function Scheduled() {
  const q = useCommishAnnouncements();
  const [busyId, setBusyId] = useState<number | null>(null);
  const data = q.data;
  if (!data || (data.scheduled.length === 0 && data.recent.length === 0)) return null;

  async function cancel(id: number) {
    setBusyId(id);
    try {
      await api.cancelAnnouncement(id);
      haptics.success();
      await refreshCommish();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.section}>
      {data.scheduled.length ? (
        <>
          <GroupTitle title="Scheduled" color={TONES.blue} />
          <Panel>
            {data.scheduled.map((s, i) => (
              <View key={s.id} style={[styles.row, i > 0 && p.divided]}>
                <View style={p.flex}>
                  <Text style={styles.rowTitle}>{s.title}</Text>
                  <Text style={p.sub}>{formatWhen(s.send_at)}</Text>
                </View>
                <SmallButton label={busyId === s.id ? 'Cancelling…' : 'Cancel'} color="#f87171" disabled={busyId === s.id} onPress={() => void cancel(s.id)} />
              </View>
            ))}
          </Panel>
        </>
      ) : null}
      {data.recent.length ? (
        <>
          <GroupTitle title="Recent posts" color={TONES.yellow} right={data.conversation_id ? 'Open in chat ›' : undefined} />
          <Panel>
            {data.recent.slice(0, 5).map((r, i) => (
              <View key={r.id} style={[styles.row, i > 0 && p.divided]}>
                <View style={p.flex}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={p.sub}>{timeAgo(r.created_at)}</Text>
                </View>
                {data.conversation_id ? (
                  <SmallButton label="Who read it" onPress={() => router.push(`/chat/${data.conversation_id}` as Href)} />
                ) : null}
              </View>
            ))}
          </Panel>
        </>
      ) : null}
    </View>
  );
}

const AREA_COLORS: Record<string, string> = {
  trades: TONES.orange,
  scoring: '#4ade80',
  lineups: TONES.purple,
  waivers: '#2dd4bf',
  members: TONES.purple,
  teams: TONES.purple,
  announcements: TONES.yellow,
  draft: '#eab308',
  keepers: '#10b981',
  playoffs: TONES.blue,
  league: TONES.blue,
};

function ChangeLog() {
  const q = useCommishLog();
  const [busy, setBusy] = useState(false);
  const data = q.data;

  async function toggle(isPublic: boolean) {
    setBusy(true);
    try {
      await api.setCommishLogPublic(isPublic);
      await refreshCommish();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <GroupTitle title="Change log" color="#8790a0" right={data ? (data.public ? 'The league can see this' : 'Only commissioners') : undefined} />
      {!data ? (
        q.isPending ? <LoadingState /> : <ErrorText>{errorMessage(q.error, "Couldn't load the change log.")}</ErrorText>
      ) : (
        <>
          <Panel>
            <SwitchRow first title="Let the league see this" sub="Shows in League → Activity" value={data.public} onChange={(v) => !busy && void toggle(v)} />
          </Panel>
          {data.changes.length === 0 ? (
            <Text style={p.sub}>Nothing yet. Every change a commissioner makes from now on shows up here.</Text>
          ) : (
            <View>
              {data.changes.map((c) => (
                <View key={c.id} style={styles.change}>
                  <View style={[styles.dot, { backgroundColor: AREA_COLORS[c.area] ?? '#8790a0' }]} />
                  <View style={p.flex}>
                    <Text style={styles.changeText}>{c.summary}</Text>
                    <Text style={p.sub}>
                      {c.actor_name} · {timeAgo(c.created_at)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { padding: 14, gap: Spacing.md },
  composerFoot: { padding: 14, gap: Spacing.sm },
  field: { gap: 4 },
  body: { minHeight: 96, paddingTop: 10, textAlignVertical: 'top' },
  done: { color: '#34d399', fontSize: 14 },
  section: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: 14, paddingVertical: 10 },
  rowTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  change: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  changeText: { color: Colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
});
