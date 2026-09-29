"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";

// The one place "refresh the app" is defined — PullToRefresh.tsx and
// GameDayRefresher.tsx are its callers.
//
// router.refresh() is Next.js App Router's own built-in mechanism for
// re-running Server Components on the current route with fresh data.
// That alone was only half a refresh, though (2026-09 report: "pull to
// refresh felt cosmetic"): client components that seed local state from
// a server prop — useState(initialTeam), useState(initialMatchups) —
// never re-read that prop after mount, so the new server data arrived
// and was silently ignored, and client-fetched panels (FantasyImpact)
// were never asked to refetch at all. Every such component now
// subscribes with useOnAppRefresh below and refetches whatever it's
// currently showing when the app refreshes.
//
// Deliberately does NOT replay the boot/"Welcome Back" intro sequence —
// pulling to refresh should just refresh the data underneath, not
// visually restart the whole app.

const APP_REFRESH_EVENT = "wl:app-refresh";

type AppRefreshDetail = { waitUntil: (work: Promise<unknown>) => void };

/**
 * Tells every mounted useOnAppRefresh subscriber to refetch. Resolves
 * once all of their refetches have settled (success or failure), so a
 * caller like PullToRefresh can keep its spinner up for exactly as long
 * as the refresh actually takes.
 */
export function dispatchAppRefresh(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  window.dispatchEvent(
    new CustomEvent<AppRefreshDetail>(APP_REFRESH_EVENT, {
      detail: { waitUntil: (work) => pending.push(work) },
    })
  );
  return Promise.allSettled(pending).then(() => {});
}

/**
 * Runs `handler` on every app refresh (pull-to-refresh, and each
 * GameDayRefresher tick during a live game). Return the refetch's
 * promise so the pull-to-refresh spinner waits for it.
 */
export function useOnAppRefresh(handler: () => Promise<unknown> | void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    function onRefresh(e: Event) {
      const work = handlerRef.current();
      if (work) (e as CustomEvent<AppRefreshDetail>).detail.waitUntil(work);
    }
    window.addEventListener(APP_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(APP_REFRESH_EVENT, onRefresh);
  }, []);
}

/**
 * `refresh()` re-runs the route's Server Components and tells client
 * components to refetch; its promise covers the client refetches, and
 * `isPending` covers the server re-render (router.refresh() has no
 * promise of its own, but it does run inside a transition).
 */
export function useRefreshApplicationData() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
    return dispatchAppRefresh();
  }, [router]);
  return { refresh, isPending };
}
