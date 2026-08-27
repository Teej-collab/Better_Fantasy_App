import Link from "next/link";

// Root-level not-found.tsx handles BOTH explicit notFound() calls
// anywhere in the app AND any unmatched URL app-wide (Next.js App
// Router convention since v13.3) — a real, likely scenario here given
// how many routes are ID-based (/teams/[teamId], /owners/[ownerId],
// /matchups/[matchupId], /gamecast/[gameId]): a stale bookmark or
// shared link after data changes lands here instead of Next's bare
// default 404. Renders inside the root layout (not a route group's own
// layout — the NavBar/BottomNav from (app)/(home) don't wrap this), so
// it inherits the Cosmic dark theme automatically but needs its own
// way back into the app.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold tracking-widest text-[var(--wl-accent)] uppercase">404</p>
      <h1 className="text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-white/60">
        The link might be old, or the thing you&apos;re looking for may have moved.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-[var(--wl-accent-dim)] px-5 py-2 text-sm font-medium text-white hover:brightness-110"
      >
        Back to Weekend League
      </Link>
    </div>
  );
}
