import { NavBar } from "@/components/NavBar";
import { PageShell } from "@/components/PageShell";
import { PullToRefresh } from "@/components/PullToRefresh";

/**
 * / keeps the standard nav bar but skips the persistent AppTickerBar —
 * the homepage (page.tsx) always renders its own ticker instead: either
 * OpeningExperience's NFL-only ticker (signed out) or the dashboard's
 * richer ticker mixing in awards/rivalries/standings (signed in).
 * Rendering AppTickerBar here too would just duplicate it. A sibling
 * route group to app/(app)/, not a special case inside it, for the
 * same reason /weekend is its own group entirely — see that layout's
 * comment.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavBar />
      <PullToRefresh>
        <PageShell>{children}</PageShell>
      </PullToRefresh>
    </>
  );
}
