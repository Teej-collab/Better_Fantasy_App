import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingChrome";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";

const DESCRIPTION =
  "Live scoring, a write-up before every matchup, a trade builder that tells you if it's fair, and real commissioner tools. Save your league a spot for 2027.";

export const metadata: Metadata = {
  title: "Bring your league to The Weekend in 2027",
  description: DESCRIPTION,
  openGraph: { title: "Bring your league to The Weekend in 2027", description: DESCRIPTION },
};

const FEATURES = [
  ["Live scoring that feels like Sunday", "Every touchdown, swing and comeback as it happens, with a gamecast for every game."],
  ["A write-up before every matchup", "Rivalries, streaks and trash talk, written for your league every week. Recaps after."],
  ["Trades that tell you the truth", "See if a deal is fair, what it does to your lineup, and which teams actually need what you have."],
  ["Commissioner tools that do the work", "Trade review, a season calendar, waivers your way, announcements everyone sees."],
  ["Your league's own group chat", "With reactions, GIFs, photos and a commissioner channel nobody can mute."],
  ["The fun stuff", "Playoff What-If, a punishment wheel for last place, and the Chug for the bold."],
];

// The 2027 waitlist (2026-10-24): where every "Get this for your league"
// link on a shared card lands (?ref= says which card), and the page to
// send a commissioner. Mid-season nobody moves their league, so this
// collects the ones who'd bring theirs over next year.
export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const refSource = ref ? ref.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || null : null;
  return (
    <div className="min-h-screen" style={{ background: "var(--wl-bg)", color: "var(--wl-text)" }}>
      <MarketingHeader />

      <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-4 pt-10 pb-8 sm:px-8 sm:pt-16">
        <span className="font-mono text-xs font-semibold tracking-[0.14em] uppercase" style={{ color: "var(--wl-accent)" }}>
          The 2027 season
        </span>
        <h1 className="font-display text-4xl leading-[1.05] font-bold text-balance sm:text-5xl">
          Your league deserves better than another year of the same app.
        </h1>
        <p className="text-lg text-[color:var(--wl-text-secondary)]">
          The Weekend is fantasy football built for the group chat. Save your league a spot and we&apos;ll help you
          bring everyone over before your 2027 draft.
        </p>
      </section>

      <section className="mx-auto grid max-w-3xl gap-8 px-4 pb-12 sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul className="flex flex-col gap-4">
          {FEATURES.map(([title, body]) => (
            <li key={title} className="flex flex-col gap-0.5">
              <span className="font-display text-base font-semibold">{title}</span>
              <span className="text-sm text-[color:var(--wl-text-secondary)]">{body}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3">
          <WaitlistForm refSource={refSource} />
          <p className="text-sm text-[color:var(--wl-text-secondary)]">
            Can&apos;t wait until next year?{" "}
            <Link href="/" className="font-semibold underline" style={{ color: "var(--wl-accent)" }}>
              Start a league now
            </Link>{" "}
            or read{" "}
            <Link href="/commissioners" className="font-semibold underline">
              what commissioners get
            </Link>
            .
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
