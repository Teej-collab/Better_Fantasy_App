import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommishScreen, ErrorText, errorMessage, fromLocalInput, toLocalInput } from '@/components/commissioner/CommishUI';
import { BigButton, Chips, formatWhen, PageTitle, partStyles as p, relative, SwitchRow, TONES } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { queryClient, refreshCommish, useCommishCalendar, useTradeSettings } from '@/lib/queries';
import type { CalendarItem, CommishCalendar, TradeSettings } from '@/lib/types';

// Season calendar (2026-10-23 overhaul, mockup 2): every date the league
// runs on, on one timeline. The trade deadline is changed right here
// with quick picks ("Before Week 12") instead of typing a date; the
// others open the tool that owns them.

const OPENS: Partial<Record<CalendarItem['key'], Href>> = {
  keeper_deadline: '/commissioner/roster',
  next_keeper_deadline: '/commissioner/roster',
  waivers: '/commissioner/waivers' as Href,
  playoffs_start: '/commissioner/league',
  draft: '/draft',
};

export default function CalendarScreen() {
  const q = useCommishCalendar();
  const trade = useTradeSettings();
  const [editing, setEditing] = useState(false);
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Season Calendar' }} />
      <PageTitle title="Season calendar" subtitle="Every date your league runs on. Tap one to change it." />
      {!q.data ? (
        q.isPending ? <LoadingState /> : <ErrorText>{errorMessage(q.error, "Couldn't load your calendar.")}</ErrorText>
      ) : (
        <>
          <Timeline
            items={q.data.items}
            onOpen={(item) => {
              haptics.select();
              if (item.key === 'trade_deadline') setEditing(true);
              else if (OPENS[item.key]) router.push(OPENS[item.key]!);
            }}
          />
          {trade.data ? <DeadlineSheet key={trade.data.trade_deadline ?? 'none'} open={editing} onClose={() => setEditing(false)} calendar={q.data} settings={trade.data} /> : null}
        </>
      )}
    </CommishScreen>
  );
}

function Timeline({ items, onOpen }: { items: CalendarItem[]; onOpen: (item: CalendarItem) => void }) {
  const accent = useAppearance().accent;
  return (
    <View>
      {items.map((item, i) => {
        const highlight = item.key === 'trade_deadline' && !item.past;
        const color = item.past ? '#5b6372' : highlight ? accent : !item.at && item.editable ? TONES.yellow : Colors.textSecondary;
        const when = item.repeats ?? (item.at ? formatWhen(item.at) : item.week ? `Week ${item.week}` : 'Not set');
        const tag = item.past ? 'Done' : item.repeats ? 'Weekly' : item.at ? relative(item.at) : item.editable ? 'Set' : '';
        const tappable = item.key === 'trade_deadline' || !!OPENS[item.key];
        return (
          <View key={item.key} style={styles.step}>
            <View style={styles.rail}>
              <View style={[styles.node, { borderColor: color }, item.past && { backgroundColor: color }]} />
              {i < items.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <Pressable
              onPress={() => onOpen(item)}
              disabled={!tappable}
              accessibilityRole={tappable ? 'button' : undefined}
              style={({ pressed }) => [styles.item, highlight && { borderColor: `${accent}66` }, item.past && styles.past, pressed && styles.pressed]}>
              <View style={p.flex}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={p.sub}>
                  {when}
                  {item.week && item.at && !item.repeats ? ` · Week ${item.week}` : ''}
                  {item.detail ? ` · ${item.detail}` : ''}
                </Text>
              </View>
              <Text style={[styles.tag, { color }]}>{tag}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// The next few regular-season weeks that haven't kicked off yet.
function upcomingWeeks(calendar: CommishCalendar): { week: number; at: string }[] {
  const now = Date.now();
  const lastRegular = calendar.items.find((i) => i.key === 'regular_season_end')?.week ?? 14;
  return Object.entries(calendar.week_kickoffs)
    .map(([w, at]) => ({ week: Number(w), at }))
    .filter((k) => new Date(k.at).getTime() > now && k.week <= lastRegular)
    .slice(0, 6);
}

function DeadlineSheet({ open, onClose, calendar, settings }: { open: boolean; onClose: () => void; calendar: CommishCalendar; settings: TradeSettings }) {
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<string | null>(settings.trade_deadline);
  const [custom, setCustom] = useState(toLocalInput(settings.trade_deadline));
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = [
    ...upcomingWeeks(calendar).map((k) => ({ value: k.at, label: `Before Week ${k.week}` })),
    { value: 'none', label: 'No deadline' },
  ];

  async function save() {
    const chosen = pick === 'none' ? null : pick;
    const typed = fromLocalInput(custom);
    if (typed === 'invalid') {
      setError('Type it like 2026-11-20 18:00, or pick one above.');
      return;
    }
    const deadline = typed !== toLocalInput(chosen) && typed ? typed : chosen;
    setBusy(true);
    setError(null);
    try {
      await api.updateTradeSettings(settings.season, deadline, {
        mode: settings.review_mode ?? (settings.review_required ? 'approval' : 'none'),
        hours: settings.review_hours,
        vetoVotesNeeded: settings.veto_votes_needed,
      });
      if (tell) {
        await api.postAnnouncement(
          deadline ? `Trade deadline: ${formatWhen(deadline)}` : 'No trade deadline this season',
          deadline ? `Trades have to be proposed and accepted by ${formatWhen(deadline)}.` : 'Trades are open all season.',
          true,
          null,
        );
      }
      haptics.success();
      await Promise.all([refreshCommish(), queryClient.invalidateQueries({ queryKey: ['trade-settings'] })]);
      onClose();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e, "Couldn't save the deadline."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Trade deadline</Text>
          <Text style={p.sub}>No trades can be proposed or accepted after this.</Text>
          <Chips
            options={options}
            value={pick ?? 'none'}
            onChange={(v) => {
              setPick(v);
              setCustom(v === 'none' ? '' : toLocalInput(v));
            }}
          />
          <Text style={p.label}>Or a date and time</Text>
          <TextInput value={custom} onChangeText={setCustom} placeholder="2026-11-20 18:00" placeholderTextColor="rgba(255,255,255,0.4)" autoCorrect={false} style={p.input} />
          <SwitchRow first title="Tell the league in Commish Corner" value={tell} onChange={setTell} />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <BigButton label="Save deadline" busyLabel="Saving…" busy={busy} onPress={() => void save()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 14 },
  rail: { width: 14, alignItems: 'center' },
  node: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 24 },
  line: { flex: 1, width: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: 5, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  past: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  tag: { fontSize: 12, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#171b22', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: Spacing.lg, gap: Spacing.md },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#3a404a' },
  sheetTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' },
});
