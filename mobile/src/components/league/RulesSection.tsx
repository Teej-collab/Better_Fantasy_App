import { router, type Href } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { formatSummary, LEAGUE_TYPES } from '@/lib/leagueFormat';
import { useActiveLeagueName, useHouseRules, useMe, usePlayoffSettings, usePunishmentWheel } from '@/lib/queries';

// The 2026 Official Rulebook, word for word from the web's
// frontend/src/app/(app)/rules/page.tsx. Keep the two in sync when the
// commissioner changes a rule.

const TOC = [
  { id: 'structure', emoji: '💰', title: 'League Structure & Payouts' },
  { id: 'engagement', emoji: '🗣️', title: 'Engagement Expectation' },
  { id: 'keeper', emoji: '🏷️', title: 'Keeper / Franchise Tag' },
  { id: 'draft-order', emoji: '🏈', title: 'Draft Order Determination' },
  { id: 'jeffreys-rule', emoji: '🍺', title: "Jeffrey's Rule" },
  { id: 'sweaty-parlay', emoji: '🎰', title: 'The Sweaty Parlay Rule' },
  { id: 'trash-talk', emoji: '🎥', title: 'Weekly Trash Talk' },
  { id: 'kings-cup', emoji: '👑', title: "King's Cup Rule" },
  { id: 'scoring', emoji: '🏈', title: '2026 Scoring Adoptions' },
  { id: 'tiebreakers', emoji: '🏆', title: 'Playoff Tiebreakers' },
  { id: 'bowl-games', emoji: '🏟️', title: 'Week 18 Bowl Games' },
  { id: 'kitty', emoji: '💰', title: 'League Kitty' },
  { id: 'future', emoji: '📈', title: 'Future Considerations' },
  { id: 'commissioner', emoji: '⚖️', title: 'Commissioner Clause' },
];

// The written rulebook above is League #1's own (buy-in, payouts, the
// Wheel of Punishment...). Every other league gets rules built from its
// own settings instead (2026-10) — never another league's house rules.
const ORIGINAL_LEAGUE_ID = 1;

export function RulesSection({ scrollTo }: { scrollTo: (y: number) => void }) {
  const me = useMe().data;
  // The rulebook's contents measure positions inside this wrapper; add
  // the wrapper's own offset so its jumps still land.
  const base = useRef(0);
  return (
    <View style={styles.page} onLayout={(e) => (base.current = e.nativeEvent.layout.y)}>
      <WheelCard />
      {me?.active_league_id === ORIGINAL_LEAGUE_ID ? (
        <OfficialRulebook scrollTo={(y) => scrollTo(base.current + y)} />
      ) : (
        <LeagueSettingsRules />
      )}
    </View>
  );
}

// This season's Punishment Wheel result, or the invitation to watch the
// wheel before it's spun (app/punishment-wheel.tsx).
function WheelCard() {
  const wheel = usePunishmentWheel().data;
  if (!wheel || (!wheel.result && wheel.items.length === 0 && !wheel.is_commissioner)) return null;
  return (
    <Pressable onPress={() => router.push('/punishment-wheel' as Href)} style={({ pressed }) => [styles.wheelCard, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={styles.wheelKicker}>{`🎡 ${wheel.season} PUNISHMENT WHEEL`}</Text>
      <Text style={styles.wheelText}>{wheel.result ? wheel.result.text : wheel.items.length ? `${wheel.items.length} on the wheel — not spun yet` : 'Fill the wheel, then spin it'}</Text>
      <Text style={styles.wheelMeta}>{wheel.result ? 'The league loser owes it · tap to watch the spin' : 'Tap to see the wheel'}</Text>
    </Pressable>
  );
}

function LeagueSettingsRules() {
  const me = useMe().data;
  const format = me?.league_format;
  const playoffs = usePlayoffSettings().data;
  const houseRules = useHouseRules().data;
  const leagueName = useActiveLeagueName().data;
  const noop = () => {};
  const type = format ? LEAGUE_TYPES.find((t) => t.key === format.league_type) : undefined;
  return (
    <View style={styles.page}>
      <View style={styles.titleBlock}>
        <Display style={styles.title}>League Rules</Display>
        <Text style={styles.muted}>{leagueName ?? 'Your league'}</Text>
      </View>
      {format && (
        <Section onMeasure={noop} id="format" emoji="🏈" title="Format">
          <P bold>{formatSummary(format)}</P>
          {type && <P soft>{type.text}</P>}
          <Bullets
            items={[
              format.matchup_type === 'points' ? 'Standings rank by total points scored.' : 'Each week you play one opponent; the higher score wins.',
              format.draft_type === 'auction' ? 'Auction draft — every team bids from the same budget.' : 'Snake draft — the order reverses every round.',
            ]}
          />
        </Section>
      )}
      <Section onMeasure={noop} id="lineups" emoji="📋" title="Lineups & Waivers">
        <Bullets
          items={[
            'Set your lineup before each game kicks off — players lock at their own kickoff.',
            'Players who just got dropped sit on waivers before anyone can add them. Claims run Wednesday morning.',
            'Free agents not on waivers can be added right away from the Players tab.',
          ]}
        />
      </Section>
      {playoffs?.playoff_team_count ? (
        <Section onMeasure={noop} id="playoffs" emoji="🏆" title="Playoffs">
          <P>
            The top {playoffs.playoff_team_count} teams make the playoffs
            {playoffs.start_week ? `, starting in Week ${playoffs.start_week}` : ''}
            {playoffs.weeks_per_matchup > 1 ? `, with ${playoffs.weeks_per_matchup}-week matchups` : ''}.
          </P>
        </Section>
      ) : null}
      {houseRules?.chugEnabled && (
        <Section onMeasure={noop} id="chug" emoji="🍺" title={houseRules.chugRuleName}>
          <P>Each starter who scores 0 or fewer fantasy points earns one chug for their owner, due by Monday Night Football kickoff.</P>
          <Link label="→ View the Chug Leaderboard" onPress={() => router.push('/chug')} />
        </Section>
      )}
      <P soft>Your commissioner can change these settings in Commissioner Tools.</P>
    </View>
  );
}

// `scrollTo` scrolls the League screen's ScrollView to a y offset; the
// table of contents uses it to jump to a section.
function OfficialRulebook({ scrollTo }: { scrollTo: (y: number) => void }) {
  const offsets = useRef<Record<string, number>>({});
  const rootY = useRef(0);
  const measure = (id: string, y: number) => {
    offsets.current[id] = y;
  };

  return (
    <View style={styles.page} onLayout={(e) => (rootY.current = e.nativeEvent.layout.y)}>
      <View style={styles.titleBlock}>
        <Display style={styles.title}>2026 Official Rulebook</Display>
        <Text style={styles.muted}>Commissioner&apos;s Office</Text>
      </View>

      <Manifesto>
        “All rules are subject to offseason modification for the betterment of the league. Rules exist to maintain
        competition, engagement, tradition, and organized chaos. This league is built on friendship, football, trash
        talk, degeneracy, and public humiliation.”
      </Manifesto>

      <View style={styles.tocBlock}>
        <Text style={styles.tocTitle}>Contents</Text>
        <View style={styles.toc}>
          {TOC.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => scrollTo(rootY.current + (offsets.current[item.id] ?? 0) - Spacing.md)}
              style={({ pressed }) => [styles.tocItem, pressed && styles.pressed]}>
              <Text style={styles.tocText}>
                {item.emoji} {item.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Section onMeasure={measure} id="structure" emoji="💰" title="League Structure & Payouts">
        <Bullets items={['$25 league buy-in', 'Buy-ins due by draft day', 'League operates as a 1-player keeper league']} />
        <Sub>Payout Structure</Sub>
        <View style={styles.payouts}>
          <Payout emoji="🥇" label="1st Place" value="$200" />
          <Payout emoji="🥉" label="3rd Place" value="$50" />
          <Payout emoji="5️⃣" label="5th Place" value="Buy-in returned" />
        </View>
        <Sub>League Loser Receives</Sub>
        <Bullets items={['🏆 Traveling Trophy', '☠️ Mandatory punishment assigned via Wheel of Punishment']} />
        <Callout>
          Failure to complete punishment may result in suspension or removal from the league at commissioner discretion.
        </Callout>
      </Section>

      <Section onMeasure={measure} id="engagement" emoji="🗣️" title="League Engagement Expectation">
        <P>The purpose of the league is active engagement and maintaining friendships through competition.</P>
        <Sub>League Members Are Expected To</Sub>
        <Bullets
          items={['Set active lineups', 'Participate throughout the season', 'Engage in league discussions', 'Talk trash', 'Remain active regardless of team record']}
        />
        <Callout>
          Repeated inactivity, ghosting, lineup neglect, rage quitting, or failure to participate may result in commissioner
          review and possible replacement consideration in future seasons.
        </Callout>
        <Sub>Even Terrible Teams Can Still</Sub>
        <Bullets items={['Ruin playoff hopes', 'Win rivalries', 'Cause suffering', 'Earn Bowl Game glory', 'Create chaos']} />
        <P bold>Stay active.</P>
      </Section>

      <Section onMeasure={measure} id="keeper" emoji="🏷️" title="Keeper / Franchise Tag Rules">
        <P>Each team may keep ONE player from the previous season.</P>
        <Sub>Keeper Deadline</Sub>
        <P>Locked 1 hour prior to draft start.</P>
        <Sub>Franchise Tag Cost Structure</Sub>
        <View>
          <Row label="Year 1 (2025 season)" value="Completed — initial keeper season" />
          <Row label="Year 2 (same player, 2026)" value="$10" />
          <Row label="Year 3 (3rd consecutive season)" value="$25" last />
        </View>
        <Callout>After the 3rd consecutive season, the player must return to free agency OR be traded prior to keeper lock.</Callout>
        <Sub>Franchise Tag Rules</Sub>
        <Bullets
          items={[
            'Franchise-tagged players MAY be traded at any point',
            'If traded, the franchise tag counter resets to zero for the acquiring owner',
            'Owners MAY NOT trade players back and forth in an attempt to intentionally bypass franchise costs',
            'Collusion, roster manipulation, or abuse of loopholes will be reviewed and handled by commissioner discretion',
          ]}
        />
        <Sub>Offseason Roster Rule</Sub>
        <Bullets
          items={[
            'NO free agent pickups permitted during the offseason',
            'NO rookie pickups permitted during the offseason',
            'Only currently rostered players may be traded until official offseason clearance is announced by commissioner',
          ]}
        />
        <P soft>All franchise tag funds are deposited into the league kitty.</P>
      </Section>

      <Section onMeasure={measure} id="draft-order" emoji="🏈" title="Draft Order Determination">
        <P>2026 draft order will be determined by combined Punt, Pass, and Kick totals.</P>
        <P>The majority of league members are expected to participate together during the official league event in August.</P>
        <Sub>If a League Member Cannot Attend</Sub>
        <Bullets
          items={[
            'Attempt must be filmed no later than 1 week prior to draft day',
            'Another person should be present for verification',
            'Recommended to complete on a football field with visible yard markers for transparency',
          ]}
        />
        <P soft>Commissioner reserves authority to review and approve all submitted attempts.</P>
      </Section>

      <Section onMeasure={measure} id="jeffreys-rule" emoji="🍺" title="Jeffrey's Rule">
        <P>Each player that earns 0 or negative fantasy points during a matchup results in ONE required chug for that team owner.</P>
        <Sub>Rules</Sub>
        <Bullets
          items={[
            'Chugs must be completed by Monday Night Football kickoff',
            'Failure to complete by deadline results in doubled owed chugs',
            'Chug penalties may double for a maximum of 3 consecutive weeks',
          ]}
        />
        <Sub>After the Third Week</Sub>
        <P>Remaining chugs convert into monetary fines — $10 per remaining chug.</P>
        <Callout>
          League expectation: miniature beers, partial pours, “technicalities,” and fraudulent beverage containers will be
          judged accordingly by the league.
        </Callout>
        <Link label="→ View the live Chug Leaderboard" onPress={() => router.push('/chug')} />
      </Section>

      <Section onMeasure={measure} id="sweaty-parlay" emoji="🎰" title="The Sweaty Parlay Rule">
        <P>Each week, the lowest scoring team in the league must contribute $5 toward the official league parlay.</P>
        <P>Every remaining league member submits ONE betting leg for the weekly parlay.</P>
        <P>Commissioner will assemble and submit the official “League Degenerate Parlay.”</P>
        <Callout>If the parlay hits, all winnings are split evenly amongst participating league members.</Callout>
        <Sub>Purpose</Sub>
        <Bullets items={['Punish incompetence', 'Encourage engagement', 'Create maximum emotional damage every Sunday']} />
        <P bold>Official league motto regarding the parlay: “Let&apos;s get sweaty.”</P>
      </Section>

      <Section onMeasure={measure} id="trash-talk" emoji="🎥" title="Weekly Trash Talk Expectation">
        <P>Upon winning a weekly matchup, the winning owner is encouraged to post:</P>
        <Bullets items={['A victory video', 'Trash talk', 'Gloating', 'Opponent slander', 'Fraud allegations', 'General propaganda']} />
        <P>The league thrives on storytelling and participation.</P>
        <Link label="→ Post it in League Chat" onPress={() => router.navigate('/chat')} />
      </Section>

      <Section onMeasure={measure} id="kings-cup" emoji="👑" title="King's Cup Rule">
        <P>
          Beginning with the 2026 season, the reigning league champion earns the right to create ONE arbitrary league rule to
          remain active for the following fantasy season.
        </P>
        <Sub>Conditions</Sub>
        <Bullets
          items={[
            'Rule must be declared prior to season start',
            'Rule cannot directly destroy league integrity',
            'Rule cannot intentionally and unfairly target one owner',
            'Commissioner reserves veto authority for extreme stupidity or obvious collusion',
          ]}
        />
        <Sub>Purpose</Sub>
        <P>League champions deserve influence, prestige, and the temporary ability to shape league chaos.</P>
        <Callout>This rule is NOT retroactive. Apologies to previous champions.</Callout>
      </Section>

      <Section onMeasure={measure} id="scoring" emoji="🏈" title="Scoring Rule Adoptions — 2026">
        <View>
          <Row label="QB Tackles" value="15 fantasy points" />
          <Row label="Field Goals" value="0.1 fantasy points per yard" last />
        </View>
        <P soft>Example: a 46-yard field goal = 4.6 fantasy points.</P>
        <Sub>Missed Field Goal Penalties</Sub>
        <View>
          <Row label="Missed 0–29 yard FG" value="-5 points" />
          <Row label="Missed 30–39 yard FG" value="-3 points" />
          <Row label="Missed 40–49 yard FG" value="-1 point" />
          <Row label="Missed 50+ yard FG" value="0 points" last />
        </View>
        <P soft>Punters will NOT be added as a roster position.</P>
      </Section>

      <Section onMeasure={measure} id="tiebreakers" emoji="🏆" title="Playoff Tiebreakers">
        <P>Playoff positioning tiebreakers will be determined in the following order:</P>
        <Bullets numbered items={['Overall Record', 'Total Points Scored', 'Head-to-Head Result']} />
      </Section>

      <Section onMeasure={measure} id="bowl-games" emoji="🏟️" title="Week 18 Bowl Games">
        <P>All non-championship teams are eligible for Week 18 Bowl Games.</P>
        <Sub>Exceptions</Sub>
        <Bullets items={['Championship participants', 'Toilet Bowl participants']} />
        <Sub>Rules</Sub>
        <Bullets
          items={[
            'Bowl matchups assigned by commissioner',
            'Each matchup receives an official bowl game designation',
            'Participants determine agreed reward/punishment stakes',
            'Stakes must receive commissioner approval',
          ]}
        />
        <P soft>Purpose: maintain league engagement through the entirety of the NFL season.</P>
      </Section>

      <Section onMeasure={measure} id="kitty" emoji="💰" title="League Kitty">
        <P>
          League fines, franchise tag payments, parlay penalties, and additional league-generated funds are deposited into the
          league kitty unless otherwise designated.
        </P>
        <Sub>League Kitty May Be Used For</Sub>
        <Bullets
          items={[
            'Championship rings',
            'Trophies',
            'Draft events',
            'League rentals/trips',
            'Bowl game prizes',
            'League memorabilia',
            'Other commissioner-approved league enhancements',
          ]}
        />
        <P soft>League funds are intended to improve league experience, traditions, and league culture.</P>
      </Section>

      <Section onMeasure={measure} id="future" emoji="📈" title="Future League Considerations">
        <P>
          Promotion and relegation league structure remains under consideration for future seasons but will NOT be implemented
          for the 2026 season.
        </P>
        <Sub>Potential Future Format</Sub>
        <Bullets items={['Multi-division league system', 'Promotion/relegation between tiers', 'Expanded payouts and prestige divisions']} />
        <P bold>Dynasties should be challenged. Frauds should be exposed.</P>
      </Section>

      <Section onMeasure={measure} id="commissioner" emoji="⚖️" title="Commissioner Clause">
        <P>The commissioner reserves the right to:</P>
        <Bullets
          items={[
            'Interpret rules',
            'Resolve disputes',
            'Maintain competitive integrity',
            'Prevent abuse of loopholes',
            'Protect league engagement',
            'Preserve league culture',
          ]}
        />
        <P soft>All rulings are intended for the betterment of the league and league experience.</P>
      </Section>

      <Manifesto>{'May your sleepers hit.\nMay your enemies suffer.\nMay your group chat remain toxic.'}</Manifesto>
      <Text style={styles.signoff}>— Commissioner&apos;s Office</Text>
    </View>
  );
}

function Section(props: {
  onMeasure: (id: string, y: number) => void;
  id: string;
  emoji: string;
  title: string;
  children: ReactNode;
}) {
  const accent = useAppearance().accent;
  return (
    <View onLayout={(e) => props.onMeasure(props.id, e.nativeEvent.layout.y)}>
      <NeonPanel contentStyle={styles.section}>
        <View style={styles.sectionHead}>
          <View style={[styles.dot, { backgroundColor: accent, shadowColor: accent }]} />
          <Text style={styles.sectionTitle}>
            {props.emoji} {props.title}
          </Text>
        </View>
        <View style={styles.sectionBody}>{props.children}</View>
      </NeonPanel>
    </View>
  );
}

function Callout({ children }: { children: ReactNode }) {
  const accent = useAppearance().accent;
  return (
    <View style={[styles.callout, { borderLeftColor: accent, backgroundColor: `${accent}0d` }]}>
      <Text style={styles.calloutText}>{children}</Text>
    </View>
  );
}

function Manifesto({ children }: { children: ReactNode }) {
  const accent = useAppearance().accent;
  return (
    <View style={[styles.manifesto, { borderColor: `${accent}33`, backgroundColor: `${accent}0a` }]}>
      <Text style={[styles.manifestoText, { textShadowColor: `${accent}40` }]}>{children}</Text>
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  const accent = useAppearance().accent;
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <Text style={[styles.link, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

function P({ children, bold, soft }: { children: ReactNode; bold?: boolean; soft?: boolean }) {
  return <Text style={[styles.body, bold && styles.bold, soft && styles.soft]}>{children}</Text>;
}

function Sub({ children }: { children: ReactNode }) {
  return <Text style={styles.sub}>{children}</Text>;
}

function Bullets({ items, numbered }: { items: string[]; numbered?: boolean }) {
  return (
    <View style={styles.bullets}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bullet}>{numbered ? `${i + 1}.` : '•'}</Text>
          <Text style={[styles.body, styles.flex]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.ruleRow, !last && styles.ruleRowDivided]}>
      <Text style={[styles.body, styles.flex]}>{label}</Text>
      <Text style={[styles.body, styles.bold, styles.ruleValue]}>{value}</Text>
    </View>
  );
}

function Payout({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <View style={styles.payout}>
      <Text style={styles.payoutEmoji}>{emoji}</Text>
      <Text style={styles.payoutLabel}>{label}</Text>
      <Text style={styles.payoutValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wheelCard: { borderRadius: 16, borderWidth: 1, borderColor: '#a855f7', backgroundColor: '#1b1230', padding: Spacing.lg, gap: 4 },
  wheelKicker: { color: '#c084fc', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  wheelText: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  wheelMeta: { color: Colors.textSecondary, fontSize: 12 },
  page: { gap: Spacing.lg },
  titleBlock: { gap: 4 },
  title: { fontSize: 24, textTransform: 'none', letterSpacing: 0 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  manifesto: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.xl },
  manifestoText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
    textAlign: 'center',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  tocBlock: { gap: Spacing.sm },
  tocTitle: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  toc: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tocItem: {
    width: '48.5%',
    flexGrow: 1,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: Colors.tile,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  tocText: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  section: { gap: Spacing.md, padding: Spacing.xl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  sectionTitle: { color: Colors.text, fontSize: 14, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', flexShrink: 1 },
  sectionBody: { gap: Spacing.md },
  body: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '600', color: Colors.text },
  soft: { color: 'rgba(255,255,255,0.6)' },
  sub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  bullets: { gap: 4 },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm },
  bullet: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20, width: 14 },
  flex: { flex: 1 },
  callout: { borderLeftWidth: 2, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  calloutText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  link: { fontSize: 14, fontWeight: '500' },
  payouts: { flexDirection: 'row', gap: Spacing.sm },
  payout: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: Colors.tile,
  },
  payoutEmoji: { fontSize: 18 },
  payoutLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  payoutValue: { color: Colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  ruleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.md, paddingVertical: Spacing.sm },
  ruleRowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
  ruleValue: { flexShrink: 1, textAlign: 'right' },
  signoff: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', paddingBottom: Spacing.sm },
});
