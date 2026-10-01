import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, slotDisplayLabel } from '@/lib/rosterSlots';
import type { ChugDeadline, MyKeepers, MyTeam, YourWeek } from '@/lib/types';

// Game-day reminders scheduled on the phone itself (lib/localNotifications.ts):
// no server push needed, so they work on a free Apple account. Built from
// whatever the app last loaded — they're rebuilt every time that data
// changes, so fixing your lineup clears its reminder.

export type ReminderCategory = 'lineup' | 'draft' | 'chug';

export type Reminder = {
  // Stable per thing being reminded about, so a reschedule replaces it.
  key: string;
  category: ReminderCategory;
  at: number; // epoch ms
  title: string;
  body: string;
  url: string;
};

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const LINEUP_LEAD = HOUR;

// Statuses that mean a starter won't play (or likely won't).
const WONT_PLAY = new Set(['out', 'ir', 'injured reserve', 'suspended', 'pup', 'doubtful', 'nfi']);

function wontPlay(status: string | null): boolean {
  return !!status && WONT_PLAY.has(status.trim().toLowerCase());
}

function listIssues(issues: string[]): string {
  const shown = issues.slice(0, 3).join(' · ');
  return issues.length > 3 ? `${shown} · +${issues.length - 3} more` : shown;
}

// "Kickoff in 1 hour" for each game slot where one of your starters won't
// play; a bye or an empty starting slot is flagged before the week's first
// kickoff. Only for the live week, while the lineup can still change.
export function lineupReminders(team: MyTeam | undefined, now: number): Reminder[] {
  if (!team || !team.is_editable || team.week === null || team.week !== team.current_week) return [];
  const starters = team.roster.filter((e) => e.lineup_slot !== BENCH_SLOT_LABEL && e.lineup_slot !== IR_SLOT_LABEL);
  const kickoffs = team.roster
    .map((e) => (e.game_time ? new Date(e.game_time).getTime() : NaN))
    .filter((t) => !Number.isNaN(t) && t > now);
  const firstKickoff = kickoffs.length ? Math.min(...kickoffs) : null;

  const byTime = new Map<number, string[]>();
  const add = (kickoff: number | null, issue: string) => {
    if (kickoff === null) return;
    const at = kickoff - LINEUP_LEAD;
    if (at <= now) return;
    byTime.set(at, [...(byTime.get(at) ?? []), issue]);
  };

  for (const e of starters) {
    if (e.is_locked) continue;
    const kickoff = e.game_time ? new Date(e.game_time).getTime() : null;
    if (!e.next_opponent && !e.game_time) add(firstKickoff, `${e.player_name} is on bye`);
    else if (wontPlay(e.injury_status)) add(kickoff, `${e.player_name} is ${e.injury_status}`);
  }

  if (team.roster_slots) {
    for (const [slot, count] of Object.entries(team.roster_slots)) {
      if (slot === BENCH_SLOT_LABEL || slot === IR_SLOT_LABEL) continue;
      const filled = starters.filter((e) => e.lineup_slot === slot).length;
      if (filled < count) add(firstKickoff, `Empty ${slotDisplayLabel(slot)} slot`);
    }
  }

  return [...byTime.entries()].map(([at, issues]) => ({
    key: `lineup-${team.week}-${at}`,
    category: 'lineup',
    at,
    title: '🏈 Kickoff in 1 hour — check your lineup',
    body: listIssues(issues),
    url: '/team',
  }));
}

export function draftReminders(myWeek: YourWeek | undefined, now: number): Reminder[] {
  const draft = myWeek?.draft;
  if (!draft?.scheduled_start || draft.status !== 'not_started') return [];
  const start = new Date(draft.scheduled_start).getTime();
  return [
    { lead: HOUR, label: '1 hour' },
    { lead: 10 * MINUTE, label: '10 minutes' },
  ]
    .map(({ lead, label }) => ({
      key: `draft-${start}-${lead}`,
      category: 'draft' as const,
      at: start - lead,
      title: `📋 The draft starts in ${label}`,
      body: 'Set your queue now so you’re ready when you’re on the clock.',
      url: '/draft',
    }))
    .filter((r) => r.at > now);
}

// Only while keepers are open and you haven't picked any yet.
export function keeperReminders(keepers: MyKeepers | undefined, now: number): Reminder[] {
  const rules = keepers?.rules;
  if (!rules?.is_open || rules.locked_at || !rules.keeper_deadline || (keepers?.selections.length ?? 0) > 0) return [];
  const deadline = new Date(rules.keeper_deadline).getTime();
  return [
    { lead: 24 * HOUR, label: 'tomorrow' },
    { lead: HOUR, label: 'in 1 hour' },
  ]
    .map(({ lead, label }) => ({
      key: `keepers-${deadline}-${lead}`,
      category: 'draft' as const,
      at: deadline - lead,
      title: `🔒 Keeper picks are due ${label}`,
      body: "You haven't picked your keepers yet.",
      url: '/keepers',
    }))
    .filter((r) => r.at > now);
}

export function chugReminders(chug: ChugDeadline | null | undefined, now: number): Reminder[] {
  if (!chug?.deadline || chug.is_past) return [];
  const deadline = new Date(chug.deadline).getTime();
  const at = deadline - 2 * HOUR;
  if (at <= now) return [];
  return [
    {
      key: `chug-${deadline}`,
      category: 'chug',
      at,
      title: "🍺 Jeffrey's Rule: chug deadline in 2 hours",
      body: 'Get your chug posted before the deadline.',
      url: '/chug',
    },
  ];
}
