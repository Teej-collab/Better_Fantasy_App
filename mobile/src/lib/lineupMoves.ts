import type { LineupChange } from '@/lib/queries';
import {
  BENCH_SLOT_LABEL,
  IR_SLOT_LABEL,
  isEligibleForSlot,
  lineupOptions,
  STARTER_SLOT_ORDER,
  TAXI_SLOT_LABEL,
} from '@/lib/rosterSlots';
import type { RosterEntry } from '@/lib/types';

// The rules behind My Team's lineup editing (2026-10-22, lineup moves
// mockups A + E with B's drag): where a player can go, what each move
// does to the lineup's projection, and the moves worth suggesting.

const OUT = new Set(['OUT', 'O', 'IR', 'PUP', 'NA', 'SUSP', 'DNR', 'COV']);

export function isStarterSlot(slot: string): boolean {
  return slot !== BENCH_SLOT_LABEL && slot !== IR_SLOT_LABEL && slot !== TAXI_SLOT_LABEL;
}

/** What a player is expected to score this week: nothing on a bye or ruled out. */
export function projection(e: RosterEntry): number {
  if (e.on_bye) return 0;
  if (e.injury_status && OUT.has(e.injury_status.trim().toUpperCase())) return 0;
  return e.live_projected ?? e.points_projected ?? 0;
}

/** A spot a moving player can go: another player to swap with, or an open slot. */
export type MoveTarget = {
  key: string; // the other player's id, `empty:<slot>`, or `bench`
  change: LineupChange;
  // The lineup's projection after the move, minus before.
  delta: number;
};

export function changeDelta(change: LineupChange): number {
  const p = change.player;
  if (change.kind === 'move') {
    return (isStarterSlot(change.toSlot) ? projection(p) : 0) - (isStarterSlot(p.lineup_slot) ? projection(p) : 0);
  }
  const o = change.other;
  const pStarts = isStarterSlot(p.lineup_slot);
  const oStarts = isStarterSlot(o.lineup_slot);
  return (oStarts ? projection(p) : 0) + (pStarts ? projection(o) : 0) - (pStarts ? projection(p) : 0) - (oStarts ? projection(o) : 0);
}

/**
 * Every legal place `entry` can go. lineupOptions (the backend's rules)
 * covers his own eligible slots; a starter also lights up every unlocked
 * bench player who can fill his spot, since swapping them is the same
 * move from the other side.
 */
export function moveTargets(entry: RosterEntry, roster: RosterEntry[], rosterSlots: Record<string, number>): MoveTarget[] {
  const targets = new Map<string, MoveTarget>();
  const add = (key: string, change: LineupChange) => {
    if (!targets.has(key)) targets.set(key, { key, change, delta: changeDelta(change) });
  };
  for (const option of lineupOptions(entry, roster, rosterSlots)) {
    if (option.occupant?.player_id === entry.player_id) continue;
    if (option.occupant) add(option.occupant.player_id, { kind: 'swap', player: entry, other: option.occupant });
    else if (option.slot === BENCH_SLOT_LABEL) add('bench', { kind: 'move', player: entry, toSlot: BENCH_SLOT_LABEL });
    else add(`empty:${option.slot}`, { kind: 'move', player: entry, toSlot: option.slot });
  }
  if (isStarterSlot(entry.lineup_slot)) {
    for (const other of roster) {
      if (other.lineup_slot !== BENCH_SLOT_LABEL || other.is_locked) continue;
      if (isEligibleForSlot(other.position, entry.lineup_slot)) add(other.player_id, { kind: 'swap', player: entry, other });
    }
  }
  return [...targets.values()];
}

/** Starter slots with room left, one entry per open spot, in lineup order. */
export function openStarterSlots(roster: RosterEntry[], rosterSlots: Record<string, number>): string[] {
  const open: string[] = [];
  for (const slot of STARTER_SLOT_ORDER) {
    const room = (rosterSlots[slot] ?? 0) - roster.filter((r) => r.lineup_slot === slot).length;
    for (let i = 0; i < room; i++) open.push(slot);
  }
  return open;
}

/** The roster as it stands after `change` (the instant, before-the-server version). */
export function applyChange(roster: RosterEntry[], change: LineupChange): RosterEntry[] {
  if (change.kind === 'move') {
    return roster.map((r) => (r.player_id === change.player.player_id ? { ...r, lineup_slot: change.toSlot } : r));
  }
  const a = roster.find((r) => r.player_id === change.player.player_id);
  const b = roster.find((r) => r.player_id === change.other.player_id);
  if (!a || !b) return roster;
  return roster.map((r) =>
    r.player_id === a.player_id ? { ...r, lineup_slot: b.lineup_slot } : r.player_id === b.player_id ? { ...r, lineup_slot: a.lineup_slot } : r,
  );
}

/** The change that puts things back (for Undo), given the roster before it. */
export function undoChange(change: LineupChange): LineupChange {
  if (change.kind === 'swap') return change;
  return { kind: 'move', player: { ...change.player, lineup_slot: change.toSlot }, toSlot: change.player.lineup_slot };
}

export type Advice = { change: LineupChange; delta: number; reason: string };

function why(e: RosterEntry): string | null {
  if (e.on_bye) return 'on a bye';
  const s = e.injury_status?.trim().toUpperCase();
  if (s && OUT.has(s)) return 'ruled out';
  if (s === 'Q' || s === 'QUESTIONABLE') return 'questionable';
  if (s === 'D' || s === 'DOUBTFUL') return 'doubtful';
  return null;
}

const fmt = (n: number) => n.toFixed(1);

/**
 * Up to three bench-for-starter moves that each raise the lineup's
 * projection by at least a point, best first, no player used twice.
 */
export function lineupAdvice(roster: RosterEntry[], rosterSlots: Record<string, number>): Advice[] {
  const candidates: Advice[] = [];
  const bench = roster.filter((r) => r.lineup_slot === BENCH_SLOT_LABEL && !r.is_locked);
  for (const b of bench) {
    for (const s of roster) {
      if (!isStarterSlot(s.lineup_slot) || s.is_locked || !isEligibleForSlot(b.position, s.lineup_slot)) continue;
      const change: LineupChange = { kind: 'swap', player: b, other: s };
      const reason = why(s);
      candidates.push({
        change,
        delta: changeDelta(change),
        // Out or on a bye scores nothing, so the reason is the number;
        // questionable keeps the projection and says why it's shaky.
        reason: `${b.player_name} (${fmt(projection(b))}) over ${s.player_name} (${
          reason && projection(s) === 0 ? reason : reason ? `${fmt(projection(s))}, ${reason}` : fmt(projection(s))
        })`,
      });
    }
    for (const slot of new Set(openStarterSlots(roster, rosterSlots))) {
      if (!isEligibleForSlot(b.position, slot)) continue;
      const change: LineupChange = { kind: 'move', player: b, toSlot: slot };
      candidates.push({ change, delta: changeDelta(change), reason: `${b.player_name} (${fmt(projection(b))}) into your open ${slot} spot` });
    }
  }
  const picked: Advice[] = [];
  const used = new Set<string>();
  const filled = new Map<string, number>();
  for (const c of candidates.sort((x, y) => y.delta - x.delta)) {
    if (c.delta < 1 || picked.length >= 3) break;
    const ids = [c.change.player.player_id, ...(c.change.kind === 'swap' ? [c.change.other.player_id] : [])];
    if (ids.some((id) => used.has(id))) continue;
    if (c.change.kind === 'move') {
      const slot = c.change.toSlot;
      const open = openStarterSlots(roster, rosterSlots).filter((s) => s === slot).length;
      if ((filled.get(slot) ?? 0) >= open) continue;
      filled.set(slot, (filled.get(slot) ?? 0) + 1);
    }
    ids.forEach((id) => used.add(id));
    picked.push(c);
  }
  return picked;
}
