import type { Metadata } from "next";
import { CreateLeagueCta, MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingChrome";

const DESCRIPTION =
  "Real commissioner tools — trade review, force-edit, league polls, granular scoring — plus the recap/power-ranking busywork done for you. Free.";

export const metadata: Metadata = {
  title: "Weekend League for Commissioners",
  description: DESCRIPTION,
  openGraph: {
    title: "Weekend League for Commissioners",
    description: DESCRIPTION,
    images: ["/images/weekend-league-emblem.png"],
  },
  twitter: {
    card: "summary",
    title: "Weekend League for Commissioners",
    description: DESCRIPTION,
    images: ["/images/weekend-league-emblem.png"],
  },
};

const OBJECTIONS = [
  {
    q: "“I don’t want to make my league learn a new app.”",
    a: "Joining takes an invite code and an email address — no install required. You get a one-message invite you can paste straight into your existing group chat.",
  },
  {
    q: "“I don’t want to move everyone’s teams.”",
    a: "Being straight with you: there’s no automatic import from ESPN, Sleeper, or Yahoo for a brand-new league yet. The switch works best at a fresh draft, between seasons — not mid-season.",
  },
  {
    q: "“My league already uses ESPN / Sleeper / Yahoo.”",
    a: "You don’t have to fully commit on day one. Run your next draft here as an experiment and keep your old platform as a backup until your league trusts it.",
  },
];

const TOOLS = [
  "Trade review — approve or veto any proposed trade",
  "Force-edit a team’s roster when you need to step in",
  "League-wide polls and announcements",
  "Granular scoring rules — 45+ stat categories, distance-tiered kicking",
  "Real waivers with a visible, weekly priority order",
  "A commissioner announcement channel that bypasses chat mute",
];

const NOT_YET = [
  "Auction drafts — snake drafts only, for now",
  "Multi-team trades or a trade block",
  "Automatic roster import from ESPN, Sleeper, or Yahoo for a brand-new league",
];

export default function CommissionersPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--wl-bg)", color: "var(--wl-text)" }}>
      <MarketingHeader />

      <section className="mx-auto flex max-w-3xl flex-col items-start gap-5 px-4 pt-10 pb-8 sm:px-8 sm:pt-16">
        <span
          className="font-mono text-xs font-semibold tracking-[0.14em] uppercase"
          style={{ color: "var(--wl-accent)" }}
        >
          For commissioners
        </span>
        <h1 className="font-display text-4xl leading-[1.05] font-bold text-balance sm:text-5xl">
          You run the league. This app does the thankless part for you.
        </h1>
        <p className="text-lg text-[color:var(--wl-text-secondary)]">
          You&apos;re the one who explains the rules, settles the disputes, and keeps the league alive year over
          year. Weekend League gives you real commissioner tools, and it does the thankless part for you: it
          computes your power rankings, writes your weekly recaps, and keeps a running record book, so you&apos;re
          not the one manually posting &ldquo;nice job this week&rdquo; in the group chat every Monday.
        </p>
        <CreateLeagueCta />
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-8">
        <h2 className="font-display mb-3 text-xl font-semibold">The real questions</h2>
        <div className="flex flex-col gap-4">
          {OBJECTIONS.map((o) => (
            <div key={o.q} className="neon-panel rounded-xl p-4" style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}>
              <p className="font-display text-sm font-semibold">{o.q}</p>
              <p className="mt-1 text-sm text-[color:var(--wl-text-secondary)]">{o.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-8">
        <h2 className="font-display mb-3 text-xl font-semibold">What you actually get</h2>
        <ul className="flex flex-col gap-2">
          {TOOLS.map((t) => (
            <li key={t} className="flex gap-2 text-sm text-[color:var(--wl-text-secondary)]">
              <span aria-hidden style={{ color: "var(--wl-accent)" }}>
                ✓
              </span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-8">
        <h2 className="font-display mb-3 text-xl font-semibold">What we don&apos;t do yet</h2>
        <p className="mb-3 text-sm text-[color:var(--wl-text-secondary)]">
          Told to you straight, not buried in fine print:
        </p>
        <ul className="flex flex-col gap-2">
          {NOT_YET.map((t) => (
            <li key={t} className="flex gap-2 text-sm text-[color:var(--wl-text-secondary)]">
              <span aria-hidden style={{ color: "var(--wl-text-secondary)" }}>
                –
              </span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-4 pb-16 sm:px-8">
        <CreateLeagueCta label="Create your league — free, takes 2 minutes" />
      </section>

      <MarketingFooter />
    </div>
  );
}
