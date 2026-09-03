import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { awardsHrefFor, listSeasons, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NAV_ACCENT } from "@/lib/navDestinations";

export const metadata: Metadata = { title: "Rules — Weekend League" };

// The app's single accent (lib/navDestinations.ts's NAV_ACCENT — same
// value the nav bar and every other content panel now read) — every
// rule card below reuses this so this page reads as part of the same
// design system, not a one-off. Used to be a page-specific hardcoded
// lime; collapsed onto the shared accent 2026-08-31 along with the
// nav/panel redesign.
const ACCENT_GLOW = NAV_ACCENT;

type RuleLink = { id: string; emoji: string; title: string };

const TOC: RuleLink[] = [
  { id: "structure", emoji: "💰", title: "League Structure & Payouts" },
  { id: "engagement", emoji: "🗣️", title: "Engagement Expectation" },
  { id: "keeper", emoji: "🏷️", title: "Keeper / Franchise Tag" },
  { id: "draft-order", emoji: "🏈", title: "Draft Order Determination" },
  { id: "jeffreys-rule", emoji: "🍺", title: "Jeffrey's Rule" },
  { id: "sweaty-parlay", emoji: "🎰", title: "The Sweaty Parlay Rule" },
  { id: "trash-talk", emoji: "🎥", title: "Weekly Trash Talk" },
  { id: "kings-cup", emoji: "👑", title: "King's Cup Rule" },
  { id: "scoring", emoji: "🏈", title: "2026 Scoring Adoptions" },
  { id: "tiebreakers", emoji: "🏆", title: "Playoff Tiebreakers" },
  { id: "bowl-games", emoji: "🏟️", title: "Week 18 Bowl Games" },
  { id: "kitty", emoji: "💰", title: "League Kitty" },
  { id: "future", emoji: "📈", title: "Future Considerations" },
  { id: "commissioner", emoji: "⚖️", title: "Commissioner Clause" },
];

export default async function RulesPage() {
  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-6">
      <LeagueSubNav active="rules" awardsHref={awardsHrefFor(latestSeason)} />
      {/* Same soft brand-colored wash as the signed-in homepage
          (.home-ambient, (home)/page.tsx) — reused here rather than
          redefined so this page reads as part of the same design
          system instead of a flat page dropped into it. */}
      <div className="home-ambient" aria-hidden />

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">2026 Official Rulebook</h1>
        <p className="text-sm text-black/50 dark:text-white/50">Commissioner&apos;s Office</p>
      </div>

      <Manifesto>
        &ldquo;All rules are subject to offseason modification for the betterment of the league.
        Rules exist to maintain competition, engagement, tradition, and organized chaos. This
        league is built on friendship, football, trash talk, degeneracy, and public
        humiliation.&rdquo;
      </Manifesto>

      <nav aria-label="Table of contents" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Contents
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-black/[0.015] p-3 text-sm font-medium shadow-sm transition-all hover:bg-black/5 active:scale-[0.98] active:bg-black/10 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none dark:hover:bg-white/5 dark:active:bg-white/10"
            >
              <span aria-hidden>{item.emoji}</span>
              <span className="truncate">{item.title}</span>
            </a>
          ))}
        </div>
      </nav>

      <RuleSection id="structure" emoji="💰" title="League Structure & Payouts">
        <ul className="list-disc space-y-1 pl-5">
          <li>$25 league buy-in</li>
          <li>Buy-ins due by draft day</li>
          <li>League operates as a 1-player keeper league</li>
        </ul>

        <SubHeading>Payout Structure</SubHeading>
        <div className="grid grid-cols-3 gap-2">
          <PayoutTile emoji="🥇" label="1st Place" value="$200" />
          <PayoutTile emoji="🥉" label="3rd Place" value="$50" />
          <PayoutTile emoji="5️⃣" label="5th Place" value="Buy-in returned" />
        </div>

        <SubHeading>League Loser Receives</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>🏆 Traveling Trophy</li>
          <li>☠️ Mandatory punishment assigned via Wheel of Punishment</li>
        </ul>
        <Callout>
          Failure to complete punishment may result in suspension or removal from the league at
          commissioner discretion.
        </Callout>
      </RuleSection>

      <RuleSection id="engagement" emoji="🗣️" title="League Engagement Expectation">
        <p>
          The purpose of the league is active engagement and maintaining friendships through
          competition.
        </p>
        <SubHeading>League Members Are Expected To</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Set active lineups</li>
          <li>Participate throughout the season</li>
          <li>Engage in league discussions</li>
          <li>Talk trash</li>
          <li>Remain active regardless of team record</li>
        </ul>
        <Callout>
          Repeated inactivity, ghosting, lineup neglect, rage quitting, or failure to participate
          may result in commissioner review and possible replacement consideration in future
          seasons.
        </Callout>
        <SubHeading>Even Terrible Teams Can Still</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Ruin playoff hopes</li>
          <li>Win rivalries</li>
          <li>Cause suffering</li>
          <li>Earn Bowl Game glory</li>
          <li>Create chaos</li>
        </ul>
        <p className="font-semibold">Stay active.</p>
      </RuleSection>

      <RuleSection id="keeper" emoji="🏷️" title="Keeper / Franchise Tag Rules">
        <p>Each team may keep ONE player from the previous season.</p>
        <SubHeading>Keeper Deadline</SubHeading>
        <p>Locked 1 hour prior to draft start.</p>

        <SubHeading>Franchise Tag Cost Structure</SubHeading>
        <div className="flex flex-col">
          <RuleRow
            label="Year 1 (2025 season)"
            value="Completed — initial keeper season"
          />
          <RuleRow label="Year 2 (same player, 2026)" value="$10" />
          <RuleRow label="Year 3 (3rd consecutive season)" value="$25" />
        </div>
        <Callout>
          After the 3rd consecutive season, the player must return to free agency OR be traded
          prior to keeper lock.
        </Callout>

        <SubHeading>Franchise Tag Rules</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Franchise-tagged players MAY be traded at any point</li>
          <li>If traded, the franchise tag counter resets to zero for the acquiring owner</li>
          <li>
            Owners MAY NOT trade players back and forth in an attempt to intentionally bypass
            franchise costs
          </li>
          <li>Collusion, roster manipulation, or abuse of loopholes will be reviewed and handled by commissioner discretion</li>
        </ul>

        <SubHeading>Offseason Roster Rule</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>NO free agent pickups permitted during the offseason</li>
          <li>NO rookie pickups permitted during the offseason</li>
          <li>Only currently rostered players may be traded until official offseason clearance is announced by commissioner</li>
        </ul>

        <p className="text-black/60 dark:text-white/60">
          All franchise tag funds are deposited into the league kitty.
        </p>
      </RuleSection>

      <RuleSection id="draft-order" emoji="🏈" title="Draft Order Determination">
        <p>2026 draft order will be determined by combined Punt, Pass, and Kick totals.</p>
        <p>
          The majority of league members are expected to participate together during the official
          league event in August.
        </p>
        <SubHeading>If a League Member Cannot Attend</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Attempt must be filmed no later than 1 week prior to draft day</li>
          <li>Another person should be present for verification</li>
          <li>
            Recommended to complete on a football field with visible yard markers for transparency
          </li>
        </ul>
        <p className="text-black/60 dark:text-white/60">
          Commissioner reserves authority to review and approve all submitted attempts.
        </p>
      </RuleSection>

      <RuleSection id="jeffreys-rule" emoji="🍺" title="Jeffrey's Rule">
        <p>
          Each player that earns 0 or negative fantasy points during a matchup results in ONE
          required chug for that team owner.
        </p>
        <SubHeading>Rules</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Chugs must be completed by Monday Night Football kickoff</li>
          <li>Failure to complete by deadline results in doubled owed chugs</li>
          <li>Chug penalties may double for a maximum of 3 consecutive weeks</li>
        </ul>
        <SubHeading>After the Third Week</SubHeading>
        <p>Remaining chugs convert into monetary fines — $10 per remaining chug.</p>
        <Callout>
          League expectation: miniature beers, partial pours, &ldquo;technicalities,&rdquo; and
          fraudulent beverage containers will be judged accordingly by the league.
        </Callout>
        <Link
          href="/chug"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium hover:underline"
          style={{ color: ACCENT_GLOW }}
        >
          → View the live Chug Leaderboard
        </Link>
      </RuleSection>

      <RuleSection id="sweaty-parlay" emoji="🎰" title="The Sweaty Parlay Rule">
        <p>Each week, the lowest scoring team in the league must contribute $5 toward the official league parlay.</p>
        <p>Every remaining league member submits ONE betting leg for the weekly parlay.</p>
        <p>Commissioner will assemble and submit the official &ldquo;League Degenerate Parlay.&rdquo;</p>
        <Callout>If the parlay hits, all winnings are split evenly amongst participating league members.</Callout>
        <SubHeading>Purpose</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Punish incompetence</li>
          <li>Encourage engagement</li>
          <li>Create maximum emotional damage every Sunday</li>
        </ul>
        <p className="font-semibold">Official league motto regarding the parlay: &ldquo;Let&apos;s get sweaty.&rdquo;</p>
      </RuleSection>

      <RuleSection id="trash-talk" emoji="🎥" title="Weekly Trash Talk Expectation">
        <p>Upon winning a weekly matchup, the winning owner is encouraged to post:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>A victory video</li>
          <li>Trash talk</li>
          <li>Gloating</li>
          <li>Opponent slander</li>
          <li>Fraud allegations</li>
          <li>General propaganda</li>
        </ul>
        <p>The league thrives on storytelling and participation.</p>
        <Link
          href="/chat"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium hover:underline"
          style={{ color: ACCENT_GLOW }}
        >
          → Post it in League Chat
        </Link>
      </RuleSection>

      <RuleSection id="kings-cup" emoji="👑" title="King's Cup Rule">
        <p>Beginning with the 2026 season, the reigning league champion earns the right to create ONE arbitrary league rule to remain active for the following fantasy season.</p>
        <SubHeading>Conditions</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Rule must be declared prior to season start</li>
          <li>Rule cannot directly destroy league integrity</li>
          <li>Rule cannot intentionally and unfairly target one owner</li>
          <li>Commissioner reserves veto authority for extreme stupidity or obvious collusion</li>
        </ul>
        <SubHeading>Purpose</SubHeading>
        <p>League champions deserve influence, prestige, and the temporary ability to shape league chaos.</p>
        <Callout>This rule is NOT retroactive. Apologies to previous champions.</Callout>
      </RuleSection>

      <RuleSection id="scoring" emoji="🏈" title="Scoring Rule Adoptions — 2026">
        <div className="flex flex-col">
          <RuleRow label="QB Tackles" value="15 fantasy points" />
          <RuleRow label="Field Goals" value="0.1 fantasy points per yard" />
        </div>
        <p className="text-black/60 dark:text-white/60">Example: a 46-yard field goal = 4.6 fantasy points.</p>

        <SubHeading>Missed Field Goal Penalties</SubHeading>
        <div className="flex flex-col">
          <RuleRow label="Missed 0–29 yard FG" value="-5 points" />
          <RuleRow label="Missed 30–39 yard FG" value="-3 points" />
          <RuleRow label="Missed 40–49 yard FG" value="-1 point" />
          <RuleRow label="Missed 50+ yard FG" value="0 points" />
        </div>

        <p className="text-black/60 dark:text-white/60">Punters will NOT be added as a roster position.</p>
      </RuleSection>

      <RuleSection id="tiebreakers" emoji="🏆" title="Playoff Tiebreakers">
        <p>Playoff positioning tiebreakers will be determined in the following order:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Overall Record</li>
          <li>Total Points Scored</li>
          <li>Head-to-Head Result</li>
        </ol>
      </RuleSection>

      <RuleSection id="bowl-games" emoji="🏟️" title="Week 18 Bowl Games">
        <p>All non-championship teams are eligible for Week 18 Bowl Games.</p>
        <SubHeading>Exceptions</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Championship participants</li>
          <li>Toilet Bowl participants</li>
        </ul>
        <SubHeading>Rules</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Bowl matchups assigned by commissioner</li>
          <li>Each matchup receives an official bowl game designation</li>
          <li>Participants determine agreed reward/punishment stakes</li>
          <li>Stakes must receive commissioner approval</li>
        </ul>
        <p className="text-black/60 dark:text-white/60">Purpose: maintain league engagement through the entirety of the NFL season.</p>
      </RuleSection>

      <RuleSection id="kitty" emoji="💰" title="League Kitty">
        <p>
          League fines, franchise tag payments, parlay penalties, and additional league-generated
          funds are deposited into the league kitty unless otherwise designated.
        </p>
        <SubHeading>League Kitty May Be Used For</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Championship rings</li>
          <li>Trophies</li>
          <li>Draft events</li>
          <li>League rentals/trips</li>
          <li>Bowl game prizes</li>
          <li>League memorabilia</li>
          <li>Other commissioner-approved league enhancements</li>
        </ul>
        <p className="text-black/60 dark:text-white/60">
          League funds are intended to improve league experience, traditions, and league culture.
        </p>
      </RuleSection>

      <RuleSection id="future" emoji="📈" title="Future League Considerations">
        <p>
          Promotion and relegation league structure remains under consideration for future
          seasons but will NOT be implemented for the 2026 season.
        </p>
        <SubHeading>Potential Future Format</SubHeading>
        <ul className="list-disc space-y-1 pl-5">
          <li>Multi-division league system</li>
          <li>Promotion/relegation between tiers</li>
          <li>Expanded payouts and prestige divisions</li>
        </ul>
        <p className="font-semibold">Dynasties should be challenged. Frauds should be exposed.</p>
      </RuleSection>

      <RuleSection id="commissioner" emoji="⚖️" title="Commissioner Clause">
        <p>The commissioner reserves the right to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Interpret rules</li>
          <li>Resolve disputes</li>
          <li>Maintain competitive integrity</li>
          <li>Prevent abuse of loopholes</li>
          <li>Protect league engagement</li>
          <li>Preserve league culture</li>
        </ul>
        <p className="text-black/60 dark:text-white/60">
          All rulings are intended for the betterment of the league and league experience.
        </p>
      </RuleSection>

      <Manifesto>
        May your sleepers hit.
        <br />
        May your enemies suffer.
        <br />
        May your group chat remain toxic.
      </Manifesto>
      <p className="pb-2 text-center text-xs text-black/50 dark:text-white/50">— Commissioner&apos;s Office</p>
    </div>
  );
}

function RuleSection({
  id,
  emoji,
  title,
  children,
}: {
  id: string;
  emoji: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="neon-panel scroll-mt-4 flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]"
      style={{ ["--panel-glow" as string]: ACCENT_GLOW }}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: ACCENT_GLOW, boxShadow: `0 0 6px ${ACCENT_GLOW}` }}
          aria-hidden
        />
        <span aria-hidden>{emoji}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-sm text-black/75 dark:text-white/75">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
      {children}
    </h3>
  );
}

// A single fact/value row — franchise tag costs, scoring values, missed
// FG penalties, all share this same "label on the left, value on the
// right" shape rather than each becoming a bespoke layout.
function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-black/5 py-2 first:pt-0 last:border-0 last:pb-0 dark:border-white/5">
      <span>{label}</span>
      <span className="shrink-0 font-semibold">{value}</span>
    </div>
  );
}

function PayoutTile({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-black/10 bg-black/[0.015] p-3 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
      <span className="text-lg" aria-hidden>
        {emoji}
      </span>
      <span className="text-xs text-black/50 dark:text-white/50">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

// A callout for the "this has teeth" lines — deadline consequences,
// commissioner-discretion warnings — set apart from ordinary body text
// with the same accent as everything else on this page.
function Callout({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg border-l-2 px-3 py-2 text-sm text-black/70 dark:text-white/70"
      style={{ borderColor: ACCENT_GLOW, backgroundColor: `color-mix(in srgb, ${ACCENT_GLOW} 5%, transparent)` }}
    >
      {children}
    </div>
  );
}

// The rulebook's own framing quotes (opening manifesto, closing
// benediction) — a soft glow echoing the login screen's neon language,
// scaled down to this page's otherwise light/dark-adaptive design
// rather than switching the whole page permanently dark.
function Manifesto({ children }: { children: ReactNode }) {
  return (
    <blockquote
      className="rounded-xl border p-5 text-center text-sm text-balance text-black/70 italic dark:text-white/80"
      style={{
        borderColor: `color-mix(in srgb, ${ACCENT_GLOW} 20%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${ACCENT_GLOW} 4%, transparent)`,
        textShadow: `0 0 18px color-mix(in srgb, ${ACCENT_GLOW} 25%, transparent)`,
      }}
    >
      {children}
    </blockquote>
  );
}
