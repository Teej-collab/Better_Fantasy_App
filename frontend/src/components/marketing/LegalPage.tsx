import Link from "next/link";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingChrome";

// Shared shell for /privacy and /terms — the same header/footer as
// the other public marketing pages, with a narrow readable column.
// Both pages are plain server components with no data fetching, so
// they render (and are crawlable) for a signed-out visitor too.

export const LEGAL_EFFECTIVE_DATE = "October 9, 2026";

// Where privacy/legal requests go — the league's admin inbox (2026-10),
// also the TestFlight feedback address and where feedback alerts land.
// Set to null to fall back to the in-app feedback form instead.
export const LEGAL_CONTACT_EMAIL: string | null = "theweekend.admin@gmail.com";

export function LegalContact() {
  return LEGAL_CONTACT_EMAIL ? (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">
      {LEGAL_CONTACT_EMAIL}
    </a>
  ) : (
    <>
      the feedback form in{" "}
      <Link href="/settings" className="underline">
        Settings
      </Link>
    </>
  );
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "var(--wl-bg)", color: "var(--wl-text)" }}>
      <MarketingHeader />
      <article className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-8 pb-8 text-sm leading-relaxed text-[color:var(--wl-text-secondary)] sm:px-8">
        <h1 className="font-display text-3xl font-bold text-[color:var(--wl-text)]">{title}</h1>
        <p className="text-xs">Effective {LEGAL_EFFECTIVE_DATE}</p>
        {children}
      </article>
      <MarketingFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 pt-2">
      <h2 className="font-display text-lg font-semibold text-[color:var(--wl-text)]">{title}</h2>
      {children}
    </section>
  );
}
