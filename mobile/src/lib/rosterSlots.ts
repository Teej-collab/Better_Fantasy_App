// Copied from frontend/src/lib/rosterSlots.ts, which mirrors
// backend/app/domain/roster_slots.py's eligibility rules. Keep all
// three in sync: anything offered here that the backend disagrees with
// just comes back as an error.
import type { RosterEntry } from '@/lib/types';

const POSITION_TO_SLOT_LABEL: Record<string, string> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'D/ST' };
const FLEX_ELIGIBLE_POSITIONS = new Set(['RB', 'WR', 'TE']);
export const FLEX_SLOT_LABEL = 'RB/WR/TE';
export const BENCH_SLOT_LABEL = 'BE';
export const IR_SLOT_LABEL = 'IR';

// Out long enough to stash on IR. Questionable/Doubtful are excluded —
// those players might still play this week.
const IR_ELIGIBLE_INJURY_STATUSES = new Set(['IR', 'PUP', 'OUT', 'NA', 'COV', 'DNR']);

export function isIrEligible(injuryStatus: string | null | undefined): boolean {
  return !!injuryStatus && IR_ELIGIBLE_INJURY_STATUSES.has(injuryStatus.trim().toUpperCase());
}

export function isEligibleForSlot(position: string, slotLabel: string, injuryStatus?: string | null): boolean {
  if (slotLabel === BENCH_SLOT_LABEL) return true;
  if (slotLabel === IR_SLOT_LABEL) return isIrEligible(injuryStatus);
  if (slotLabel === FLEX_SLOT_LABEL) return FLEX_ELIGIBLE_POSITIONS.has(position);
  return POSITION_TO_SLOT_LABEL[position] === slotLabel;
}

// ESPN's starter display order.
export const STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', FLEX_SLOT_LABEL, 'D/ST', 'K'];

export function starterSortIndex(slotLabel: string): number {
  const i = STARTER_SLOT_ORDER.indexOf(slotLabel);
  return i === -1 ? STARTER_SLOT_ORDER.length : i;
}

export function slotDisplayLabel(slotLabel: string): string {
  return slotLabel === FLEX_SLOT_LABEL ? 'FLEX' : slotLabel;
}

export type LineupOption = { slot: string; occupant: RosterEntry | null };

// Every destination `entry` could move to right now: each open or
// occupied slot across its eligible starter positions, the bench, and
// IR when eligible. Same capacity rules as frontend/src/components/
// MyTeamApp.tsx's editLineupOptions and the backend's lineup_engine.
// Locked occupants are left out, since a swap with them always fails.
// Includes entry's own current slot so the sheet can mark it.
export function lineupOptions(
  entry: RosterEntry,
  roster: RosterEntry[],
  rosterSlots: Record<string, number>,
): LineupOption[] {
  const options: LineupOption[] = [];
  const addSlot = (slot: string) => {
    const occupants = roster.filter((r) => r.lineup_slot === slot);
    for (const occupant of occupants) if (!occupant.is_locked || occupant.player_id === entry.player_id) options.push({ slot, occupant });
    if (occupants.length < (rosterSlots[slot] ?? 0)) options.push({ slot, occupant: null });
  };
  for (const slot of STARTER_SLOT_ORDER) if (isEligibleForSlot(entry.position, slot)) addSlot(slot);
  options.push(
    entry.lineup_slot === BENCH_SLOT_LABEL ? { slot: BENCH_SLOT_LABEL, occupant: entry } : { slot: BENCH_SLOT_LABEL, occupant: null },
  );
  if (isIrEligible(entry.injury_status)) addSlot(IR_SLOT_LABEL);
  return options;
}
