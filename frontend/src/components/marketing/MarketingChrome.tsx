import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

// Shared header/footer for the public marketing pages (/welcome,
// /commissioners) — kept out of app/(marketing)/layout.tsx itself
// since that layout intentionally renders zero chrome by default
// (matching app/weekend/layout.tsx's pattern); these two pages are
// the ones that actually want a minimal nav/footer of their own.
export function MarketingHeader() {
  return (
    <header className="flex items-center justify-between px-4 py-4 sm:px-8">
      <BrandMark href="/welcome" />
      <nav aria-label="Marketing" className="flex items-center gap-4 text-sm text-[color:var(--wl-text-secondary)]">
        <Link href="/commissioners" className="hover:text-[color:var(--wl-text)]">
          For commissioners
        </Link>
        <Link
          href="/"
          className="rounded-full px-3 py-1.5 font-medium"
          style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)", color: "var(--wl-text)" }}
        >
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-16 flex flex-col items-center gap-2 px-4 pb-10 text-center text-xs text-[color:var(--wl-text-secondary)]">
      <p>Weekend League is free. No ads, no paid tier, no catch.</p>
      <p>
        <Link href="/welcome" className="hover:text-[color:var(--wl-text)]">
          What is this?
        </Link>
        {" · "}
        <Link href="/commissioners" className="hover:text-[color:var(--wl-text)]">
          For commissioners
        </Link>
      </p>
    </footer>
  );
}

// The primary "create a league" CTA both pages end on — links to the
// front door (/), which already handles a signed-out visitor
// correctly end to end: OpeningExperience → "Enter Here" →
// EntryChoiceStage's "Create a League" → SignInCard (variant="create")
// → lands on /leagues#create-league once signed up. Deep-linking
// straight into that client-only flow from here would mean rebuilding
// its signed-out handling a second time for no real benefit.
export function CreateLeagueCta({ label = "Create your league — free" }: { label?: string }) {
  return (
    <Link
      href="/"
      className="inline-flex w-fit items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
      style={{ background: "var(--wl-accent)", color: "#06110a" }}
    >
      {label}
    </Link>
  );
}
