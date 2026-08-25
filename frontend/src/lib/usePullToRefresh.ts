"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

// The one place "refresh the app" is defined — PullToRefresh.tsx is its
// only caller today, but this is named and exported on its own (not
// inlined there) so anything else that needs the same "refresh live
// data" behavior later (a manual refresh button, say) calls this
// instead of re-deriving it.
//
// router.refresh() is Next.js App Router's own built-in mechanism for
// re-running Server Components on the current route with fresh data —
// exactly the existing data-fetching architecture (every page in this
// app already fetches through Server Components), not a parallel system
// built just for this. Deliberately does NOT replay the boot/"Welcome
// Back" intro sequence — pulling to refresh should just refresh the
// data underneath, not visually restart the whole app.
export function useRefreshApplicationData() {
  const router = useRouter();
  return useCallback(() => {
    router.refresh();
  }, [router]);
}
