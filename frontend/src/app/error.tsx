"use client"; // Error boundaries must be Client Components (App Router requirement)

import { useEffect } from "react";
import Link from "next/link";

// Sits at the app root, so it wraps every route group ((app)/(home)/
// weekend) and catches any uncaught rendering error below the root
// layout — without this, a real bug anywhere in the app fell through
// to Next's bare, unbranded "Application error" screen with no
// recovery action (mobile-audit finding, Aug 2026). Renders inside the
// root layout, so the Cosmic theme still applies automatically.
//
// `retry` (not `reset`) is the correct prop name as of Next.js 16.3 —
// confirmed against this repo's own vendored docs, not assumed from
// memory (see AGENTS.md: this Next.js version has real breaking
// changes from what's typically expected).
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Visible only in devtools/server logs, never to the user — the
    // standard Next.js error-boundary logging pattern.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold tracking-widest text-[var(--wl-accent)] uppercase">Error</p>
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-white/60">
        This page hit a snag. It&apos;s usually temporary — try again, or head back home.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => retry()}
          className="rounded-full bg-[var(--wl-accent-dim)] px-5 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-white/80 hover:bg-white/5"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
