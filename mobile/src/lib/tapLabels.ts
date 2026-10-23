// Plain-English names for Admin > Taps (2026-10-22). A tap target is
// either a named tap (trackTap in the app) or `do.<path>`, a change made
// through the API (api.ts's actionTarget). Unknown ones still read fine.
// Same list as the web's frontend/src/lib/tapLabels.ts.

const NAMED: Record<string, string> = {
  'matchup.pregame_open': 'Read a pre-game write-up',
  'matchup.recap_open': 'Read a matchup recap',
  'player.open': 'Opened a player card',
  'lineup.tap_move': 'Moved a player (tap)',
  'lineup.drag_move': 'Moved a player (drag)',
  'lineup.drag_cancel': 'Started a drag, let go',
  'lineup.advice_apply': 'Took the lineup advice',
  'lineup.advice_dismiss': 'Skipped the lineup advice',
  'lineup.undo': 'Undid a lineup move',
  'league.swipe_back': 'Swiped back to the League hub',
  'chat.send': 'Sent a chat message',
  'chat.send_reply': 'Sent a chat reply',
  'chat.reply': 'Tapped Reply on a message',
  'chat.swipe_reply': 'Swiped to reply',
  'chat.react': 'Reacted to a message',
  'chat.copy': 'Copied a message',
  'chat.gif': 'Sent a GIF',
  'chat.attach': 'Tapped attach photo/video',
  'do.me.team.lineup.move': 'Lineup: moved a player',
  'do.me.team.lineup.swap': 'Lineup: swapped two players',
  'do.me.team.lineup.drop': 'Dropped a player',
  'do.me.team.waivers.claim': 'Put in a waiver claim',
  'do.me.team.waivers': 'Added a free agent',
  'do.trades': 'Proposed a trade',
  'do.trades.accept': 'Accepted a trade',
  'do.trades.reject': 'Declined a trade',
  'do.trades.cancel': 'Withdrew a trade offer',
  'do.trades.block': 'Put a player on the trade block',
  'do.delete.trades.block': 'Took a player off the trade block',
  'trades.build': 'Opened the trade builder',
  'trades.counter': 'Started a counter offer',
  'trades.suggestion': 'Took the trade builder suggestion',
  'do.bets': 'Logged a bet',
  'do.bets.league.bets.tail': 'Tailed a bet',
  'do.punishment-wheel.spin': 'Spun the punishment wheel',
  'do.punishment-wheel.items': 'Added a punishment',
  'do.feedback': 'Sent feedback',
  'do.edit.settings.preferences': 'Changed a setting',
};

function words(s: string): string {
  return s.replace(/[_-]+/g, ' ');
}

export function tapLabel(target: string): string {
  if (NAMED[target]) return NAMED[target];
  if (target.startsWith('league_hub.')) return `League hub: ${words(target.slice(11))}`;
  if (target.startsWith('do.delete.')) return `Removed: ${words(target.slice(10)).split('.').join(' › ')}`;
  if (target.startsWith('do.edit.')) return `Changed: ${words(target.slice(8)).split('.').join(' › ')}`;
  if (target.startsWith('do.')) return `Did: ${words(target.slice(3)).split('.').join(' › ')}`;
  return words(target).split('.').join(' › ');
}

/** "nav_power_rankings" -> "power rankings" */
export function screenLabel(eventName: string): string {
  return words(eventName.replace(/^nav_/, ''));
}
