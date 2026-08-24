import { NavBar } from "@/components/NavBar";
import { AppEntry } from "@/components/AppEntry";
import { AppTickerBar } from "@/components/AppTickerBar";
import { PageShell } from "@/components/PageShell";
import { PullToRefresh } from "@/components/PullToRefresh";

/**
 * The standard app chrome (nav bar + persistent ticker + the padded
 * page column) for every route except / (its own sibling group,
 * app/(home)/, which keeps the nav but skips this ticker since the
 * homepage renders its own) and /weekend (outside both groups
 * entirely — no chrome at all).
 *
 * That's a real fix, not just organization: a client-side pathname
 * check (what this used to be — a shared root layout with components
 * that hid themselves via usePathname()) can hide something from the
 * rendered DOM after hydration, but it can't stop the server from
 * rendering it — and worse, it can't stop the server from actually
 * *fetching* real backend data for a page that should never show it.
 * Confirmed both were leaking into /weekend's server-rendered HTML
 * before this route group existed. A route group is a real Next.js
 * routing decision enforced by the file system, not a runtime guess.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavBar />
      <AppTickerBar />
      <PullToRefresh>
        <AppEntry>
          <PageShell>{children}</PageShell>
        </AppEntry>
      </PullToRefresh>
    </>
  );
}
