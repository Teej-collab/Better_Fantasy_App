import { requireOptionalNativeModule } from 'expo';

import type { YourWeek } from '@/lib/types';
import type { MatchupWidgetProps } from '@/widgets/MatchupWidget';

// The home-screen widget arrived in a native build; builds from before it
// get this code over the air without the ExpoWidgets module, and
// expo-widgets throws on import there. So check first and load the
// widget lazily.
export const canUseWidgets = requireOptionalNativeModule('ExpoWidgets') !== null;

export function widgetPropsFor(week: YourWeek | null, now = Date.now()): MatchupWidgetProps {
  const m = week?.matchup ?? null;
  if (!week || !m) {
    return {
      state: 'none', week: week?.week ?? null, myName: '', oppName: '', myScore: 0, oppScore: 0,
      myProjected: 0, oppProjected: 0, myLeft: 0, oppLeft: 0, winProbability: null,
      url: 'weekendleague://', updatedAt: now,
    };
  }
  const myLeft = m.my_yet_to_play + m.my_in_play;
  const oppLeft = m.opponent_yet_to_play + m.opponent_in_play;
  const state: MatchupWidgetProps['state'] = !m.started
    ? 'pre'
    : m.my_in_play + m.opponent_in_play > 0
      ? 'live'
      : myLeft + oppLeft === 0
        ? 'final'
        : 'between';
  return {
    state,
    week: week.week,
    myName: week.team_name,
    oppName: m.opponent_team_name,
    myScore: m.my_score ?? 0,
    oppScore: m.opponent_score ?? 0,
    myProjected: m.my_projected_total,
    oppProjected: m.opponent_projected_total,
    myLeft,
    oppLeft,
    winProbability: m.win_probability,
    url: `weekendleague://matchup/${m.matchup_id}`,
    updatedAt: now,
  };
}

// Skip identical snapshots (the live refetch runs every few seconds) so
// the widget isn't reloaded for nothing; updatedAt is left out of the
// comparison or nothing would ever match.
let lastSignature: string | null = null;

export function updateMatchupWidget(week: YourWeek | null): void {
  if (!canUseWidgets) return;
  const props = widgetPropsFor(week);
  const { updatedAt: _ignored, ...rest } = props;
  const signature = JSON.stringify(rest);
  if (signature === lastSignature) return;
  lastSignature = signature;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const widget = (require('@/widgets/MatchupWidget') as typeof import('@/widgets/MatchupWidget')).default;
    widget.updateSnapshot(props);
  } catch {
    // A widget that can't update just keeps its last snapshot.
  }
}
