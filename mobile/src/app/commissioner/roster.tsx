import { Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  fromLocalInput,
  Input,
  NumberRow,
  OutlineButton,
  PrimaryButton,
  SectionHead,
  StatusText,
  toLocalInput,
  type SaveStatus,
} from '@/components/commissioner/CommishUI';
import { Panel, ToolRow } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { queryClient, useKeeperRules, useRosterSettings } from '@/lib/queries';
import type { KeeperRules } from '@/lib/types';

// The web's /commissioner/roster: KeeperRulesSection and
// RosterSlotsSection. Force-editing a roster moved to Fix a lineup
// (2026-10-23).
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
      <Panel>
        <ToolRow first title="Fix a lineup" value="Move, add or drop for any team (now its own tool)" href={'/commissioner/lineup' as Href} target="roster_fix_lineup" />
      </Panel>
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
  'QB/RB/WR/TE': 'Superflex (QB/RB/WR/TE)',
  'D/ST': 'D/ST',
  K: 'K',
  DL: 'DL',
  LB: 'LB',
  DB: 'DB',
  IDP: 'IDP flex (DL/LB/DB)',
  BE: 'Bench',
  IR: 'IR',
  TAXI: 'Taxi squad',
};
// Rows to show: the standard shape plus Superflex, and the IDP/taxi
// rows only in a league that uses them (league formats, 2026-10).
const OPTIONAL_ROWS = ['DL', 'LB', 'DB', 'IDP', 'TAXI'];
function slotRows(values: Record<string, unknown>): string[] {
  const base = ['QB', 'RB', 'WR', 'TE', 'RB/WR/TE', 'QB/RB/WR/TE', 'D/ST', 'K'];
  const extra = OPTIONAL_ROWS.filter((k) => k !== 'TAXI' && Number(values[k] ?? 0) > 0);
  return [...base, ...extra, 'BE', 'IR', ...(Number(values.TAXI ?? 0) > 0 ? ['TAXI'] : [])];
}
// Only real positions get a cap (the slot label → players.position).
const SLOT_TO_POSITION: Record<string, string> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', 'D/ST': 'DEF', K: 'K' };

function RosterSlotsSection(props: { slots: Record<string, number>; editable: boolean; positionMax: Record<string, number> }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(slotRows(props.slots).map((k) => [k, String(props.slots[k] ?? 0)])),
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
      {slotRows(values).map((key) => {
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
