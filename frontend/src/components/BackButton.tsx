"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const CLASS_NAME = "mb-4 inline-flex items-center gap-1 text-sm text-black/50 sm:hidden dark:text-white/50";

/**
 * Prefers real browser back (correct regardless of which of a page's
 * several real entry points the visitor came from) but falls back to a
 * fixed href when there's no reliable in-app history to go back to — a
 * bookmarked/shared link, a fresh tab, or a cold PWA launch, where
 * router.back() would otherwise navigate the user out of the app.
 *
 * window.history.length > 1 is the whole check — document.referrer was
 * tried first but doesn't work here: it only reflects the referrer of
 * the tab's original HTTP navigation and never updates on a client-side
 * Next Link transition, so an ordinary in-app click (Standings -> a
 * team) would still read as "no in-app history" and wrongly fall back.
 * history.length has no such gap since pushState (what Link does)
 * always grows it, same as a real navigation would.
 */
export function BackButton({ fallbackHref, label }: { fallbackHref: string; label: string }) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // setTimeout(0) rather than calling setCanGoBack directly in the
    // effect body — same trick DraftCountdownCard.tsx's tick() uses —
    // so this doesn't trip react-hooks/set-state-in-effect, while still
    // running effectively immediately.
    const id = setTimeout(() => {
      setCanGoBack(window.history.length > 1);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  if (canGoBack) {
    return (
      <button type="button" onClick={() => router.back()} className={CLASS_NAME}>
        ‹ {label}
      </button>
    );
  }

  return (
    <Link href={fallbackHref} className={CLASS_NAME}>
      ‹ {label}
    </Link>
  );
}
