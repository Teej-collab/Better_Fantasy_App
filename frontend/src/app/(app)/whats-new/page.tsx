import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "What's New — The Weekend" };

// The league's patch notes, in the app (2026-10) — so a Commish Corner
// post can link here and the commissioner can see who actually read
// them: visits to /whats-new are page views (PageViewTracker), which
// GET /chat/messages/{id}/receipts counts as "opened".

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="neon-panel flex flex-col gap-3 rounded-2xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: [string, string][] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed">
      {items.map(([lead, text]) => (
        <li key={lead}>
          <b>{lead}</b> {text}
        </li>
      ))}
    </ul>
  );
}

const FIXES: [string, string][] = [
  ["Oct 6", "The League Lounge kept showing a finished game on its TV; TVs now clear once the game is over"],
  ["Oct 6", "Standings on a phone wrapped into unlabeled numbers; every number is now labeled"],
  ["Oct 5", "Gamecast and the Lounge showed some plays twice"],
  ["Oct 5", "Touchdown alerts cut names short (\"Bi.\")"],
  ["Oct 5", "The Lounge's gamecast ran behind the stream even at a 0-second delay"],
  ["Oct 5", "Win probability didn't reach 100% for a decided matchup"],
  ["Oct 5", "Waiver claims on a phone offered no drop once games had started"],
  ["Oct 5", "D/ST scoring missed fumble recoveries, blocked punts and PATs, and team sacks"],
  ["Oct 5", "The game's volume in the Lounge didn't work on iPhone"],
  ["Oct 1", "Live ticker items overlapped at the edge of the strip"],
  ["Sep 29", "A D/ST was charged for its own offense's pick-sixes and fumble-return TDs"],
  ["Sep 29", "Boom of the Week could come up empty"],
];

export default function WhatsNewPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-10">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.2em] text-black/50 uppercase dark:text-white/50">Patch notes · Sep 29 – Oct 6</span>
        <h1 className="text-3xl font-bold">What&apos;s New</h1>
        <p className="text-base text-black/70 dark:text-white/70">
          The biggest week yet: the League Lounge for watching games together, a full playoff bracket with a What-If engine and live playoff
          chances, rebuilt power rankings, a smarter weekly recap, and a pile of fixes.
        </p>
      </header>

      <Section id="lounge" title="Spotlight: The League Lounge">
        <p className="text-sm leading-relaxed">
          The Lounge is our living room on game day: everyone on video, the game on one shared TV, and every fantasy swing landing the moment it
          happens on the stream.
        </p>
        <h3 className="text-sm font-semibold">What makes it great</h3>
        <Bullets
          items={[
            ["Watch together:", "live video and voice with the whole league, plus the room's own chat."],
            ["One shared TV:", "whoever has the game shares it, and everyone watches the same picture."],
            ["Never spoiled:", "tap Sync after a play and the scores, the field and every alert run on the stream's delay. Nothing pops before you see it."],
            ["Touchdown moments:", "a touchdown takes over the screen in the scoring team's colors, showing whose fantasy team it helped and by how much."],
            ["The sweat:", "a live panel of your players and your matchup, with the game's score and down and distance on the TV."],
            ["Fantasy plays as they happen:", "big gains, turnovers and scores from the game on the TV drop into the room's feed."],
            ["Your own volume:", "turn the game up or down for just you."],
            ["More than one game:", "the League Lounge is always open, and anyone can start a watch party, a second room the whole league can join with its own TV."],
          ]}
        />
        <h3 className="text-sm font-semibold">How to get there</h3>
        <p className="text-sm leading-relaxed">
          Tap <b>Lounge</b>: it&apos;s in the top bar on a computer and the bottom bar on your phone, and it lights up red with a count when anyone&apos;s
          in a room. The Lounge banner on Home and the top of Chat get you there too. Inside, jump into the <b>League Lounge</b> or any{" "}
          <b>watch party</b>, or start your own. Under &ldquo;Games that matter to you,&rdquo; <b>Start a room</b> puts that game on a TV.
        </p>
        <Link href="/lounge" className="self-start rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}>
          Open the Lounge
        </Link>
      </Section>

      <Section id="playoffs" title="Playoffs tab: the bracket, What-If and playoff chances">
        <p className="text-sm leading-relaxed">
          Find it under <b>League → Standings → Playoffs</b> (the tabs now read Scoreboard · Standings · Playoffs).
        </p>
        <h3 className="text-sm font-semibold">The headline: know exactly who to root for</h3>
        <p className="text-sm leading-relaxed">
          The What-If engine plays out the rest of the season 10,000 times and finds the games that move <i>your</i> playoff chances most — every
          game in the league, all season long. Each one shows who to root for and what it&apos;s worth: &ldquo;Bo over Lorenzo, Week 5: 69% if Bo wins,
          64% if not.&rdquo;
        </p>
        <Bullets
          items={[
            ["Your best path:", "the fewest wins you need (from the games you're most likely to win) plus the results that help most, with your real chance if it all goes your way. Light it up plays it all out in one tap."],
            ["Add any root-for game", "to your what-if world and watch your odds move."],
            ["Gold games:", "the games worth rooting for glow gold in your schedule, so you know which Sunday games to keep an eye on."],
          ]}
        />
        <h3 className="text-sm font-semibold">Everything else in the tab</h3>
        <Bullets
          items={[
            ["The full bracket:", "the top 4 play semis in Weeks 14–15, then the Championship and a 3rd-place game in Weeks 16–17. Seeds 5–12 play the consolation ladder for every spot, down to the Toilet Bowl for 11th and 12th. The Toilet Bowl loser finishes last. Punishment: TBD."],
            ["Playoff chances:", "each team's chance of making the playoffs, winning the title, or landing in the Toilet Bowl — from scoring average, recent form and power ranking, with real scores so points-for tiebreakers count. They update every week."],
            ["What-If:", "flip any game this season, pick any game still to play, even pick playoff winners, and the standings, seeds and bracket re-form instantly. Win out and Lose out do your remaining games in one tap."],
            ["Your Path:", "pick any team and see every game on its way to where it finishes."],
            ["Share it:", "Share to league chat posts your what-if world with a link that opens it exactly as you built it."],
          ]}
        />
        <Link href="/standings?view=playoffs" className="self-start rounded-full px-4 py-2 text-sm font-bold" style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}>
          Open the Playoffs tab
        </Link>
      </Section>

      <Section id="gamecast" title="Gamecast upgrades">
        <Bullets
          items={[
            ["3D field:", "the Gamecast field is drawn in 3D, and each play replays on it with arcing passes and kicks."],
            ["Faster updates:", "plays arrive within about 2 seconds of ESPN's fastest feed (they used to lag up to 20 seconds)."],
            ["No more duplicate plays:", "each play shows once, so chat and the Lounge don't fill up with repeats."],
            ["Full names on touchdowns:", "\"Bijan Robinson 59 Yd Run\", not \"Bi.\", in the scoring team's colors."],
            ["Win probability:", "tightens properly as games finish, and a decided matchup shows 100%."],
            ["Scorebug:", "quarter and clock on top, the score with a dot for who has the ball, then down and distance."],
          ]}
        />
      </Section>

      <Section id="rankings" title="Standings, power rankings, luck and schedule">
        <Bullets
          items={[
            ["Standings:", "columns are now Record · PPG · PF · PA · Playoff %, and the phone layout no longer jumbles the numbers."],
            ["Power rankings, rebuilt:", "they no longer just copy the standings. They blend record (30%), all-play record (25%, how you'd do against every team every week), points per game (20%), last-3-weeks form (15%) and scoring margin (10%), set the moment each week's last game ends."],
            ["Luck:", "now measured in wins: actual wins minus the wins your scores earned. \"+1.3\" means 1.3 more wins than your scoring deserved."],
            ["Strength of schedule:", "rates opponents by how good they actually are, not their records, for games played and games still to come."],
            ["Notes:", "each team gets a one-liner where it applies, like \"Lucky\", \"Better than their record\" or \"Toughest remaining schedule\"."],
          ]}
        />
      </Section>

      <Section id="recap" title="The weekly recap">
        <p className="text-sm leading-relaxed">The recap now reads like one of us telling the group chat how the week went, and it still talks plenty of shit.</p>
        <Bullets
          items={[
            ["League context first:", "big scoring week or a dud, the top power-ranked teams colliding, who's unbeaten or winless, running backs going off, a QB feeding his own receiver, a pile of picks or missed kicks."],
            ["Why games went the way they did:", "the injury that sank someone, the new pickup or returning star who swung it, and credit for the guy who tried to carry a loser."],
            ["Rankings and the race:", "power-ranking movers, then the playoff picture from the standings. Late in the season it gets into who's clinched, who's out, and who's in with a win."],
          ]}
        />
      </Section>

      <Section id="roster" title="Trades, waivers and your roster">
        <Bullets
          items={[
            ["Trade review:", "accepted trades now go through a review period. The league can vote to veto (5 votes), offers expire, and everyone involved gets notified at each step. The trade deadline is Dec 2, 9:00 AM CT."],
            ["Waiver claims:", "pick any player on your roster to drop with a claim, even one whose game already started — the claim doesn't run until waivers clear."],
            ["Your Waiver Claims", "on Free Agents now folds up, showing how many you have and how many are pending."],
            ["Leagues & invites:", "a cleaner page for your leagues, with an invite sheet (code, QR code and a share link)."],
          ]}
        />
      </Section>

      <Section id="more" title="Everything else new">
        <Bullets
          items={[
            ["The Weekend:", "new name, new logo, seasonal logos (Halloween is up) and a launch intro."],
            ["Neon hex wall:", "the background is now a backlit honeycomb with moving light."],
            ["Tickers:", "two slim strips labeled NFL and LEAGUE on every page — they scroll on their own, you can swipe them, and tapping a game opens it."],
            ["Bet tracking:", "snap your bet slip, track each leg live, and share it to league chat."],
            ["Chug:", "your chug balance shows on the countdown, with your chug history; Home shows the latest few chugs with the rest behind \"Show more\"."],
            ["Join / Create a league:", "a new flow for starting or joining a league; the league picker only shows if you're new or in more than one league."],
            ["iPhone app:", "a native app with all of this is in testing. More on that soon."],
          ]}
        />
      </Section>

      <Section id="fixes" title="Fixes">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-xs text-black/50 dark:border-white/10 dark:text-white/50">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 font-semibold">Fixed</th>
              </tr>
            </thead>
            <tbody>
              {FIXES.map(([date, text]) => (
                <tr key={text} className="border-b border-black/5 align-top dark:border-white/5">
                  <td className="py-2 pr-4 whitespace-nowrap text-black/60 dark:text-white/60">{date}</td>
                  <td className="py-2">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">Spot something off? Tap Feedback in the account menu.</p>
      </Section>
    </div>
  );
}
