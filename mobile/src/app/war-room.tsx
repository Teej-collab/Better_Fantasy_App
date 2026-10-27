import { router, Stack, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Display, Text } from '@/components/Text';
import { Card, LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { positionColor } from '@/lib/positionColors';
import { useWarRoom } from '@/lib/queries';
import type { WarRoomDraft, WarRoomHeadline, WarRoomKeepers, WarRoomPhase, WarRoomReportCard } from '@/lib/types';

// The War Room (2026-10-27): My Team's Draft and Keepers as one
// screen, same as the web's /war-room. It opens on whatever the
// calendar says (the backend's `phase`); the other tabs stay one tap
// away. Picking keepers and the live draft room stay their own screens.

const PHASES: { key: WarRoomPhase; label: string }[] = [
  { key: 'keepers', label: 'Keepers' },
  { key: 'draft', label: 'Draft' },
  { key: 'report_card', label: 'Report Card' },
];

const AMBER = '#f59e0b';
const RED = '#f87171';

function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Now';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

export default function WarRoomScreen() {
  const q = useWarRoom();
  const [picked, setPicked] = useState<WarRoomPhase | null>(null);
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load the War Room." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const data = q.data;
  const phase = picked ?? data.phase;
  const tabs = PHASES.filter((p) => p.key !== 'keepers' || data.keepers);
  const done: Record<WarRoomPhase, boolean> = {
    keepers: Boolean(data.keepers?.locked),
    draft: data.draft.status === 'complete',
    report_card: false,
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'War Room' }} />
      <Display style={styles.title}>War Room</Display>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = phase === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                haptics.select();
                setPicked(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.tab, on && styles.tabOn]}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>
                {t.label}
                {done[t.key] && !on ? ' ✓' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {phase === 'keepers' && data.keepers && <KeepersTab keepers={data.keepers} />}
      {phase === 'draft' && <DraftTab draft={data.draft} />}
      {phase === 'report_card' &&
        (data.report_card ? (
          <ReportCardTab card={data.report_card} />
        ) : (
          <Section>
            <Text style={styles.muted}>Your report card shows up here once the draft is done.</Text>
          </Section>
        ))}
    </ScrollView>
  );
}

function Section({ title, aside, children, highlight }: { title?: string; aside?: ReactNode; children: ReactNode; highlight?: boolean }) {
  return (
    <Card color={highlight ? Colors.accent : undefined} style={styles.card}>
      {(title || aside) && (
        <View style={styles.cardHead}>
          {title ? <Text style={styles.eyebrow}>{title}</Text> : <View />}
          {aside}
        </View>
      )}
      {children}
    </Card>
  );
}

function Pos({ position }: { position: string | null }) {
  const color = positionColor(position);
  return (
    <View style={[styles.pos, { backgroundColor: `${color}2e` }]}>
      <Text style={[styles.posText, { color }]}>{position ?? '—'}</Text>
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: `${color}26` }]}>
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

function Button({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, primary && styles.buttonPrimary, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function KeepersTab({ keepers }: { keepers: WarRoomKeepers }) {
  useMinuteTick();
  const [nudge, setNudge] = useState<string | null>(null);
  const me = keepers.managers.find((m) => m.is_me);
  const myCount = me?.count ?? 0;

  async function sendNudge() {
    try {
      const { nudged } = await api.nudgeKeepers();
      haptics.success();
      setNudge(`Nudged ${nudged} manager${nudged === 1 ? '' : 's'}.`);
    } catch (e) {
      setNudge(e instanceof Error ? e.message : "Couldn't send the nudge");
    }
  }

  return (
    <>
      {keepers.is_open && (
        <Section highlight title={keepers.deadline ? 'Keepers lock in' : 'Keepers are open'}>
          {keepers.deadline && <Text style={styles.big}>{countdown(keepers.deadline)}</Text>}
          <Text style={styles.muted}>
            {keepers.deadline
              ? `${when(keepers.deadline)}. Then everyone's keepers are revealed at once.`
              : "Your commissioner hasn't set a deadline yet."}
          </Text>
          {me && (
            <View style={styles.progressBlock}>
              <View style={styles.rowBetween}>
                <Text style={styles.strong}>
                  {myCount} of {keepers.max_keepers} keepers picked
                </Text>
                {keepers.max_consecutive_years ? <Text style={styles.small}>Up to {keepers.max_consecutive_years} yrs each</Text> : null}
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, (myCount / keepers.max_keepers) * 100)}%` }]} />
              </View>
            </View>
          )}
        </Section>
      )}

      <Section title="Your keepers">
        {me?.players && me.players.length > 0 ? (
          me.players.map((name) => (
            <Text key={name} style={styles.name}>
              {name}
            </Text>
          ))
        ) : (
          <Text style={styles.muted}>None picked yet.</Text>
        )}
        <Button label={keepers.is_open ? 'Pick your keepers' : 'See your keepers'} primary={keepers.is_open} onPress={() => router.push('/keepers')} />
      </Section>

      <Section title="League keeper board" aside={<Text style={styles.small}>{keepers.locked ? 'Locked' : 'Hidden until lock'}</Text>}>
        {!keepers.locked && <Text style={styles.muted}>See who&apos;s done without seeing who they kept.</Text>}
        {keepers.managers.map((m) => (
          <View key={m.owner_id} style={styles.tile}>
            <View style={styles.rowBetween}>
              <Text style={styles.strong}>{m.name}</Text>
              <Text style={[styles.count, { color: m.done ? Colors.accent : m.count > 0 ? AMBER : RED }]}>
                {m.count}/{keepers.max_keepers}
                {m.done ? ' ✓' : ''}
              </Text>
            </View>
            {m.players && m.players.length > 0 && !m.is_me ? <Text style={styles.small}>{m.players.join(' · ')}</Text> : null}
          </View>
        ))}
        {keepers.is_open && keepers.waiting_on > 0 && (
          <Button label={`Nudge the ${keepers.waiting_on} who aren't done`} onPress={() => void sendNudge()} />
        )}
        {nudge && (
          <Text style={styles.muted} accessibilityLiveRegion="polite">
            {nudge}
          </Text>
        )}
      </Section>
    </>
  );
}

function DraftTab({ draft }: { draft: WarRoomDraft }) {
  useMinuteTick();
  const live = draft.status === 'in_progress' || draft.status === 'paused';
  const over = draft.status === 'complete';
  const facts = [
    draft.draft_type ? draft.draft_type[0].toUpperCase() + draft.draft_type.slice(1) : null,
    draft.team_count ? `${draft.team_count} teams` : null,
    draft.rounds ? `${draft.rounds} rounds` : null,
    draft.pick_seconds ? `${draft.pick_seconds}s per pick` : null,
  ].filter(Boolean);

  return (
    <>
      <Section highlight title={live ? 'The draft is live' : over ? "Draft's done" : 'Draft starts in'}>
        {!live && !over && <Text style={styles.big}>{draft.scheduled_start ? countdown(draft.scheduled_start) : 'Not set yet'}</Text>}
        {!live && !over && draft.scheduled_start && <Text style={styles.muted}>{when(draft.scheduled_start)}</Text>}
        {facts.length > 0 && <Text style={styles.eyebrow}>{facts.join(' · ')}</Text>}
        <Button label={over ? 'See the full draft board' : 'Enter the draft room'} primary onPress={() => router.push('/draft')} />
      </Section>

      {draft.my_picks.length > 0 && (
        <Section title={draft.my_slot ? `Your picks · slot ${draft.my_slot}` : 'Your picks'}>
          <View style={styles.picks}>
            {draft.my_picks.map((p) => {
              const next = p.pick_number === draft.next_pick;
              return (
                <View key={p.pick_number} style={[styles.pick, next && styles.pickNext]} accessibilityLabel={p.is_keeper ? `Round ${p.round}, used on a keeper` : `Pick ${p.round}.${p.round_pick}`}>
                  <Text style={[styles.pickText, next && styles.pickTextNext, p.is_keeper && styles.pickKeeper]}>
                    {p.round}.{String(p.round_pick).padStart(2, '0')}
                  </Text>
                </View>
              );
            })}
          </View>
          {draft.my_picks.some((p) => p.is_keeper) && <Text style={styles.small}>Struck-through rounds went to keepers.</Text>}
          {draft.next_pick ? <Text style={styles.muted}>Your next pick is #{draft.next_pick} overall.</Text> : null}
        </Section>
      )}

      {draft.likely_available.length > 0 && draft.next_pick ? (
        <Section title={`Likely still there at #${draft.next_pick}`}>
          {draft.likely_available.map((p) => (
            <View key={p.sleeper_player_id} style={styles.row}>
              <Pos position={p.position} />
              <View style={styles.flex}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={styles.small}>
                  {p.team ? `${p.team} · ` : ''}ADP {p.adp}
                </Text>
              </View>
              <Text style={[styles.count, { color: p.chance >= 0.6 ? Colors.accent : AMBER }]}>{Math.round(p.chance * 100)}%</Text>
            </View>
          ))}
          <Text style={styles.small}>The chance he&apos;s still on the board, from market ADP and the picks ahead of you.</Text>
        </Section>
      ) : null}

      {!over && (
        <Section title="Your queue">
          {draft.queue.length === 0 ? (
            <Text style={styles.muted}>Nobody queued yet. Build it in the draft room.</Text>
          ) : (
            draft.queue.map((p, i) => (
              <View key={p.sleeper_player_id} style={styles.row}>
                <Text style={styles.rank}>{i + 1}</Text>
                <Pos position={p.position} />
                <Text style={[styles.name, styles.flex]}>{p.name}</Text>
                {p.adp !== null ? <Text style={styles.small}>ADP {p.adp}</Text> : null}
              </View>
            ))
          )}
          <Text style={styles.small}>Miss your pick and autopick takes the top of your queue, then the best ADP left.</Text>
        </Section>
      )}

      {draft.keepers_off_board.length > 0 && (
        <Section title="Already off the board">
          {draft.keepers_off_board.map((k) => (
            <View key={k.owner_id} style={styles.tile}>
              <Text style={styles.strong}>{k.name}</Text>
              <Text style={styles.small}>{k.players.join(' · ')}</Text>
            </View>
          ))}
        </Section>
      )}

      {draft.order.length > 0 && (
        <Section title="Draft order">
          <Text style={styles.muted}>{draft.order.map((o, i) => `${i + 1}. ${o.name}`).join('   ')}</Text>
        </Section>
      )}
    </>
  );
}

const STATUS: Record<string, { label: string; color: string }> = {
  starter: { label: 'STARTER', color: Colors.win },
  bench: { label: 'BENCH', color: Colors.textSecondary },
  ir: { label: 'IR', color: RED },
  gone: { label: 'GONE', color: Colors.textSecondary },
};

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Headline({ label, h, color }: { label: string; h: WarRoomHeadline; color: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.eyebrow, { color }]}>{label}</Text>
      <Text style={styles.strong}>
        {h.owner_name} · Rd {h.round} · {h.player_name}
      </Text>
      <Text style={styles.small}>
        {h.position && h.position_rank ? `${h.position}${h.position_rank} so far · ` : ''}
        {h.points} pts
      </Text>
    </View>
  );
}

function ReportCardTab({ card }: { card: WarRoomReportCard }) {
  const [showAll, setShowAll] = useState(false);
  const picks = showAll ? card.picks : card.picks.slice(0, 8);
  const moved = card.hindsight && card.draft_day.rank ? card.draft_day.rank - card.hindsight.rank : 0;

  return (
    <>
      <Section highlight>
        <View style={styles.gradeRow}>
          <View style={styles.grade}>
            <Text style={styles.eyebrow}>Draft day</Text>
            <Text style={[styles.letter, { color: Colors.textSecondary }]}>{card.draft_day.letter ?? '—'}</Text>
          </View>
          {card.hindsight && (
            <View style={styles.grade}>
              <Text style={[styles.eyebrow, { color: Colors.accent }]}>{card.through_week ? `After Wk ${card.through_week}` : 'Now'}</Text>
              <Text style={[styles.letter, { color: Colors.accent }]}>{card.hindsight.letter}</Text>
            </View>
          )}
          {card.hindsight && (
            <View style={styles.rankBlock}>
              <Text style={styles.rankBig}>{ordinal(card.hindsight.rank)}</Text>
              <Text style={styles.small}>of {card.team_count} drafts</Text>
              {moved !== 0 && (
                <Text style={[styles.small, { color: moved > 0 ? Colors.accent : RED, fontWeight: '700' }]}>
                  {moved > 0 ? 'up' : 'down'} {Math.abs(moved)} spot{Math.abs(moved) === 1 ? '' : 's'}
                </Text>
              )}
            </View>
          )}
        </View>
        {card.narrative ? <Text style={styles.quote}>“{card.narrative}”</Text> : null}
        <Text style={styles.small}>Re-graded each week on what every pick has actually scored.</Text>
      </Section>

      <Section title="Your picks, so far" aside={card.through_week ? <Text style={styles.small}>Pts thru Wk {card.through_week}</Text> : undefined}>
        {picks.map((p) => {
          const status = STATUS[p.status];
          return (
            <View key={p.pick_number} style={[styles.row, p.status === 'gone' && styles.faded]}>
              <Text style={styles.rank}>{p.is_keeper ? 'K' : `${p.round}.${String(p.round_pick).padStart(2, '0')}`}</Text>
              <Pos position={p.position} />
              <Text style={[styles.name, styles.flex]} numberOfLines={1}>
                {p.player_name}
              </Text>
              {p.tag ? <Tag label={p.tag === 'steal' ? 'STEAL' : 'BUST'} color={p.tag === 'steal' ? Colors.accent : RED} /> : null}
              <Tag label={status.label} color={status.color} />
              <Text style={styles.points}>{p.points}</Text>
            </View>
          );
        })}
        {card.picks.length > 8 && (
          <Pressable onPress={() => setShowAll((s) => !s)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>{showAll ? 'Show fewer' : `All ${card.picks.length} picks`}</Text>
          </Pressable>
        )}
      </Section>

      {(card.best_pick || card.biggest_miss) && (
        <Section title="Hindsight">
          {card.best_pick && <Headline label="Best pick in the league" h={card.best_pick} color={Colors.accent} />}
          {card.biggest_miss && <Headline label="Biggest miss" h={card.biggest_miss} color={RED} />}
        </Section>
      )}

      {card.keeper_watch && (
        <Section title="Next year's keeper watch" aside={<Text style={styles.small}>{card.keeper_watch.slots} slots</Text>}>
          {card.keeper_watch.players.map((p) => (
            <View key={p.sleeper_player_id} style={[styles.row, !p.eligible && styles.faded]}>
              <Pos position={p.position} />
              <Text style={[styles.name, styles.flex]}>{p.name}</Text>
              <Text style={[styles.small, p.eligible && p.next_year === 1 && { color: Colors.accent }]}>
                {!p.eligible ? 'Maxed out' : p.next_year === 1 ? 'Fresh keeper' : p.max_years ? `Year ${p.next_year} of ${p.max_years}` : `Year ${p.next_year}`}
              </Text>
            </View>
          ))}
        </Section>
      )}

      <Button label="Full draft board and league grades" onPress={() => router.push('/draft' as Href)} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  tab: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: Colors.accent },
  tabText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: '#0d1016', fontWeight: '800' },
  card: { gap: Spacing.md },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  eyebrow: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  big: { color: Colors.text, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  small: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  strong: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  name: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  link: { color: Colors.accent, fontSize: 13, fontWeight: '600' },
  progressBlock: { gap: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  track: { height: 8, borderRadius: 99, backgroundColor: Colors.tile, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.accent },
  tile: { backgroundColor: Colors.tile, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  count: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  faded: { opacity: 0.55 },
  rank: { color: Colors.textSecondary, fontSize: 12, width: 32, fontVariant: ['tabular-nums'] },
  pos: { width: 34, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  posText: { fontSize: 11, fontWeight: '800' },
  tag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  points: { color: Colors.text, width: 46, textAlign: 'right', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pick: { minWidth: 48, backgroundColor: Colors.tile, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  pickNext: { backgroundColor: `${Colors.accent}24` },
  pickText: { color: Colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pickTextNext: { color: Colors.accent },
  pickKeeper: { color: Colors.textSecondary, textDecorationLine: 'line-through' },
  gradeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.lg },
  grade: { alignItems: 'center', gap: 2 },
  letter: { fontSize: 50, fontWeight: '900', lineHeight: 54 },
  rankBlock: { marginLeft: 'auto', alignItems: 'flex-end', gap: 2 },
  rankBig: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  quote: { color: '#c9cdd4', fontSize: 14, lineHeight: 21, fontStyle: 'italic' },
  button: { minHeight: 44, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.tile, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  buttonPrimary: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  buttonText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  buttonTextPrimary: { color: '#0d1016', fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
