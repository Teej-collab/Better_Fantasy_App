import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { CommishScreen, ErrorText, errorMessage, Picker } from '@/components/commissioner/CommishUI';
import { BigButton, Chips, GroupTitle, PageTitle, Panel, partStyles as p, SmallButton, TONES } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, refreshCommish, useActiveLeague, useLeagueTeams } from '@/lib/queries';
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, isEligibleForSlot, slotDisplayLabel, starterSortIndex, STARTER_SLOT_ORDER, TAXI_SLOT_LABEL } from '@/lib/rosterSlots';
import type { FreeAgent, RosterEntry } from '@/lib/types';

// Fix a lineup (2026-10-23 overhaul, mockup 6; was Roster & Keepers'
// "Force-Edit a Roster"): pick a team and see its lineup the way My Team
// shows it, with anyone out or on bye flagged and a suggested swap from
// their own bench. Move, swap, drop or add for them — this works even
// after kickoff — then send a note telling them what changed and why.
// Every change lands in the change log.

const BENCHED = [BENCH_SLOT_LABEL, IR_SLOT_LABEL, TAXI_SLOT_LABEL];
const ALL_SLOTS = [...STARTER_SLOT_ORDER, ...BENCHED];
const CANT_PLAY = new Set(['Out', 'IR', 'Suspended', 'PUP', 'NFI', 'Doubtful']);

function flag(p: RosterEntry): { label: string; color: string } | null {
  if (p.on_bye) return { label: 'BYE', color: TONES.yellow };
  if (p.injury_status && CANT_PLAY.has(p.injury_status)) return { label: p.injury_status.toUpperCase(), color: TONES.red };
  return null;
}

function suggestion(roster: RosterEntry[]): { out: RosterEntry; in: RosterEntry } | null {
  for (const starter of roster.filter((r) => !BENCHED.includes(r.lineup_slot) && flag(r))) {
    const best = roster
      .filter((r) => r.lineup_slot === BENCH_SLOT_LABEL && !flag(r) && isEligibleForSlot(r.position, starter.lineup_slot, r.injury_status))
      .sort((a, b) => (b.points_projected ?? 0) - (a.points_projected ?? 0))[0];
    if (best) return { out: starter, in: best };
  }
  return null;
}

export default function FixLineupScreen() {
  const params = useLocalSearchParams<{ team?: string }>();
  const league = useActiveLeague().data;
  const teams = useLeagueTeams(league?.id).data ?? [];
  const [teamId, setTeamId] = useState<number | null>(params.team ? Number(params.team) : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ['commish', 'lineup', teamId],
    queryFn: () => api.teamCurrentRoster(league!.id, teamId!),
    enabled: !!league && teamId !== null,
  });
  const roster = rosterQuery.data ?? null;

  const team = teams.find((t) => t.team_id === teamId);

  async function act(label: string, fn: () => Promise<{ roster: RosterEntry[] }>, fallback: string) {
    setBusy(label);
    setError(null);
    try {
      const result = await fn();
      // The move endpoints don't send projections back; keep the ones we have.
      const known = new Map((roster ?? []).map((r) => [r.player_id, r]));
      queryClient.setQueryData(
        ['commish', 'lineup', teamId],
        result.roster.map((r) => ({ ...known.get(r.player_id), ...r, points_projected: known.get(r.player_id)?.points_projected ?? null, on_bye: known.get(r.player_id)?.on_bye })),
      );
      setChanges((n) => n + 1);
      setSelected(null);
      setSent(false);
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: ['my-team'] });
      void refreshCommish();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  async function sendNote() {
    if (teamId === null) return;
    setBusy('note');
    try {
      await api.sendLineupNote(teamId, note.trim());
      setSent(true);
      setNote('');
      haptics.success();
    } catch (e) {
      setError(errorMessage(e, "Couldn't send your note."));
    } finally {
      setBusy(null);
    }
  }

  const sorted = (roster ?? []).slice().sort((a, b) => {
    const ab = BENCHED.indexOf(a.lineup_slot), bb = BENCHED.indexOf(b.lineup_slot);
    if (ab !== bb) return ab - bb;
    return starterSortIndex(a.lineup_slot) - starterSortIndex(b.lineup_slot);
  });
  const tip = roster ? suggestion(roster) : null;

  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Fix a Lineup' }} />
      <PageTitle title="Fix a lineup" subtitle="Moves here work even after kickoff." />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teams}>
        <Chips
          options={teams.map((t) => ({ value: t.team_id, label: t.team_name }))}
          value={teamId}
          onChange={(id) => {
            setTeamId(id);
            setChanges(0);
            setSent(false);
            setSelected(null);
          }}
        />
      </ScrollView>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {teamId === null ? (
        <Text style={p.sub}>Pick a team to see its lineup.</Text>
      ) : roster === null ? (
        rosterQuery.isError ? <ErrorText>{errorMessage(rosterQuery.error, "Couldn't load that team.")}</ErrorText> : <LoadingState />
      ) : (
        <>
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              You&apos;re changing <Text style={styles.bold}>{team?.team_name ?? 'this team'}</Text>&apos;s lineup as commissioner. Each change shows in the
              change log.
            </Text>
          </View>

          {tip ? (
            <Panel color="#39ff14">
              <View style={styles.tip}>
                <Text style={styles.tipTitle}>
                  Start {tip.in.player_name} for {tip.out.player_name}
                </Text>
                <Text style={p.sub}>
                  {tip.out.player_name} is {flag(tip.out)?.label === 'BYE' ? 'on bye' : (tip.out.injury_status ?? '').toLowerCase()}. {tip.in.player_name} is on their
                  bench{tip.in.points_projected != null ? `, projected ${tip.in.points_projected.toFixed(1)}` : ''}.
                </Text>
                <SmallButton
                  label={busy === 'tip' ? 'Swapping…' : 'Make this swap'}
                  disabled={!!busy}
                  onPress={() =>
                    void act('tip', () => api.commissionerSwap(league!.id, teamId, tip.out.player_id, tip.in.player_id), "Couldn't make that swap.")
                  }
                />
              </View>
            </Panel>
          ) : null}

          <Panel>
            {sorted.map((r, i) => {
              const f = flag(r);
              const open = selected === r.player_id;
              const targets = ALL_SLOTS.filter((slot) => slot !== r.lineup_slot && isEligibleForSlot(r.position, slot, r.injury_status));
              return (
                <View key={r.player_id} style={[i > 0 && p.divided, f && !BENCHED.includes(r.lineup_slot) && styles.flagged]}>
                  <Pressable
                    onPress={() => {
                      haptics.select();
                      setSelected(open ? null : r.player_id);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    style={styles.row}>
                    <Text style={styles.slot}>{slotDisplayLabel(r.lineup_slot)}</Text>
                    <View style={p.flex}>
                      <Text style={styles.player} numberOfLines={1}>
                        {r.player_name}
                        {f ? <Text style={[styles.flag, { color: f.color }]}>  {f.label}</Text> : null}
                      </Text>
                      <Text style={p.sub}>
                        {r.position === 'DEF' ? 'D/ST' : r.position}
                        {r.pro_team ? ` · ${r.pro_team}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.proj}>{r.points_projected != null ? r.points_projected.toFixed(1) : '—'}</Text>
                  </Pressable>
                  {open ? (
                    <View style={styles.rowActions}>
                      {targets.length ? (
                        <Picker
                          value={null}
                          placeholder={busy === r.player_id ? 'Moving…' : 'Move to…'}
                          options={targets.map((slot) => ({ value: slot, label: slotDisplayLabel(slot) }))}
                          disabled={!!busy}
                          onChange={(slot) => void act(r.player_id, () => api.commissionerMove(league!.id, teamId, r.player_id, slot), "Couldn't move that player.")}
                        />
                      ) : null}
                      <SmallButton
                        label={busy === `drop-${r.player_id}` ? 'Dropping…' : 'Drop'}
                        color="#f87171"
                        disabled={!!busy}
                        onPress={() => void act(`drop-${r.player_id}`, () => api.commissionerDrop(league!.id, teamId, r.player_id), "Couldn't drop that player.")}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Panel>

          <AddPlayer
            onAdd={(id, override) => act(`add-${id}`, async () => {
              const result = await api.commissionerAdd(league!.id, teamId, id, override);
              if (result.status === 'roster_full') throw new Error('Their roster is full. Drop someone first.');
              if (result.status === 'on_waivers') throw new OnWaivers(id, result.clears_at);
              return { roster: result.roster };
            }, "Couldn't add that player.")}
            busy={busy}
          />

          <View style={styles.noteBox}>
            <GroupTitle title="Tell them why" color={TONES.purple} />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={changes ? 'e.g. Swapped out Hall since he’s ruled out.' : 'Make a change above, then add a note'}
              placeholderTextColor="rgba(255,255,255,0.4)"
              multiline
              maxLength={500}
              style={[p.input, styles.note]}
            />
            <BigButton
              label={sent ? 'Sent' : 'Send note'}
              busyLabel="Sending…"
              busy={busy === 'note'}
              disabled={!note.trim() || sent}
              onPress={() => void sendNote()}
            />
          </View>
        </>
      )}
    </CommishScreen>
  );
}

class OnWaivers extends Error {
  constructor(public playerId: string, public clearsAt: string | null) {
    super(clearsAt ? `On waivers until ${new Date(clearsAt).toLocaleString()}. Tap Add anyway to skip waivers.` : 'That player is on waivers. Tap Add anyway to skip waivers.');
  }
}

function AddPlayer({ onAdd, busy }: { onAdd: (playerId: string, override?: boolean) => Promise<void>; busy: string | null }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<FreeAgent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      const { players } = await api.freeAgents(undefined, search.trim() || undefined);
      setResults(players.filter((p) => !p.rostered_team_name).slice(0, 10));
    } catch (e) {
      setError(errorMessage(e, "Couldn't search players."));
    }
  }

  return (
    <View style={styles.add}>
      <GroupTitle title="Add a free agent" color={TONES.green} />
      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search players"
          placeholderTextColor="rgba(255,255,255,0.4)"
          onSubmitEditing={() => void run()}
          returnKeyType="search"
          autoCorrect={false}
          style={[p.input, p.flex]}
        />
        <SmallButton label="Search" onPress={() => void run()} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {results.length ? (
        <Panel>
          {results.map((r, i) => (
            <View key={r.sleeper_player_id} style={[styles.row, i > 0 && p.divided]}>
              <View style={p.flex}>
                <Text style={styles.player}>{r.full_name}</Text>
                <Text style={p.sub}>
                  {r.position === 'DEF' ? 'D/ST' : r.position}
                  {r.pro_team ? ` · ${r.pro_team}` : ''}
                </Text>
              </View>
              <SmallButton label={busy === `add-${r.sleeper_player_id}` ? 'Adding…' : 'Add'} disabled={!!busy} onPress={() => void onAdd(r.sleeper_player_id)} />
              <SmallButton label="Add anyway" color="#facc15" disabled={!!busy} onPress={() => void onAdd(r.sleeper_player_id, true)} />
            </View>
          ))}
        </Panel>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  teams: { paddingRight: Spacing.lg },
  banner: { backgroundColor: 'rgba(249,115,22,0.13)', borderColor: 'rgba(249,115,22,0.4)', borderWidth: 1, borderRadius: 12, padding: 12 },
  bannerText: { color: Colors.text, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '800' },
  tip: { padding: 14, gap: 8 },
  tipTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 12, paddingVertical: 8 },
  flagged: { backgroundColor: 'rgba(248,113,113,0.08)' },
  slot: { width: 46, color: Colors.textSecondary, fontSize: 11, fontWeight: '800' },
  player: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  flag: { fontSize: 11, fontWeight: '800' },
  proj: { color: Colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: 12, paddingBottom: 12 },
  add: { gap: Spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  noteBox: { gap: Spacing.sm },
  note: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
});
