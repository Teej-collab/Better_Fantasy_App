// Mirrors backend/app/domain/roster_slots.py's eligibility rules — kept
// in sync by hand since it's a small, stable, league-specific mapping
// (QB/RB/WR/TE/K/DEF -> this league's real slot labels), not worth a
// round-trip to the backend just to check "can this player go here."
const POSITION_TO_SLOT_LABEL: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "D/ST" };
const FLEX_ELIGIBLE_POSITIONS = new Set(["RB", "WR", "TE"]);
export const FLEX_SLOT_LABEL = "RB/WR/TE";
export const BENCH_SLOT_LABEL = "BE";
export const IR_SLOT_LABEL = "IR";

// Sleeper's own injury_status values that mean a player is out long
// enough to stash on IR — mirrors backend/app/domain/roster_slots.py's
// IR_ELIGIBLE_INJURY_STATUSES. "Questionable"/"Doubtful" are
// deliberately excluded — those players might still play this week.
const IR_ELIGIBLE_INJURY_STATUSES = new Set(["IR", "PUP", "OUT", "NA", "COV", "DNR"]);

export function isIrEligible(injuryStatus: string | null | undefined): boolean {
  return !!injuryStatus && IR_ELIGIBLE_INJURY_STATUSES.has(injuryStatus.trim().toUpperCase());
}

export function isEligibleForSlot(position: string, slotLabel: string, injuryStatus?: string | null): boolean {
  if (slotLabel === BENCH_SLOT_LABEL) return true;
  if (slotLabel === IR_SLOT_LABEL) return isIrEligible(injuryStatus);
  if (slotLabel === FLEX_SLOT_LABEL) return FLEX_ELIGIBLE_POSITIONS.has(position);
  return POSITION_TO_SLOT_LABEL[position] === slotLabel;
}

// Two players can trade places iff each is actually eligible for the
// slot the other currently occupies.
export function canSwapSlots(
  positionA: string, slotA: string, positionB: string, slotB: string,
  injuryStatusA?: string | null, injuryStatusB?: string | null,
): boolean {
  return isEligibleForSlot(positionA, slotB, injuryStatusA) && isEligibleForSlot(positionB, slotA, injuryStatusB);
}

// ESPN's own starter display order — QB, RB, RB, WR, WR, TE, FLEX,
// D/ST, K.
export const STARTER_SLOT_ORDER = ["QB", "RB", "WR", "TE", FLEX_SLOT_LABEL, "D/ST", "K"];

export function starterSortIndex(slotLabel: string): number {
  const i = STARTER_SLOT_ORDER.indexOf(slotLabel);
  return i === -1 ? STARTER_SLOT_ORDER.length : i;
}

// Display-only shorthand for the roster row pill — never changes the
// underlying slot value used for eligibility/swap logic above, just
// how it reads (matches the short "FLEX" label the Sleeper app itself
// uses instead of the internal "RB/WR/TE" value).
export function slotDisplayLabel(slotLabel: string): string {
  return slotLabel === FLEX_SLOT_LABEL ? "FLEX" : slotLabel;
}
