import { router, Stack, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';

// The league's patch notes (2026-10), a native copy of the web's
// /whats-new (frontend/src/app/(app)/whats-new/page.tsx) — keep the two
// in step each release. Opening this screen logs a /whats-new page view
// (useScreenTracking), which a Commish Corner post's receipts count as
// "opened".

type Item = [lead: string, text: string];

const LOUNGE: Item[] = [
  ['Watch together:', "live video and voice with the whole league, plus the room's own chat."],
  ['One shared TV:', 'whoever has the game shares it, and everyone watches the same picture.'],
  ['Never spoiled:', "tap Sync after a play and the scores, the field and every alert run on the stream's delay. Nothing pops before you see it."],
  ['Touchdown moments:', "a touchdown takes over the screen in the scoring team's colors, showing whose fantasy team it helped and by how much."],
  ['The sweat:', "a live panel of your players and your matchup, with the game's score and down and distance on the TV."],
  ['Fantasy plays as they happen:', "big gains, turnovers and scores from the game on the TV drop into the room's feed."],
  ['Your own volume:', 'turn the game up or down for just you.'],
  ['More than one game:', 'the League Lounge is always open, and anyone can start a watch party, a second room the whole league can join with its own TV.'],
];

const ROOT_FOR: Item[] = [
  ['Your best path:', "the fewest wins you need (from the games you're most likely to win) plus the results that help most, with your real chance if it all goes your way. Light it up plays it all out in one tap."],
  ['Add any root-for game', 'to your what-if world and watch your odds move.'],
  ['Gold games:', 'the games worth rooting for glow gold in your schedule, so you know which Sunday games to keep an eye on.'],
];

const PLAYOFFS_REST: Item[] = [
  ['The full bracket:', 'the top 4 play semis in Weeks 14–15, then the Championship and a 3rd-place game in Weeks 16–17. Seeds 5–12 play the consolation ladder for every spot, down to the Toilet Bowl for 11th and 12th. The Toilet Bowl loser finishes last. Punishment: TBD.'],
  ['Playoff chances:', "each team's chance of making the playoffs, winning the title, or landing in the Toilet Bowl — from scoring average, recent form and power ranking, with real scores so points-for tiebreakers count. They update every week."],
  ['What-If:', 'flip any game this season, pick any game still to play, even pick playoff winners, and the standings, seeds and bracket re-form instantly. Win out and Lose out do your remaining games in one tap.'],
  ['Your Path:', 'pick any team and see every game on its way to where it finishes.'],
  ['Share it:', 'Share to league chat posts your what-if world with a link that opens it exactly as you built it.'],
];

const GAMECAST: Item[] = [
  ['3D field:', 'the Gamecast field is drawn in 3D, and each play replays on it with arcing passes and kicks.'],
  ['Faster updates:', "plays arrive within about 2 seconds of ESPN's fastest feed (they used to lag up to 20 seconds)."],
  ['No more duplicate plays:', "each play shows once, so chat and the Lounge don't fill up with repeats."],
  ['Full names on touchdowns:', '"Bijan Robinson 59 Yd Run", not "Bi.", in the scoring team\'s colors.'],
  ['Win probability:', 'tightens properly as games finish, and a decided matchup shows 100%.'],
  ['Scorebug:', 'quarter and clock on top, the score with a dot for who has the ball, then down and distance.'],
];

const RANKINGS: Item[] = [
  ['Standings:', 'columns are now Record · PPG · PF · PA · Playoff %, and the phone layout no longer jumbles the numbers.'],
  ['Power rankings, rebuilt:', "they no longer just copy the standings. They blend record (30%), all-play record (25%, how you'd do against every team every week), points per game (20%), last-3-weeks form (15%) and scoring margin (10%), set the moment each week's last game ends."],
  ['Luck:', 'now measured in wins: actual wins minus the wins your scores earned. "+1.3" means 1.3 more wins than your scoring deserved.'],
  ['Strength of schedule:', 'rates opponents by how good they actually are, not their records, for games played and games still to come.'],
  ['Notes:', 'each team gets a one-liner where it applies, like "Lucky", "Better than their record" or "Toughest remaining schedule".'],
];

const RECAP: Item[] = [
  ['League context first:', "big scoring week or a dud, the top power-ranked teams colliding, who's unbeaten or winless, running backs going off, a QB feeding his own receiver, a pile of picks or missed kicks."],
  ['Why games went the way they did:', 'the injury that sank someone, the new pickup or returning star who swung it, and credit for the guy who tried to carry a loser.'],
  ['Rankings and the race:', "power-ranking movers, then the playoff picture from the standings. Late in the season it gets into who's clinched, who's out, and who's in with a win."],
];

const ROSTER: Item[] = [
  ['Trade review:', 'accepted trades now go through a review period. The league can vote to veto (5 votes), offers expire, and everyone involved gets notified at each step. The trade deadline is Dec 2, 9:00 AM CT.'],
  ['Waiver claims:', "pick any player on your roster to drop with a claim, even one whose game already started — the claim doesn't run until waivers clear."],
  ['Your Waiver Claims', 'on Free Agents now folds up, showing how many you have and how many are pending.'],
  ['Leagues & invites:', 'a cleaner page for your leagues, with an invite sheet (code, QR code and a share link).'],
];

const MORE: Item[] = [
  ['The Weekend:', 'new name, new logo, seasonal logos (Halloween is up) and a launch intro.'],
  ['Neon hex wall:', 'the background is now a backlit honeycomb with moving light.'],
  ['Tickers:', 'two slim strips labeled NFL and LEAGUE on every page — they scroll on their own, you can swipe them, and tapping a game opens it.'],
  ['Bet tracking:', 'snap your bet slip, track each leg live, and share it to league chat.'],
  ['Chug:', 'your chug balance shows on the countdown, with your chug history; Home shows the latest few chugs with the rest behind "Show more".'],
  ['Join / Create a league:', "a new flow for starting or joining a league; the league picker only shows if you're new or in more than one league."],
  ['iPhone app:', "you're in it. It's still in testing, so tell us what breaks."],
];

const FIXES: [date: string, text: string][] = [
  ['Oct 6', 'The League Lounge kept showing a finished game on its TV; TVs now clear once the game is over'],
  ['Oct 6', 'Standings on a phone wrapped into unlabeled numbers; every number is now labeled'],
  ['Oct 5', 'Gamecast and the Lounge showed some plays twice'],
  ['Oct 5', 'Touchdown alerts cut names short ("Bi.")'],
  ['Oct 5', "The Lounge's gamecast ran behind the stream even at a 0-second delay"],
  ['Oct 5', "Win probability didn't reach 100% for a decided matchup"],
  ['Oct 5', 'Waiver claims on a phone offered no drop once games had started'],
  ['Oct 5', 'D/ST scoring missed fumble recoveries, blocked punts and PATs, and team sacks'],
  ['Oct 5', "The game's volume in the Lounge didn't work on iPhone"],
  ['Oct 1', 'Live ticker items overlapped at the edge of the strip'],
  ['Sep 29', "A D/ST was charged for its own offense's pick-sixes and fumble-return TDs"],
  ['Sep 29', 'Boom of the Week could come up empty'],
];

export default function WhatsNewScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: "What's New" }} />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PATCH NOTES · SEP 29 – OCT 6</Text>
        <Display style={styles.title}>What&apos;s New</Display>
        <Text style={styles.lead}>
          The biggest week yet: the League Lounge for watching games together, a full playoff bracket with a What-If engine and live
          playoff chances, rebuilt power rankings, a smarter weekly recap, and a pile of fixes.
        </Text>
      </View>

      <Section title="Spotlight: The League Lounge">
        <Text style={styles.para}>
          The Lounge is our living room on game day: everyone on video, the game on one shared TV, and every fantasy swing landing the
          moment it happens on the stream.
        </Text>
        <Subhead>What makes it great</Subhead>
        <Bullets items={LOUNGE} />
        <Subhead>How to get there</Subhead>
        <Text style={styles.para}>
          Tap <Text style={styles.bold}>Lounge</Text> in the tab bar at the bottom; it lights up red with a count when anyone&apos;s in a
          room. Inside, jump into the <Text style={styles.bold}>League Lounge</Text> or any <Text style={styles.bold}>watch party</Text>, or
          start your own. Under &ldquo;Games that matter to you,&rdquo; <Text style={styles.bold}>Start a room</Text> puts that game on a
          TV.
        </Text>
        <GoButton label="Open the Lounge" href="/lounge" />
      </Section>

      <Section title="Playoffs tab: the bracket, What-If and playoff chances">
        <Text style={styles.para}>
          Find it under <Text style={styles.bold}>League → Standings → Playoffs</Text> (the tabs now read Scoreboard · Standings ·
          Playoffs).
        </Text>
        <Subhead>The headline: know exactly who to root for</Subhead>
        <Text style={styles.para}>
          The What-If engine plays out the rest of the season 10,000 times and finds the games that move{' '}
          <Text style={styles.italic}>your</Text> playoff chances most — every game in the league, all season long. Each one shows who to
          root for and what it&apos;s worth: &ldquo;Bo over Lorenzo, Week 5: 69% if Bo wins, 64% if not.&rdquo;
        </Text>
        <Bullets items={ROOT_FOR} />
        <Subhead>Everything else in the tab</Subhead>
        <Bullets items={PLAYOFFS_REST} />
        <GoButton
          label="Open the Playoffs tab"
          href={{ pathname: '/league', params: { section: 'standings', view: 'playoffs' } } as unknown as Href}
        />
      </Section>

      <Section title="Gamecast upgrades">
        <Bullets items={GAMECAST} />
      </Section>

      <Section title="Standings, power rankings, luck and schedule">
        <Bullets items={RANKINGS} />
      </Section>

      <Section title="The weekly recap">
        <Text style={styles.para}>
          The recap now reads like one of us telling the group chat how the week went, and it still talks plenty of shit.
        </Text>
        <Bullets items={RECAP} />
      </Section>

      <Section title="Trades, waivers and your roster">
        <Bullets items={ROSTER} />
      </Section>

      <Section title="Everything else new">
        <Bullets items={MORE} />
      </Section>

      <Section title="Fixes">
        <View style={styles.fixes}>
          {FIXES.map(([date, text]) => (
            <View key={text} style={styles.fixRow}>
              <Text style={styles.fixDate}>{date}</Text>
              <Text style={styles.fixText}>{text}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.muted}>Spot something off? Tap your initials at the top right, then Send feedback.</Text>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <NeonPanel contentStyle={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </NeonPanel>
  );
}

function Subhead({ children }: { children: ReactNode }) {
  return <Text style={styles.subhead}>{children}</Text>;
}

function Bullets({ items }: { items: Item[] }) {
  return (
    <View style={styles.bullets}>
      {items.map(([lead, text]) => (
        <View key={lead} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.para}>
            <Text style={styles.bold}>{lead}</Text> {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function GoButton({ label, href }: { label: string; href: Href }) {
  const accent = useAppearance().accent;
  return (
    <Pressable
      onPress={() => router.navigate(href)}
      style={({ pressed }) => [styles.go, { backgroundColor: accent }, pressed && { opacity: 0.7 }]}
      accessibilityRole="button">
      <Text style={styles.goText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  header: { gap: Spacing.sm },
  eyebrow: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { fontSize: 28, textTransform: 'none', letterSpacing: 0 },
  lead: { color: Colors.text, fontSize: 16, lineHeight: 22, opacity: 0.85 },
  section: { padding: Spacing.lg, gap: Spacing.md },
  sectionTitle: { color: Colors.text, fontSize: 19, fontWeight: '800' },
  subhead: { color: Colors.text, fontSize: 14, fontWeight: '800', marginTop: Spacing.xs },
  para: { flex: 1, color: Colors.text, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic' },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  bullets: { gap: Spacing.sm },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm },
  bulletDot: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  go: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  goText: { color: '#06110a', fontSize: 14, fontWeight: '800' },
  fixes: { gap: Spacing.sm },
  fixRow: { flexDirection: 'row', gap: Spacing.md },
  fixDate: { width: 48, color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  fixText: { flex: 1, color: Colors.text, fontSize: 13, lineHeight: 19 },
});
