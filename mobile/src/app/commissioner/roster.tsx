import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  fromLocalInput,
  GroupLabel,
  Input,
  NumberRow,
  OutlineButton,
  Picker,
  PrimaryButton,
  SectionHead,
  StatusText,
  toLocalInput,
  type SaveStatus,
} from '@/components/commissioner/CommishUI';
import { ListPanel } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useActiveLeague, useKeeperRules, useLeagueTeams, useRosterSettings } from '@/lib/queries';
import { BENCH_SLOT_LABEL, FLEX_SLOT_LABEL, IR_SLOT_LABEL, isEligibleForSlot, slotDisplayLabel } from '@/lib/rosterSlots';
import type { FreeAgent, KeeperRules, RosterEntry } from '@/lib/types';

// The web's /commissioner/roster: KeeperRulesSection,
// RosterSlotsSection and ForceEditRosterSection, in that order.
export default function RosterAndKeepersScreen() {
  const keeperRules = useKeeperRules();
  const roster = useRosterSettings();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Roster & Keepers' }} />
      {keeperRules.data ? (
        <KeeperRulesSection key={keeperRules.data.season} rules={keeperRules.data} />
      ) : (
        keeperRules.isError && <ErrorText>{errorMessage(keeperRules.error, "Couldn't load keeper rules.")}</ErrorText>
      )}
      {roster.data ? (
        <RosterSlotsSection
          slots={roster.data.slots.roster_slots ?? DEFAULT_ROSTER_SLOTS}
          editable={roster.data.slots.editable}
          positionMax={roster.data.max.position_max ?? {}}
        />
      ) : (
        roster.isError && <ErrorText>{errorMessage(roster.error, "Couldn't load roster settings.")}</ErrorText>
      )}
      <ForceEditRosterSection />
    </CommishScreen>
  );
}

// ---- Keeper rules ----------------------------------------------------

function KeeperRulesSection({ rules }: { rules: KeeperRules }) {
  const [maxKeepers, setMaxKeepers] = useState(String(rules.max_keepers));
  const [maxYears, setMaxYears] = useState(rules.max_consecutive_years === null ? '' : String(rules.max_consecutive_years));
  const [deadline, setDeadline] = useState(toLocalInput(rules.keeper_deadline));
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });
  const [lockBusy, setLockBusy] = useState(false);

  async function refresh(updated: KeeperRules) {
    queryClient.setQueryData(['keeper-rules'], updated);
    void queryClient.invalidateQueries({ queryKey: ['my-keepers'] });
  }

  async function save() {
    const iso = fromLocalInput(deadline);
    if (iso === 'invalid') {
      setPanel({ status: 'error', message: 'Deadline must look like 2026-08-28 18:00 (or be blank).' });
      return;
    }
    setPanel({ status: 'saving' });
    try {
      const updated = await api.setKeeperRules({
        season: rules.season,
        max_keepers: Number(maxKeepers) || 0,
        max_consecutive_years: maxYears === '' ? null : Number(maxYears),
        keeper_deadline: iso,
      });
      await refresh(updated);
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't save keeper rules.") });
    }
  }

  async function toggleLock() {
    setLockBusy(true);
    try {
      await refresh(await api.setKeepersLocked(rules.season, !rules.locked_at));
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't change the lock.") });
    } finally {
      setLockBusy(false);
    }
  }

  return (
    <View style={s.gap}>
      <SectionHead title="Keeper Rules" subtitle={`How many keepers each owner can carry into ${rules.season}, and until when.`} />
      <NumberRow label="Max keepers" value={maxKeepers} onChange={setMaxKeepers} />
      <NumberRow label="Max consecutive years (blank = no cap)" value={maxYears} onChange={setMaxYears} />
      <View style={s.gapSm}>
        <Text style={s.bodySoft}>Selection deadline</Text>
        <Input value={deadline} onChangeText={setDeadline} placeholder="2026-08-28 18:00" />
      </View>
      <View style={s.row}>
        <PrimaryButton label="Save keeper rules" busyLabel="Saving…" busy={panel.status === 'saving'} onPress={save} />
        <StatusText panel={panel} />
      </View>
      <View style={[s.row, s.separator]}>
        <Text style={[s.muted, s.flex]}>
          {rules.locked_at ? `Locked ${new Date(rules.locked_at).toLocaleString()}` : 'Not locked — owners can still edit their picks.'}
        </Text>
        <OutlineButton
          tone={rules.locked_at ? 'default' : 'danger'}
          label={lockBusy ? 'Working…' : rules.locked_at ? 'Unlock' : 'Lock selections'}
          disabled={lockBusy}
          onPress={toggleLock}
        />
      </View>
    </View>
  );
}

// ---- Roster slots + position caps -------------------------------------

const DEFAULT_ROSTER_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, 'RB/WR/TE': 1, 'D/ST': 1, K: 1, BE: 7, IR: 1 };
const SLOT_LABELS: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  'RB/WR/TE': 'Flex (RB/WR/TE)',
  'D/ST': 'D/ST',
  K: 'K',
  BE: 'Bench',
  IR: 'IR',
};
// Only real positions get a cap (the slot label → players.position).
const SLOT_TO_POSITION: Record<string, string> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', 'D/ST': 'DEF', K: 'K' };

function RosterSlotsSection(props: { slots: Record<string, number>; editable: boolean; positionMax: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(DEFAULT_ROSTER_SLOTS).map((k) => [k, String(props.slots[k] ?? 0)])),
  );
  const [maxValues, setMaxValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(props.positionMax).map(([k, v]) => [k, String(v)])),
  );
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });

  async function save() {
    setPanel({ status: 'saving' });
    try {
      const slots = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v) || 0]));
      const max = Object.fromEntries(
        Object.entries(maxValues)
          .filter(([, v]) => v.trim() !== '')
          .map(([k, v]) => [k, Number(v) || 0]),
      );
      // Slot counts only save while no draft exists; caps always save.
      await Promise.all([props.editable ? api.setRosterSlots(slots) : Promise.resolve(), api.setPositionMax(max)]);
      setPanel({ status: 'saved' });
      void queryClient.invalidateQueries({ queryKey: ['roster-settings'] });
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't save roster settings.") });
    }
  }

  return (
    <View style={s.gap}>
      <SectionHead
        title="Roster Slots"
        subtitle="How many of each slot every team's roster carries, and the most of one position any team can ever roster (blank = no limit)."
      />
      {!props.editable && (
        <View style={s.noteBox}>
          <Text style={s.small}>
            A draft already exists for this season, so slot counts are read-only — reset the draft on the Draft page first if you
            need to change roster shape. Position maximums below can still be changed anytime.
          </Text>
        </View>
      )}
      {Object.keys(DEFAULT_ROSTER_SLOTS).map((key) => {
        const position = SLOT_TO_POSITION[key];
        return (
          <NumberRow
            key={key}
            label={SLOT_LABELS[key] ?? key}
            value={values[key]}
            editable={props.editable}
            onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
            extra={
              position ? (
                <View style={[s.row, { flexWrap: 'nowrap', gap: 4 }]}>
                  <Text style={s.small}>(</Text>
                  <Input
                    value={maxValues[position] ?? ''}
                    onChangeText={(v) => setMaxValues((prev) => ({ ...prev, [position]: v }))}
                    placeholder="No limit"
                    numeric
                    style={{ width: 72, textAlign: 'right' }}
                  />
                  <Text style={s.small}>max)</Text>
                </View>
              ) : (
                <View style={{ width: 104 }} />
              )
            }
          />
        );
      })}
      <View style={s.row}>
        <PrimaryButton label="Save roster slots" busyLabel="Saving…" busy={panel.status === 'saving'} onPress={save} />
        <StatusText panel={panel} />
      </View>
    </View>
  );
}

// ---- Force-edit a roster ---------------------------------------------

const ALL_LINEUP_SLOTS = ['QB', 'RB', 'WR', 'TE', FLEX_SLOT_LABEL, 'D/ST', 'K', BENCH_SLOT_LABEL, IR_SLOT_LABEL];

function ForceEditRosterSection() {
  const accent = useAppearance().accent;
  const league = useActiveLeague().data;
  const teams = useLeagueTeams(league?.id).data ?? [];
  const [teamId, setTeamId] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [dropBusyId, setDropBusyId] = useState<string | null>(null);
  const [moveBusyId, setMoveBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<FreeAgent[]>([]);
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const [rosterFullFor, setRosterFullFor] = useState<string | null>(null);
  const [onWaiversFor, setOnWaiversFor] = useState<{ id: string; detail: string; clearsAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickTeam(id: number) {
    if (!league) return;
    setTeamId(id);
    setResults([]);
    setSearch('');
    setRoster(null);
    setRosterFullFor(null);
    setOnWaiversFor(null);
    try {
      setRoster(await api.teamCurrentRoster(league.id, id));
    } catch (e) {
      setError(errorMessage(e, "Couldn't load that team's roster."));
    }
  }

  function changed(updated: RosterEntry[]) {
    setRoster(updated);
    void queryClient.invalidateQueries({ queryKey: ['my-team'] });
  }

  async function drop(playerId: string) {
    if (!league || teamId === null) return;
    setDropBusyId(playerId);
    try {
      changed((await api.commissionerDrop(league.id, teamId, playerId)).roster);
    } catch (e) {
      setError(errorMessage(e, "Couldn't drop that player."));
    } finally {
      setDropBusyId(null);
    }
  }

  async function move(playerId: string, toSlot: string) {
    if (!league || teamId === null) return;
    setMoveBusyId(playerId);
    try {
      changed((await api.commissionerMove(league.id, teamId, playerId, toSlot)).roster);
    } catch (e) {
      setError(errorMessage(e, "Couldn't move that player."));
    } finally {
      setMoveBusyId(null);
    }
  }

  async function runSearch() {
    try {
      const { players } = await api.freeAgents(undefined, search.trim() || undefined);
      setResults(players.slice(0, 15));
    } catch (e) {
      setError(errorMessage(e, "Couldn't search free agents."));
    }
  }

  async function add(playerId: string, overrideWaivers?: boolean) {
    if (!league || teamId === null) return;
    setAddBusyId(playerId);
    setRosterFullFor(null);
    setOnWaiversFor(null);
    try {
      const result = await api.commissionerAdd(league.id, teamId, playerId, overrideWaivers);
      if (result.status === 'roster_full') setRosterFullFor(playerId);
      else if (result.status === 'on_waivers') setOnWaiversFor({ id: playerId, detail: result.detail, clearsAt: result.clears_at });
      else changed(result.roster);
    } catch (e) {
      setError(errorMessage(e, "Couldn't add that player."));
    } finally {
      setAddBusyId(null);
    }
  }

  return (
    <View style={s.gap}>
      <SectionHead
        title="Force-Edit a Roster"
        subtitle="Add, drop, or move a player into a different lineup slot on any member's behalf — for when they can't manage their own team, or to fix an already-live lineup (moves here work even after kickoff)."
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Picker
        value={teamId}
        options={teams.map((t) => ({ value: t.team_id, label: `${t.team_name} — ${t.owner_name}` }))}
        placeholder="Pick a team…"
        onChange={pickTeam}
      />

      {teamId !== null && (
        <>
          <View style={s.gapSm}>
            <GroupLabel>Current roster</GroupLabel>
            {roster === null ? (
              <Text style={s.muted}>Loading…</Text>
            ) : roster.length === 0 ? (
              <Text style={s.muted}>Empty roster.</Text>
            ) : (
              <ListPanel color={accent}>
                {roster.map((p, i) => {
                  const eligible = ALL_LINEUP_SLOTS.filter((slot) => slot !== p.lineup_slot && isEligibleForSlot(p.position, slot, p.injury_status));
                  return (
                    <View key={p.player_id} style={[s.item, { paddingHorizontal: 12, paddingVertical: 8, gap: 6 }, i > 0 && s.divided]}>
                      <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
                        <Text style={[s.body, s.flex]}>
                          {p.player_name} <Text style={s.small}>({p.lineup_slot})</Text>
                        </Text>
                        <OutlineButton
                          small
                          tone="danger"
                          label={dropBusyId === p.player_id ? 'Dropping…' : 'Drop'}
                          disabled={dropBusyId === p.player_id}
                          onPress={() => drop(p.player_id)}
                        />
                      </View>
                      {eligible.length > 0 && (
                        <Picker
                          value={null}
                          options={eligible.map((slot) => ({ value: slot, label: slotDisplayLabel(slot) }))}
                          placeholder={moveBusyId === p.player_id ? 'Moving…' : 'Move to…'}
                          disabled={moveBusyId === p.player_id}
                          onChange={(slot) => move(p.player_id, slot)}
                        />
                      )}
                    </View>
                  );
                })}
              </ListPanel>
            )}
          </View>

          <View style={s.gapSm}>
            <GroupLabel>Add a free agent</GroupLabel>
            <View style={[s.row, { flexWrap: 'nowrap' }]}>
              <Input value={search} onChangeText={setSearch} placeholder="Search players…" onSubmitEditing={runSearch} style={{ flex: 1 }} />
              <OutlineButton label="Search" onPress={runSearch} />
            </View>
            {results.length > 0 && (
              <ListPanel color={accent}>
                {results.map((p, i) => (
                  <View key={p.sleeper_player_id} style={[s.item, { paddingHorizontal: 12, paddingVertical: 8, gap: 4 }, i > 0 && s.divided]}>
                    <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
                      <Text style={[s.body, s.flex]}>
                        {p.full_name}{' '}
                        <Text style={s.small}>
                          {p.position === 'DEF' ? 'D/ST' : p.position}
                          {p.pro_team ? ` — ${p.pro_team}` : ''}
                        </Text>
                      </Text>
                      <OutlineButton
                        small
                        tone="add"
                        label={addBusyId === p.sleeper_player_id ? 'Adding…' : 'Add'}
                        disabled={addBusyId === p.sleeper_player_id}
                        onPress={() => add(p.sleeper_player_id)}
                      />
                    </View>
                    {rosterFullFor === p.sleeper_player_id && <Text style={s.danger}>Roster is full — drop a player above first.</Text>}
                    {onWaiversFor?.id === p.sleeper_player_id && (
                      <View style={s.warnBox}>
                        <Text style={s.warnText}>
                          {onWaiversFor.clearsAt
                            ? `Still on waivers until ${new Date(onWaiversFor.clearsAt).toLocaleString()}.`
                            : onWaiversFor.detail}
                        </Text>
                        <OutlineButton
                          small
                          tone="warn"
                          label={addBusyId === p.sleeper_player_id ? 'Adding…' : 'Force add anyway (override waivers)'}
                          disabled={addBusyId === p.sleeper_player_id}
                          onPress={() => add(p.sleeper_player_id, true)}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </ListPanel>
            )}
          </View>
        </>
      )}
    </View>
  );
}
