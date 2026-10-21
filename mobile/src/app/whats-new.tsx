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

const HOME: Item[] = [
  ['Tuesday:', 'last week\'s final and the recap, your power-ranking move, injuries from Sunday, the free agents who went off, and a countdown to waivers.'],
  ['Wednesday:', 'what the 3 AM waiver run did for you, your new waiver priority, then everyone else\'s moves from overnight.'],
  ['Thursday to Saturday:', 'the matchup ahead, who\'s playing today, weather and practice reports, close start/sit calls, and your bets.'],
  ['Game time:', 'your players\' games, live win % you can scrub to any moment, and your game leading Around the League.'],
  ['The sweat:', 'Sunday night and Monday, when your matchup is still undecided, Home is all about the games left.'],
  ['Swap from Home:', 'one-tap lineup swaps right from the cards.'],
  ['Tap a free agent', 'to open their card and add or claim them, with a bid in leagues that bid on waivers.'],
];

const BETS: Item[] = [
  ['The Feed:', 'every shared bet with who placed it. Tail, Fade, Sweat or RIP any of them. Bets one leg away glow, and bad beats get stamped.'],
  ['The Sweat:', 'this week\'s live bets and the closest call, plus the league consensus on the most-backed player.'],
  ['The Board:', 'records and units (every bet counts as one unit at its odds, so nobody\'s wager ever shows), a podium, streaks, trophies and league tendencies.'],
  ['By Game:', 'everyone\'s lines on one bar per player stat, the game lines, and who the league is rooting for.'],
  ['Shared by default:', 'adding a bet posts it to league chat. Your wager and payout stay private.'],
  ['Bet slips:', 'the slip reader saves every bet on a screenshot, not just the top one. A clean read asks "Does this look right?" and saves in one tap.'],
];

const CHAT: Item[] = [
  ['Group chats:', 'New Message, pick two or more people, and name it if you want. Anyone in the group can add people or rename it.'],
  ['Delete a chat:', 'a DM or group leaves your list (just for you). League Chat and Commish Corner stay put.'],
  ['Video:', 'post videos in any chat.'],
  ['@mentions:', 'tag anyone. A tag in the Lounge\'s chat reaches people who haven\'t joined the room yet.'],
  ['Copy', 'any message\'s text.'],
  ['Days on messages:', 'every message shows its day and time now ("Tuesday 5:57 PM", "Oct 6, 5:57 PM"), not just one or the other.'],
  ['Report and block:', 'report a message or block its sender from the ⋯ next to it. Unblock anyone in Settings → Chat.'],
  ['Chat filter:', 'slurs and hate speech are masked everywhere; everyday swearing stays. The commissioner can add the league\'s own words.'],
];

const ROSTER: Item[] = [
  ['Waivers lock for everyone', 'once the week\'s last game kicks off on Monday night, until the Wednesday 3 AM ET run. Bye-week teams included.'],
  ['New free agents', 'start on waivers and clear with that same Wednesday run.'],
  ['Rank your claims:', 'drag them into order on Free Agents. Past claims fold away below, with Won and Missed filters.'],
  ['Full roster?', 'A claim has to name who you\'d drop.'],
  ['Next week opens early:', 'your lineup for next week opens the moment this week\'s last game ends, instead of staying locked until Tuesday afternoon.'],
  ['Dropping a starter', 'who already played keeps his points for the week.'],
  ['Team pages like ESPN\'s:', 'a week stepper, headshots, and tap any team to see its roster.'],
  ['Player search', 'finds rostered players too, with a Trade button, plus an ESPN-style game log.'],
  ['Projections:', 'upcoming weeks use ESPN\'s real week-by-week projections instead of copying this week\'s.'],
];

const ALERTS: Item[] = [
  ['Waiver results:', 'after each run, what you won, or why a claim missed.'],
  ['Matchup finals:', '"You beat X 121.4–98.0 · now 5–1" when the week settles.'],
  ['Starter out:', '45–100 minutes before kickoff if a starter is Out, Doubtful, IR or Suspended, and if he lands on the game-day inactive list.'],
  ['Close game:', 'when your matchup comes down to its last games and it\'s within reach.'],
  ['Watch parties:', 'when one starts, and when someone tags you into the Lounge.'],
];

const GAMECAST: Item[] = [
  ['Box score:', 'every player\'s stats, ESPN-style, with your players and your opponent\'s marked.'],
  ['Drive chart:', 'every drive as a bar across the field: where it started, how far it got, how it ended.'],
  ['Switch games:', 'jump to any other live game from the top of a Gamecast.'],
  ['2-point conversions', 'now score.'],
  ['Camera highlights:', 'when a play moves someone\'s points, their camera tile lights up in that NFL team\'s colors.'],
  ['Moments sized to the play:', 'touchdowns and turnovers take over the TV with how win chances swung; smaller plays get a glow and a notification.'],
  ['Phone and computer at once:', 'be in a room from both without one kicking the other out.'],
  ['My Sweat:', 'a league scoreboard tab, any team\'s roster a tap away, and a Bets tab with the league\'s open bets.'],
];

const MORE: Item[] = [
  ['Punishment Wheel:', 'the commissioner loads up to 12 punishments and spins once a season, live for everyone. Missed it? You\'ll see the spin the first time you open the wheel.'],
  ['Weekly recap:', 'opens differently every week, and rivalry records come from real results.'],
  ['What-If bracket:', 'seeds come from each team\'s projected record, with likely finish breaking ties.'],
  ['Colors:', 'every color setting offers Default, Multi, five colors and a custom picker.'],
  ['Settings, simplified:', 'pick Calm or Cosmic, then your colors. Labs is gone; everyone has the new look.'],
  ['Stay signed in:', 'your session renews while you use the site, so you shouldn\'t get signed out anymore.'],
  ['Privacy Policy and Terms', 'pages are up.'],
];

const APP: Item[] = [
  ['Tab bar:', 'four tabs (Home, Team, Chat, League) around an Engines button in the middle that opens Matchup, What-If, Lounge, Gamecast, League Bets and Chug. The bar tucks away when you scroll down and comes back when you scroll up.'],
  ['Widgets:', 'every size, plus Lock Screen widgets, with team logos in the Dynamic Island.'],
  ['Live score on your Lock Screen,', 'with live projections.'],
  ['Add a bet from a sportsbook:', 'share the slip to The Weekend and it reads it.'],
  ['Lounge:', 'a full-screen TV that turns sideways, a rail of cameras, and any of your phone\'s cameras.'],
  ['Chat:', 'swipe to reply, double-tap to react, and long-press to delete your own messages.'],
  ['Intro sound:', 'plays on your first open each day. Change it in Settings → Appearance → Intro Sound.'],
  ['Battery:', 'screens you\'re not looking at stop working in the background.'],
];

const FIXES: [date: string, text: string][] = [
  ['Oct 21', 'Chat messages from before yesterday showed only a date on the website, or only a time in the app'],
  ['Oct 20', 'Home said "No claims ran for you" between midnight and the 3 AM waiver run'],
  ['Oct 20', 'Bye-week players could be added instantly on Tuesday instead of going through waivers'],
  ['Oct 20', 'Faint grey text on the website was hard to read'],
  ['Oct 19', 'Gamecast got stuck on "Reconnecting" for signed-out visitors'],
  ['Oct 15', 'Importing a bet slip crashed on every screenshot'],
  ['Oct 14', 'Photo, video and chug uploads failed in the app'],
  ['Oct 14', 'Upcoming weeks copied this week\'s projection, and some bye weeks were wrong'],
  ['Oct 14', 'People kept getting signed out'],
  ['Oct 13', 'Countdowns could be off by the time zone'],
  ['Oct 13', 'The recap\'s "biggest bench crime" could come from another league'],
  ['Oct 12', 'Dropping a starter who\'d already played took away his points'],
  ['Oct 8', 'The League widget showed up black'],
];

export default function WhatsNewScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: "What's New" }} />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PATCH NOTES · OCT 7 – OCT 21</Text>
        <Display style={styles.title}>What&apos;s New</Display>
        <Text style={styles.lead}>{'Two big weeks: a Home screen that follows the fantasy week, every bet in the league in one place, group chats and video in chat, waivers that run like a real league\'s, and a long list of fixes.'}</Text>
      </View>

      <Section title={'Spotlight: The Living Home'}>
        <Text style={styles.para}>{'Home now follows the fantasy week. Every day gets its own screen, built around what matters that day, on the website and the app.'}</Text>
        <Bullets items={HOME} />
        <GoButton label={'Go to Home'} href={'/' as Href} />
      </Section>

      <Section title={'League Bets'}>
        <Text style={styles.para}>{'Every shared bet in the league, live, in one place. Find it under Bets → League Bets.'}</Text>
        <Bullets items={BETS} />
        <GoButton label={'Open League Bets'} href={'/bets/league' as Href} />
      </Section>

      <Section title={'Chat'}>
        <Bullets items={CHAT} />
      </Section>

      <Section title={'Waivers, lineups and your roster'}>
        <Bullets items={ROSTER} />
      </Section>

      <Section title={'New alerts'}>
        <Bullets items={ALERTS} />
      </Section>

      <Section title={'Gamecast and the Lounge'}>
        <Bullets items={GAMECAST} />
      </Section>

      <Section title={'Everything else new'}>
        <Bullets items={MORE} />
      </Section>

      <Section title={'iPhone app (TestFlight)'}>
        <Text style={styles.para}>{'The app is still invite-only through TestFlight. If you\'re testing, here\'s what\'s new:'}</Text>
        <Bullets items={APP} />
        <Text style={styles.muted}>{'Want in? Ask the commish.'}</Text>
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
  para: { flex: 1, color: Colors.text, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '800' },
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
