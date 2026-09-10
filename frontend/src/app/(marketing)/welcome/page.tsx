import type { Metadata } from "next";
import { CreateLeagueCta, MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingChrome";

// The first page in the app to set real Open Graph/Twitter Card
// fields (see app/layout.tsx's new metadataBase — required for the
// relative image path below to resolve to an absolute URL). Every
// claim in this page's copy is checked against what's actually
// shipped today (Documentation/Marketing/01_Brand_Positioning.md's own
// voice rule) — nothing here is "coming soon."
const DESCRIPTION =
  "Real drafts, real scoring, real waivers — plus AI-written recaps, real power rankings, and a record book that writes itself. Free.";

export const metadata: Metadata = {
  title: "Weekend League — Fantasy Football, With a Memory",
  description: DESCRIPTION,
  openGraph: {
    title: "Weekend League",
    description: DESCRIPTION,
    images: ["/images/weekend-league-emblem.png"],
  },
  twitter: {
    card: "summary",
    title: "Weekend League",
    description: DESCRIPTION,
    images: ["/images/weekend-league-emblem.png"],
  },
};

const FEATURES = [
  { title: "A real draft room", body: "Live pick clock, a queue that actually feeds autopick, pause/undo, and full-state reconnect if anyone drops." },
  { title: "Real waivers", body: "Priority-order claims that reset weekly to the inverse of standings — not first-come-first-served free agency." },
  { title: "A lineup lock that locks", body: "Server-enforced at kickoff. No editing a roster after the game's already started." },
  { title: "Live scoring & Gamecast", body: "Real-time scores and play-by-play, pushed the moment they happen." },
  { title: "League chat, built in", body: "League chat, DMs, a draft-room channel, and a commissioner announcement channel — no separate group text needed." },
  { title: "AI recaps & draft grades", body: "A real, automatically written recap after every week, and a graded breakdown of every draft pick." },
  { title: "Power rankings & a record book", body: "A documented, computed weekly ranking — plus an all-time record book that updates itself." },
];

export default function WelcomePage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--wl-bg)", color: "var(--wl-text)" }}>
      <MarketingHeader />

      <section className="mx-auto flex max-w-3xl flex-col items-start gap-5 px-4 pt-10 pb-8 sm:px-8 sm:pt-16">
        <span
          className="font-mono text-xs font-semibold tracking-[0.14em] uppercase"
          style={{ color: "var(--wl-accent)" }}
        >
          Fantasy football, built different
        </span>
        <h1 className="font-display text-4xl leading-[1.05] font-bold text-balance sm:text-5xl">
          Your league deserves better than a spreadsheet with a scoreboard.
        </h1>
        <p className="text-lg text-[color:var(--wl-text-secondary)]">{DESCRIPTION}</p>
        <CreateLeagueCta />
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-8 sm:px-8">
        <p className="text-sm text-[color:var(--wl-text-secondary)]">
          Sleeper, ESPN, and Yahoo are built for a hundred million users, so your league is just twelve rows in a
          database to them. Weekend League is built the way a league actually experiences a season — draft night,
          waiver drama, a rivalry that&apos;s been going for years, the guy who always chokes in Week 12. It&apos;s
          free, and it was built by someone who plays in the league it was built for.
        </p>
      </section>

      <section className="mx-auto grid max-w-3xl grid-cols-1 gap-3 px-4 pb-12 sm:grid-cols-2 sm:px-8">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="neon-panel flex flex-col gap-1.5 rounded-xl p-4"
            style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
          >
            <h2 className="font-display text-sm font-semibold">{f.title}</h2>
            <p className="text-sm text-[color:var(--wl-text-secondary)]">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto flex max-w-3xl flex-col items-start gap-3 px-4 pb-16 sm:px-8">
        <h2 className="font-display text-xl font-semibold">Run a league yourself?</h2>
        <p className="text-sm text-[color:var(--wl-text-secondary)]">
          See what switching actually looks like, including what we don&apos;t do yet.
        </p>
        <a
          href="/commissioners"
          className="text-sm font-semibold hover:underline"
          style={{ color: "var(--wl-accent)" }}
        >
          Read the commissioner page →
        </a>
      </section>

      <MarketingFooter />
    </div>
  );
}
