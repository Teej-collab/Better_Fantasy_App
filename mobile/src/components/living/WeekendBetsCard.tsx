import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip, Kicker, Panel } from '@/components/living/LivingCards';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import { formatOdds, formatStat, legPick } from '@/lib/bets';
import { formatGameTime } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import type { Bet, BetLeg, NflGame } from '@/lib/types';

// Your bets for the weekend (2026-10-15, mockup on the Living Home
// Screen canvas): Thursday morning to Monday night, on every living
// home mood. Live bets with their progress, settled ones with what they
// won or lost, the rest with their kickoff. Only you ever see the money.

const ACCENT = '#f5b942';
const WON = '#39ff14';
const LOST = '#ff7a7a';
const LIVE = '#ff8080';
const MAX_ROWS = 6;

type Kind = 'live' | 'upcoming' | 'settled';

function legGame(leg: BetLeg, games: Map<string, NflGame>): NflGame | null {
  return leg.espn_event_id ? games.get(leg.espn_event_id) ?? null : null;
}

function betKind(bet: Bet, games: Map<string, NflGame>): Kind {
  if (bet.status !== 'open') return 'settled';
  const open = bet.legs.filter((l) => l.status === 'open');
  // An open bet whose games are all over is waiting on the final grade.
  return open.some((l) => (legGame(l, games)?.state ?? l.game?.state) !== 'pre') ? 'live' : 'upcoming';
}

function nextKickoff(bet: Bet, games: Map<string, NflGame>): number {
  const times = bet.legs
    .filter((l) => l.status === 'open')
    .map((l) => legGame(l, games)?.date)
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime());
  return times.length ? Math.min(...times) : Number.MAX_SAFE_INTEGER;
}

// What a settled bet made or cost; null when the money wasn't entered.
function result(bet: Bet): number | null {
  if (bet.status === 'push' || bet.status === 'void') return 0;
  if (bet.stake == null) return null;
  if (bet.status === 'lost') return -bet.stake;
  return bet.payout != null ? bet.payout - bet.stake : null;
}

function money(n: number): string {
  return `$${Math.abs(n) % 1 === 0 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(2)}`;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(n)}`;
}

function title(bet: Bet): string {
  if (bet.legs.length > 1) return `${bet.legs.length}-leg parlay${bet.odds_american != null ? ` · ${formatOdds(bet.odds_american)}` : ''}`;
  const leg = bet.legs[0];
  if (!leg) return 'Bet';
  return leg.player_name && leg.market === 'player_prop' ? `${leg.player_name} ${legPick(leg).toLowerCase()}` : legPick(leg);
}

function scoreLine(g: NflGame): string {
  return `${g.away_team ?? ''} ${g.away_score ?? ''}, ${g.home_team ?? ''} ${g.home_score ?? ''}`.trim();
}

// This weekend's bets: anything on this week's games, plus any still
// open that the app can't tie to a game.
export function weekendBets(bets: Bet[], games: NflGame[]): Bet[] {
  const ids = new Set(games.map((g) => g.id));
  return bets.filter((b) => {
    const tied = b.legs.filter((l) => l.espn_event_id);
    if (tied.length === 0) return b.status === 'open';
    return tied.some((l) => ids.has(l.espn_event_id!));
  });
}

export function WeekendBetsCard({ bets, games, enabled }: { bets: Bet[]; games: NflGame[]; enabled: boolean }) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const mine = weekendBets(bets, games);
  // Bet tracking off in Settings: no card at all.
  if (!enabled) return null;
  if (mine.length === 0) {
    return (
      <Panel tint={ACCENT}>
        <View style={styles.headText}>
          <Kicker color={ACCENT}>Your bets · this weekend</Kicker>
          <Text style={styles.headline}>No bets this weekend yet</Text>
          <Text style={styles.small}>Screenshot a slip from your sportsbook and it tracks here live, through Monday night.</Text>
        </View>
        <BetButtons more={0} />
      </Panel>
    );
  }

  const kinds = new Map(mine.map((b) => [b.id, betKind(b, byId)]));
  const live = mine.filter((b) => kinds.get(b.id) === 'live');
  const upcoming = mine.filter((b) => kinds.get(b.id) === 'upcoming').sort((a, b) => nextKickoff(a, byId) - nextKickoff(b, byId));
  const settled = mine.filter((b) => kinds.get(b.id) === 'settled');
  const wins = settled.filter((b) => b.status === 'won').length;
  const losses = settled.filter((b) => b.status === 'lost').length;
  const open = [...live, ...upcoming];
  const riding = open.reduce((sum, b) => sum + (b.stake ?? 0), 0);
  const toWin = open.reduce((sum, b) => sum + (b.payout != null && b.stake != null ? b.payout - b.stake : 0), 0);
  const results = settled.map(result).filter((n): n is number => n !== null);
  const net = results.reduce((sum, n) => sum + n, 0);

  const parts = settled.length > 0 ? [`${wins}–${losses} so far`] : [];
  if (live.length) parts.push(`${live.length} live`);
  if (upcoming.length) parts.push(settled.length || live.length ? `${upcoming.length} to come` : `${upcoming.length} open`);
  const first = upcoming[0] ? nextKickoff(upcoming[0], byId) : null;
  const headline =
    settled.length === 0 && live.length === 0 && first !== null && first !== Number.MAX_SAFE_INTEGER
      ? `${parts.join(' · ')} · first one ${formatGameTime(new Date(first).toISOString())}`
      : parts.join(' · ');

  const rows = [...live, ...upcoming, ...settled].slice(0, MAX_ROWS);
  const more = mine.length - rows.length;

  return (
    <Panel tint={ACCENT}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Kicker color={ACCENT}>Your bets · this weekend</Kicker>
          <Text style={styles.headline}>{headline}</Text>
        </View>
        {results.length > 0 ? (
          <View style={styles.headMoney}>
            <Display style={[styles.big, { color: net > 0 ? WON : net < 0 ? LOST : Colors.text }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.1}>
              {signed(net)}
            </Display>
            <Text style={styles.small}>net so far</Text>
          </View>
        ) : riding > 0 ? (
          <View style={styles.headMoney}>
            <Display style={styles.big} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.1}>
              {money(riding)}
            </Display>
            <Text style={styles.small}>riding{toWin > 0 ? ` · to win ${money(toWin)}` : ''}</Text>
          </View>
        ) : null}
      </View>

      {rows.map((b) => (
        <BetRow key={b.id} bet={b} kind={kinds.get(b.id)!} games={byId} />
      ))}

      <BetButtons more={more} />
    </Panel>
  );
}

function BetButtons({ more }: { more: number }) {
  return (
    <View style={styles.buttons}>
      <Pressable
        onPress={() => {
          haptics.tap();
          router.push('/bets/add');
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, styles.buttonPrimary, pressed && styles.pressed]}>
        <Text style={[styles.buttonText, { color: Colors.bg }]}>Add a bet slip</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          haptics.tap();
          router.push('/bets');
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>{more > 0 ? `All bets (+${more})` : 'All bets'}</Text>
      </Pressable>
    </View>
  );
}

function BetRow({ bet, kind, games }: { bet: Bet; kind: Kind; games: Map<string, NflGame> }) {
  const parlay = bet.legs.length > 1;
  const openLegs = bet.legs.filter((l) => l.status === 'open');
  const liveLeg = openLegs.find((l) => legGame(l, games)?.state === 'in') ?? openLegs[0] ?? null;
  const liveGame = liveLeg ? legGame(liveLeg, games) : null;

  let chip: { text: string; color: string };
  if (kind === 'live') {
    const detail = liveGame?.state === 'in' ? liveGame.status_detail : liveGame?.state === 'post' ? 'Settling' : null;
    chip = { text: detail ? `Live · ${detail}` : 'Live', color: LIVE };
  } else if (kind === 'upcoming') {
    const t = nextKickoff(bet, games);
    chip = { text: t === Number.MAX_SAFE_INTEGER ? 'Open' : formatGameTime(new Date(t).toISOString()), color: Colors.textSecondary };
  } else {
    const r = result(bet);
    const label = { won: 'Won', lost: 'Lost', push: 'Push', void: 'Void', cashed_out: 'Cashed out', open: 'Open' }[bet.status];
    chip = {
      text: r !== null && r !== 0 ? `${label} ${signed(r)}` : label,
      color: bet.status === 'won' ? WON : bet.status === 'lost' ? LOST : Colors.textSecondary,
    };
  }

  // One straight player prop in a live game: a progress bar.
  const single = !parlay ? bet.legs[0] : null;
  const showBar = kind === 'live' && single && single.market === 'player_prop' && single.tracked && single.current !== null && single.target;
  const pct = showBar ? Math.max(0, Math.min(1, single!.current! / single!.target!)) : 0;
  const hit = bet.legs.filter((l) => l.status === 'won').length;

  let sub: string | null = null;
  if (showBar) {
    const need = single!.target! - single!.current!;
    const unit = single!.stat_label ? ` ${single!.stat_label.toLowerCase()}` : '';
    sub = `${formatStat(single!.current!)} of ${formatStat(single!.target!)}${unit}${need > 0 && single!.direction !== 'under' ? ` · needs ${formatStat(need)}` : ''}`;
  } else if (parlay && kind !== 'settled') {
    const next = liveLeg ? `${liveLeg.player_name ? `${liveLeg.player_name} ` : ''}${legPick(liveLeg).toLowerCase()}` : null;
    sub = `${hit} of ${bet.legs.length} hit${next ? ` · next: ${next}` : ''}`;
  } else if (kind === 'settled') {
    const g = bet.legs.map((l) => legGame(l, games)).find((x) => x?.state === 'post');
    sub = g && !parlay ? `Final · ${scoreLine(g)}` : parlay ? `${hit} of ${bet.legs.length} legs hit` : null;
  } else if (kind === 'upcoming' && single?.espn_event_id) {
    const g = legGame(single, games);
    sub = g ? `${g.away_team} @ ${g.home_team}` : null;
  }
  const toWin = kind !== 'settled' && bet.payout != null && bet.stake != null ? bet.payout - bet.stake : null;

  return (
    <View style={styles.row} accessible accessibilityLabel={`${title(bet)}. ${chip.text}.${sub ? ` ${sub}.` : ''}`}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title(bet)}
        </Text>
        <Chip color={chip.color}>{chip.text}</Chip>
      </View>
      {showBar && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: single!.direction === 'under' ? '#ff8a3d' : ACCENT }]} />
        </View>
      )}
      {parlay && kind !== 'settled' && (
        <View style={styles.legs}>
          {bet.legs.map((l) => (
            <View
              key={l.id}
              style={[
                styles.leg,
                { backgroundColor: l.status === 'won' ? WON : l.status === 'lost' ? LOST : l.status === 'open' ? withAlpha(ACCENT, 0.35) : Colors.textSecondary },
              ]}
            />
          ))}
        </View>
      )}
      {(sub || toWin !== null) && (
        <View style={styles.rowTop}>
          <Text style={styles.small} numberOfLines={1}>
            {sub ?? ''}
          </Text>
          {toWin !== null && toWin > 0 && <Text style={styles.small}>to win {money(toWin)}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  headline: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  headMoney: { alignItems: 'flex-end', flexShrink: 0, maxWidth: '45%' },
  big: { color: Colors.text, fontSize: 26, lineHeight: 28 },
  small: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
  row: { gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowTitle: { color: Colors.text, fontSize: 14, fontWeight: '600', flex: 1, minWidth: 0 },
  track: { height: 6, borderRadius: 99, backgroundColor: '#262d3a', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },
  legs: { flexDirection: 'row', gap: 4 },
  leg: { flex: 1, height: 6, borderRadius: 99 },
  buttons: { flexDirection: 'row', gap: Spacing.sm, paddingTop: 4 },
  button: { flex: 1, minHeight: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  buttonPrimary: { backgroundColor: ACCENT },
  buttonSecondary: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  buttonText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
