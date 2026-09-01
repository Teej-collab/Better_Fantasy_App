"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Debounced, client-side player-name search — updates the `search`
 * query param via router.replace() while preserving every other param
 * already on the URL (position, etc.), so this never triggers a hard
 * browser navigation. Player Research's own search used to be a plain
 * `<form method="GET">`, which is a genuine full-document reload as
 * far as the browser is concerned even though the destination is
 * same-origin — that reset appBoot.ts's module-level "already booted"
 * flag, so AppEntry.tsx replayed the entire boot/"Welcome Back" splash
 * on every single search (2026-09-02 audit). The position tabs on the
 * same pages already prove the safe pattern (a plain `<Link>`, a real
 * client-side transition) — this is the same idea for a text input
 * instead of a fixed set of links. Shared by Player Research and Free
 * Agents rather than copied twice.
 */
export function PlayerSearchInput({
  paramName = "search",
  placeholder = "Search players…",
}: {
  paramName?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramName) ?? "");
  // Every effect run — including the very first, on mount — schedules
  // a debounced replace(). Without this guard, that first run fires
  // ~300ms after mount regardless of whether the user ever touched the
  // input, using a closure over whatever the URL looked like AT MOUNT
  // — so a position-tab click (a real, separate navigation) landing
  // inside that same 300ms window got silently overwritten back to the
  // stale pre-click URL the instant this fired. Position filtering
  // reading as fully broken was actually this, not the tab links
  // themselves (2026-09-02, caught live during verification).
  const skipNextEffect = useRef(true);

  useEffect(() => {
    if (skipNextEffect.current) {
      skipNextEffect.current = false;
      return;
    }
    const id = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set(paramName, value.trim());
      } else {
        params.delete(paramName);
      }
      // replace, not push — rapid typing shouldn't spam the browser's
      // back-button history with one entry per keystroke.
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }, 300);
    return () => clearTimeout(id);
    // Deliberately keyed only on `value` (and the stable paramName) —
    // searchParams/pathname/router are read fresh inside the callback
    // when it actually fires, not tracked as reactive deps, so typing
    // doesn't restart the debounce every time the URL itself updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, paramName]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      aria-label="Search players"
      className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm dark:border-white/10"
    />
  );
}
