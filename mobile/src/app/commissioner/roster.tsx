import { Stack, type Href } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { CommishScreen, ErrorText, errorMessage, fromLocalInput, StatusText, toLocalInput, type SaveStatus } from '@/components/commissioner/CommishUI';
import { Panel, ToolRow } from '@/components/commissioner/CommishParts';
import { GlowBox } from '@/components/fx/Glow';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useKeeperRules, useRosterSettings } from '@/lib/queries';
import type { KeeperRules } from '@/lib/types';

// The web's /commissioner/roster, as the "Hive Builder" (2026-10-30
// elite pass, mockup board B): every roster slot is a honeycomb cell —
// tap one to change its count and, for a real position, the most any
// team can roster — and the keeper rules are the Keeper Vault: lit
// cells for how many each team keeps, a track for how many years in a
// row, an LED countdown to the deadline and the lock as a switch.
// Force-editing a roster moved to Fix a lineup (2026-10-23).
export default function RosterAndKeepersScreen() {
  const keeperRules = useKeeperRules();
  const roster = useRosterSettings();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Roster & Keepers' }} />
      {roster.data ? (
        <HiveBuilder
          slots={roster.data.slots.roster_slots ?? DEFAULT_ROSTER_SLOTS}
          editable={roster.data.slots.editable}
          positionMax={roster.data.max.position_max ?? {}}
        />
      ) : (
        roster.isError && <ErrorText>{errorMessage(roster.error, "Couldn't load roster settings.")}</ErrorText>
      )}
      {keeperRules.data ? (
        <KeeperVault key={keeperRules.data.season} rules={keeperRules.data} />
      ) : (
        keeperRules.isError && <ErrorText>{errorMessage(keeperRules.error, "Couldn't load keeper rules.")}</ErrorText>
      )}
      <Panel>
        <ToolRow first title="Fix a lineup" value="Move, add or drop for any team" href={'/commissioner/lineup' as Href} target="roster_fix_lineup" />
      </Panel>
    </CommishScreen>
  );
}

const GREEN = '#39ff14';
const ORANGE = '#ff7a1a';
const ANTON = 'Anton_400Regular';

// ---- One honeycomb cell ------------------------------------------------

// A pointy-top hexagon `w` wide; neighbours in the next row tuck a
// quarter of its height under this one.
function hexPoints(w: number, h: number, inset = 0): string {
  const i = inset;
  return [
    [w / 2, i],
    [w - i, h / 4 + i / 2],
    [w - i, (3 * h) / 4 - i / 2],
    [w / 2, h - i],
    [i, (3 * h) / 4 - i / 2],
    [i, h / 4 + i / 2],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

function HexCell({
  w,
  color,
  fill = '#121821',
  selected,
  dim,
  onPress,
  label,
  children,
}: {
  w: number;
  color: string;
  fill?: string;
  selected?: boolean;
  dim?: boolean;
  onPress?: () => void;
  label: string;
  children: ReactNode;
}) {
  const h = w * 1.1547;
  const pad = 8;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [{ width: w, height: h, opacity: dim ? 0.55 : 1 }, pressed && styles.pressed]}>
      <Svg width={w + 2 * pad} height={h + 2 * pad} style={{ position: 'absolute', left: -pad, top: -pad }}>
        {selected && (
          <>
            <Polygon points={shift(hexPoints(w, h, 2), pad)} fill="none" stroke={color} strokeWidth={14} strokeOpacity={0.12} strokeLinejoin="round" />
            <Polygon points={shift(hexPoints(w, h, 2), pad)} fill="none" stroke={color} strokeWidth={8} strokeOpacity={0.25} strokeLinejoin="round" />
          </>
        )}
        <Polygon points={shift(hexPoints(w, h, 2), pad)} fill={selected ? '#14261a' : fill} stroke={color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
        {selected && <Polygon points={shift(hexPoints(w, h, 2), pad)} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={0.8} strokeLinejoin="round" />}
      </Svg>
      <View style={styles.hexInner}>{children}</View>
    </Pressable>
  );
}

function shift(points: string, by: number): string {
  return points
    .split(' ')
    .map((p) => {
      const [x, y] = p.split(',').map(Number);
      return `${(x + by).toFixed(1)},${(y + by).toFixed(1)}`;
    })
    .join(' ');
}

// Rows of 4 and 3, the 3s tucked into the 4s' gaps.
function Honeycomb({ w, children }: { w: number; children: ReactNode[] }) {
  const h = w * 1.1547;
  const rows: ReactNode[][] = [];
  let i = 0;
  while (i < children.length) {
    const n = rows.length % 2 === 0 ? 4 : 3;
    rows.push(children.slice(i, i + n));
    i += n;
  }
  return (
    <View style={styles.comb}>
      {rows.map((row, r) => (
        <View key={r} style={[styles.combRow, r > 0 && { marginTop: -h / 4 + 4 }]}>
          {row}
        </View>
      ))}
    </View>
  );
}

// ---- Roster slots + position caps -------------------------------------

const DEFAULT_ROSTER_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, 'RB/WR/TE': 1, 'D/ST': 1, K: 1, BE: 7, IR: 1 };
const SLOT_LABELS: Record<string, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  'RB/WR/TE': 'Flex (RB/WR/TE)',
  'QB/RB/WR/TE': 'Superflex (QB/RB/WR/TE)',
  'D/ST': 'Defense / special teams',
  K: 'Kickers',
  DL: 'Defensive linemen',
  LB: 'Linebackers',
  DB: 'Defensive backs',
  IDP: 'IDP flex (DL/LB/DB)',
  BE: 'Bench',
  IR: 'Injured reserve',
  TAXI: 'Taxi squad',
};
const SHORT: Record<string, string> = { 'RB/WR/TE': 'FLEX', 'QB/RB/WR/TE': 'SFLEX', BE: 'BENCH', TAXI: 'TAXI' };
const SUB: Record<string, string> = { 'RB/WR/TE': 'RB·WR·TE', 'QB/RB/WR/TE': '+ QB', IDP: 'DL·LB·DB' };
const SLOT_COLORS: Record<string, string> = {
  QB: '#ff5d73',
  RB: '#38d9a9',
  WR: '#4dabf7',
  TE: '#ffa94d',
  'RB/WR/TE': '#b197fc',
  'QB/RB/WR/TE': '#b197fc',
  'D/ST': '#94a3b8',
  K: '#ffd43b',
  DL: '#f783ac',
  LB: '#63e6be',
  DB: '#74c0fc',
  IDP: '#da77f2',
  BE: 'rgba(245,244,236,0.55)',
  IR: '#ff8a9a',
  TAXI: '#e9c46a',
};
// Rows to show: the standard shape plus Superflex, and the IDP/taxi
// rows only in a league that uses them (league formats, 2026-10) or
// once the commissioner adds one here.
const OPTIONAL_ROWS = ['DL', 'LB', 'DB', 'IDP', 'TAXI'];
function slotRows(values: Record<string, number>, added: string[]): string[] {
  const base = ['QB', 'RB', 'WR', 'TE', 'RB/WR/TE', 'QB/RB/WR/TE', 'D/ST', 'K'];
  const uses = (k: string) => Number(values[k] ?? 0) > 0 || added.includes(k);
  const extra = OPTIONAL_ROWS.filter((k) => k !== 'TAXI' && uses(k));
  return [...base, ...extra, 'BE', 'IR', ...(uses('TAXI') ? ['TAXI'] : [])];
}
// Only real positions get a cap (the slot label → players.position).
const SLOT_TO_POSITION: Record<string, string> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', 'D/ST': 'DEF', K: 'K' };
const MAX_SLOT = 20;
const MAX_CAP = 20;

function HiveBuilder(props: { slots: Record<string, number>; editable: boolean; positionMax: Record<string, number> }) {
  const { width } = useWindowDimensions();
  const cell = Math.min(84, Math.floor((width - 2 * Spacing.lg - 18) / 4));
  const [values, setValues] = useState<Record<string, number>>(() => ({ ...props.slots }));
  const [caps, setCaps] = useState<Record<string, number | null>>(() => ({ ...props.positionMax }));
  const [added, setAdded] = useState<string[]>([]);
  const [selected, setSelected] = useState('RB');
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });

  const rows = slotRows(values, added);
  const total = rows.filter((k) => k !== 'IR' && k !== 'TAXI').reduce((n, k) => n + Number(values[k] ?? 0), 0);
  const changes = useMemo(() => {
    const keys = new Set([...Object.keys(values), ...Object.keys(props.slots)]);
    const slotChanges = [...keys].filter((k) => Number(values[k] ?? 0) !== Number(props.slots[k] ?? 0)).length;
    const capKeys = new Set([...Object.keys(caps), ...Object.keys(props.positionMax)]);
    const capChanges = [...capKeys].filter((k) => (caps[k] ?? null) !== (props.positionMax[k] ?? null)).length;
    return slotChanges + capChanges;
  }, [values, caps, props.slots, props.positionMax]);

  const position = SLOT_TO_POSITION[selected];
  const count = Number(values[selected] ?? 0);
  const cap = position ? (caps[position] ?? null) : null;

  function setCount(next: number) {
    haptics.select();
    setValues((v) => ({ ...v, [selected]: Math.max(0, Math.min(MAX_SLOT, next)) }));
    setPanel({ status: 'idle' });
  }
  // Below the starting count the cap means nothing, so stepping down
  // past it goes to "no limit".
  function setCap(next: number | null) {
    if (!position) return;
    haptics.select();
    setCaps((c) => ({ ...c, [position]: next === null || next < Math.max(1, count) ? null : Math.min(MAX_CAP, next) }));
    setPanel({ status: 'idle' });
  }

  async function save() {
    setPanel({ status: 'saving' });
    try {
      const slots = Object.fromEntries(rows.map((k) => [k, Number(values[k] ?? 0)]));
      const max = Object.fromEntries(Object.entries(caps).filter((e): e is [string, number] => e[1] !== null));
      // Slot counts only save while no draft exists; caps always save.
      await Promise.all([props.editable ? api.setRosterSlots(slots) : Promise.resolve(), api.setPositionMax(max)]);
      haptics.success();
      setPanel({ status: 'saved' });
      void queryClient.invalidateQueries({ queryKey: ['roster-settings'] });
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't save roster settings.") });
    }
  }

  const cells = rows.map((key) => {
    const color = SLOT_COLORS[key] ?? GREEN;
    const n = Number(values[key] ?? 0);
    const p = SLOT_TO_POSITION[key];
    const sub = p ? (caps[p] != null ? `max ${caps[p]}` : 'no limit') : SUB[key];
    return (
      <HexCell
        key={key}
        w={cell}
        color={selected === key ? GREEN : color}
        selected={selected === key}
        dim={n === 0 && selected !== key}
        label={`${SLOT_LABELS[key] ?? key}: ${n}`}
        onPress={() => {
          haptics.select();
          setSelected(key);
          setAdding(false);
        }}>
        <Text style={[styles.hexLabel, { color: selected === key ? GREEN : color }]} numberOfLines={1}>
          {SHORT[key] ?? key}
        </Text>
        <Text style={styles.hexCount}>{n}</Text>
        {sub ? (
          <Text style={styles.hexSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </HexCell>
    );
  });
  const unused = OPTIONAL_ROWS.filter((k) => !rows.includes(k));
  if (unused.length > 0) {
    cells.push(
      <HexCell key="+add" w={cell} color="rgba(245,244,236,0.25)" fill="#0f141b" selected={adding} label="Add IDP or taxi slots" onPress={() => setAdding((a) => !a)}>
        <Text style={[styles.hexLabel, { color: 'rgba(245,244,236,0.75)' }]}>+ ADD</Text>
        <Text style={styles.hexSub}>IDP · taxi</Text>
      </HexCell>,
    );
  }

  return (
    <View style={styles.gap}>
      <View style={styles.center}>
        <Text style={styles.display}>BUILD THE ROSTER</Text>
        <Text style={styles.muted}>
          Tap a cell to change it. <Text style={styles.strong}>{`${total} players`}</Text> per team
          {Number(values.IR ?? 0) > 0 ? `, plus ${values.IR} IR` : ''}.
        </Text>
      </View>

      {!props.editable && (
        <View style={styles.note}>
          <Text style={styles.small}>
            A draft already exists for this season, so slot counts are locked. Reset the draft on the Draft page to change them. The
            most-per-roster caps can still change anytime.
          </Text>
        </View>
      )}

      <Honeycomb w={cell}>{cells}</Honeycomb>

      {adding ? (
        <View style={styles.tray}>
          <Text style={styles.trayTitle}>ADD A SLOT</Text>
          <View style={styles.chips}>
            {unused.map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  haptics.select();
                  setAdded((a) => [...a, k]);
                  setValues((v) => ({ ...v, [k]: Math.max(1, Number(v[k] ?? 0)) }));
                  setSelected(k);
                  setAdding(false);
                }}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                accessibilityRole="button">
                <Text style={styles.chipText}>{SLOT_LABELS[k]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <GlowBox color={GREEN} radius={22} intensity={0.35} spread={14}>
          <View style={styles.tray}>
            <View style={styles.trayHead}>
              <Text style={styles.trayTitle} numberOfLines={1}>
                {(SLOT_LABELS[selected] ?? selected).toUpperCase()}
              </Text>
              {changes > 0 && <Text style={styles.small}>{`${changes} change${changes === 1 ? '' : 's'} waiting`}</Text>}
            </View>
            <View style={styles.steppers}>
              <Stepper
                title={selected === 'BE' || selected === 'IR' || selected === 'TAXI' ? 'Spots' : 'Starting spots'}
                value={String(count)}
                disabled={!props.editable}
                onMinus={() => setCount(count - 1)}
                onPlus={() => setCount(count + 1)}
              />
              {position ? (
                <Stepper title="Most on a roster" value={cap === null ? '∞' : String(cap)} onMinus={() => setCap(cap === null ? null : cap - 1)} onPlus={() => setCap(cap === null ? Math.max(1, count) + 1 : cap + 1)} />
              ) : (
                <View style={[styles.stepper, styles.stepperNote]}>
                  <Text style={styles.small}>{selected === 'BE' || selected === 'IR' || selected === 'TAXI' ? 'Held, not started.' : 'Not one position, so no cap.'}</Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={save}
              disabled={panel.status === 'saving' || changes === 0}
              style={({ pressed }) => [styles.saveButton, (panel.status === 'saving' || changes === 0) && styles.dim, pressed && styles.pressed]}
              accessibilityRole="button">
              <Text style={styles.saveText}>{panel.status === 'saving' ? 'Saving…' : changes === 0 && panel.status === 'saved' ? 'Saved ✓' : 'Save roster'}</Text>
            </Pressable>
            {panel.status === 'error' && <StatusText panel={panel} />}
          </View>
        </GlowBox>
      )}
    </View>
  );
}

function Stepper({ title, value, onMinus, onPlus, disabled }: { title: string; value: string; onMinus: () => void; onPlus: () => void; disabled?: boolean }) {
  return (
    <View style={[styles.stepper, disabled && styles.dim]}>
      <Text style={styles.small}>{title}</Text>
      <View style={styles.stepRow}>
        <Pressable disabled={disabled} onPress={onMinus} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${title}: one fewer`}>
          <Text style={styles.stepGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable disabled={disabled} onPress={onPlus} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${title}: one more`}>
          <Text style={styles.stepGlyph}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- The Keeper Vault --------------------------------------------------

const YEAR_STOPS: (number | null)[] = [1, 2, 3, 4, null];

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function KeeperVault({ rules }: { rules: KeeperRules }) {
  const { width } = useWindowDimensions();
  const [maxKeepers, setMaxKeepers] = useState(rules.max_keepers);
  const [years, setYears] = useState<number | null>(rules.max_consecutive_years);
  const [deadline, setDeadline] = useState(toLocalInput(rules.keeper_deadline));
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });
  const [lockBusy, setLockBusy] = useState(false);
  const now = useNow(30_000);

  const cellCount = Math.max(6, maxKeepers + 1);
  const cellW = Math.min(52, Math.floor((width - 2 * Spacing.lg - (cellCount - 1) * 6) / cellCount));
  const stops = years === null || YEAR_STOPS.includes(years) ? YEAR_STOPS : [...YEAR_STOPS.slice(0, -1), years, null];
  const dirty = maxKeepers !== rules.max_keepers || years !== rules.max_consecutive_years || deadline !== toLocalInput(rules.keeper_deadline);
  const locked = !!rules.locked_at;

  const deadlineIso = fromLocalInput(deadline);
  const due = deadlineIso && deadlineIso !== 'invalid' ? new Date(deadlineIso) : null;
  const left = due ? due.getTime() - now : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  const led = !due ? 'NO DEADLINE' : left <= 0 ? 'PASSED' : `${pad(Math.floor(left / 86_400_000))} : ${pad(Math.floor((left / 3_600_000) % 24))} : ${pad(Math.floor((left / 60_000) % 60))}`;
  const dueLabel = due
    ? `PICKS DUE · ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()} · ${due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : 'PICKS DUE · NOT SET';

  async function save() {
    if (deadlineIso === 'invalid') {
      setPanel({ status: 'error', message: 'Deadline must look like 2027-08-28 18:00 (or be blank).' });
      return;
    }
    setPanel({ status: 'saving' });
    try {
      const updated = await api.setKeeperRules({ season: rules.season, max_keepers: maxKeepers, max_consecutive_years: years, keeper_deadline: deadlineIso });
      haptics.success();
      queryClient.setQueryData(['keeper-rules'], updated);
      void queryClient.invalidateQueries({ queryKey: ['my-keepers'] });
      setEditingDeadline(false);
      setPanel({ status: 'saved' });
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't save keeper rules.") });
    }
  }

  async function toggleLock(next: boolean) {
    setLockBusy(true);
    haptics.thud();
    try {
      queryClient.setQueryData(['keeper-rules'], await api.setKeepersLocked(rules.season, next));
      void queryClient.invalidateQueries({ queryKey: ['my-keepers'] });
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't change the lock.") });
    } finally {
      setLockBusy(false);
    }
  }

  return (
    <View style={styles.gap}>
      <View style={styles.rule} />
      <View style={styles.center}>
        <Text style={styles.vaultKicker}>{`THE KEEPER VAULT · ${rules.season}`}</Text>
        <View style={styles.keeperRow}>
          {Array.from({ length: cellCount }, (_, i) => i + 1).map((n) => {
            const on = n <= maxKeepers;
            return (
              <HexCell
                key={n}
                w={cellW}
                color={on ? ORANGE : 'rgba(245,244,236,0.14)'}
                fill={on ? '#ff8a2a' : 'rgba(245,244,236,0.05)'}
                label={`${n} keeper${n === 1 ? '' : 's'} per team`}
                onPress={() => {
                  haptics.select();
                  // Tapping the top lit cell again turns it off.
                  setMaxKeepers(n === maxKeepers ? n - 1 : n);
                  setPanel({ status: 'idle' });
                }}>
                <Text style={[styles.keeperNum, { color: on ? '#2a1102' : 'rgba(245,244,236,0.35)' }]}>{n}</Text>
              </HexCell>
            );
          })}
        </View>
        <Text style={styles.muted}>
          {maxKeepers === 0 ? (
            'No keepers this season. Tap a cell to allow some.'
          ) : (
            <>
              Each team keeps up to <Text style={styles.orangeStrong}>{maxKeepers}</Text>. Tap a cell to set it.
            </>
          )}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How long one player can stay</Text>
        <View style={styles.track}>
          <View style={styles.trackLine}>
            <View style={[styles.trackFill, { width: `${(Math.max(0, stops.indexOf(years)) / (stops.length - 1)) * 100}%` }]} />
          </View>
          {stops.map((stop, i) => {
            const on = stops.indexOf(years) >= i;
            const current = stop === years;
            return (
              <Pressable
                key={String(stop)}
                onPress={() => {
                  haptics.select();
                  setYears(stop);
                  setPanel({ status: 'idle' });
                }}
                style={styles.stop}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                accessibilityLabel={stop === null ? 'No cap on years in a row' : `${stop} year${stop === 1 ? '' : 's'} in a row`}>
                <View style={[styles.dot, on && styles.dotOn, current && styles.dotCurrent]} />
                <Text style={[styles.stopLabel, current && styles.stopLabelOn]}>{stop === null ? 'Forever' : stop === 1 ? '1 yr' : `${stop} yrs`}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.ledCard}>
        <Text style={styles.ledLabel}>{dueLabel}</Text>
        <Text style={styles.led}>{led}</Text>
        {due && left > 0 && <Text style={styles.ledUnits}>days · hours · minutes</Text>}
        {editingDeadline ? (
          <TextInput
            value={deadline}
            onChangeText={(v) => {
              setDeadline(v);
              setPanel({ status: 'idle' });
            }}
            placeholder="2027-08-28 18:00"
            placeholderTextColor={Colors.textSecondary}
            autoFocus
            style={styles.deadlineInput}
            accessibilityLabel="Keeper deadline, year-month-day hour:minute"
          />
        ) : (
          <Pressable onPress={() => setEditingDeadline(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{due ? 'Change the deadline' : 'Set a deadline'}</Text>
          </Pressable>
        )}
      </View>

      {(dirty || panel.status === 'saving' || panel.status === 'error') && (
        <Pressable
          onPress={save}
          disabled={panel.status === 'saving'}
          style={({ pressed }) => [styles.saveButton, styles.saveOrange, pressed && styles.pressed]}
          accessibilityRole="button">
          <Text style={styles.saveText}>{panel.status === 'saving' ? 'Saving…' : 'Save keeper rules'}</Text>
        </Pressable>
      )}
      {panel.status !== 'idle' && panel.status !== 'saving' && <StatusText panel={panel} />}

      <View style={styles.lockRow}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{locked ? 'Vault is locked' : 'Vault is open'}</Text>
          <Text style={styles.small}>
            {locked ? `Locked ${new Date(rules.locked_at as string).toLocaleString()}` : 'Owners can still change their keepers'}
          </Text>
        </View>
        <Switch
          value={locked}
          disabled={lockBusy}
          onValueChange={(v) => void toggleLock(v)}
          trackColor={{ false: '#2a313b', true: ORANGE }}
          thumbColor="#f5f4ec"
          ios_backgroundColor="#2a313b"
          accessibilityLabel="Lock keeper picks"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', gap: 6 },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  display: { fontFamily: ANTON, fontSize: 32, letterSpacing: 0.5, color: Colors.text },
  muted: { color: 'rgba(245,244,236,0.7)', fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  strong: { color: Colors.text, fontWeight: '700' },
  orangeStrong: { color: '#ffb27a', fontWeight: '800' },
  small: { color: 'rgba(245,244,236,0.62)', fontSize: 12, lineHeight: 16 },
  note: { padding: 12, borderRadius: 14, backgroundColor: 'rgba(250,204,21,0.08)', borderWidth: 1, borderColor: 'rgba(250,204,21,0.3)' },
  comb: { alignItems: 'center', paddingVertical: 6 },
  combRow: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  hexInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: 6 },
  hexLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  hexCount: { fontFamily: ANTON, fontSize: 28, lineHeight: 32, color: Colors.text },
  hexSub: { fontSize: 9.5, color: 'rgba(245,244,236,0.55)' },
  tray: { gap: 14, padding: 16, borderRadius: 22, backgroundColor: '#141b23', borderWidth: 1, borderColor: 'rgba(57,255,20,0.4)' },
  trayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  trayTitle: { flexShrink: 1, fontFamily: ANTON, fontSize: 21, color: GREEN, letterSpacing: 0.3 },
  steppers: { flexDirection: 'row', gap: 12 },
  stepper: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, backgroundColor: '#0f141b' },
  stepperNote: { justifyContent: 'center', paddingHorizontal: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepButton: { width: 48, height: 48, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { color: Colors.text, fontSize: 22, fontWeight: '600' },
  stepValue: { minWidth: 30, textAlign: 'center', fontFamily: ANTON, fontSize: 34, color: Colors.text },
  saveButton: { minHeight: 50, borderRadius: 14, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  saveOrange: { backgroundColor: ORANGE },
  saveText: { color: '#06110a', fontWeight: '800', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(57,255,20,0.5)' },
  chipText: { color: GREEN, fontWeight: '700', fontSize: 13 },
  rule: { height: 1, marginVertical: 6, backgroundColor: 'rgba(255,122,26,0.45)' },
  vaultKicker: { color: '#ff9a4a', fontSize: 11, fontWeight: '800', letterSpacing: 2.5 },
  keeperRow: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 4 },
  keeperNum: { fontFamily: ANTON, fontSize: 19 },
  card: { gap: 10, padding: 16, borderRadius: 18, backgroundColor: '#141a22', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  cardTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  track: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 },
  trackLine: { position: 'absolute', left: 22, right: 22, top: 13, height: 4, borderRadius: 2, backgroundColor: 'rgba(245,244,236,0.15)' },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: ORANGE },
  stop: { alignItems: 'center', gap: 6, minWidth: 44 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#2a313b' },
  dotOn: { backgroundColor: ORANGE },
  dotCurrent: { borderWidth: 4, borderColor: 'rgba(255,190,140,0.55)' },
  stopLabel: { fontSize: 11, color: 'rgba(245,244,236,0.6)' },
  stopLabelOn: { color: '#ffb27a', fontWeight: '700' },
  ledCard: { alignItems: 'center', gap: 6, padding: 16, borderRadius: 18, backgroundColor: '#07090c', borderWidth: 1, borderColor: 'rgba(255,122,26,0.35)' },
  ledLabel: { color: 'rgba(245,244,236,0.62)', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, textAlign: 'center' },
  led: { fontFamily: ANTON, fontSize: 30, letterSpacing: 2, color: '#ffb27a', textShadowColor: 'rgba(255,122,26,0.8)', textShadowRadius: 10 },
  ledUnits: { color: 'rgba(245,244,236,0.45)', fontSize: 10.5, letterSpacing: 1 },
  link: { color: GREEN, fontSize: 13.5, fontWeight: '600' },
  deadlineInput: { alignSelf: 'stretch', minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: GREEN, color: Colors.text, paddingHorizontal: 12, fontSize: 15, textAlign: 'center' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: '#141a22', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
});
