import { NavBar } from "@/components/NavBar";
import { AppEntry } from "@/components/AppEntry";
import { PageShell } from "@/components/PageShell";
import { PullToRefresh } from "@/components/PullToRefresh";

/**
 * /chat's own route group — same chrome as app/(app)/layout.tsx
 * (nav bar, pull-to-refresh, the app-entry boot sequence, the padded
 * page shell) minus AppTickerBar. Per the 2026-09 "COMMS" redesign's
 * own explicit ask: drop the ticker on the chat screen so the
 * conversation list/thread gets the most vertical room possible.
 *
 * A client-side pathname check inside the shared (app) layout can't do
 * this correctly — see that layout's own comment on why /weekend
 * needed a real route group instead of a runtime check. AppTickerBar
 * does real server-side data fetching on every request; hiding its
 * rendered OUTPUT client-side wouldn't stop that fetch from happening
 * for a page that's never going to show it. A route group is a real
 * routing decision the server honors before rendering anything, the
 * same fix already proven for /weekend.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavBar />
      <PullToRefresh>
        <AppEntry>
          <PageShell>{children}</PageShell>
        </AppEntry>
      </PullToRefresh>
    </>
  );
}
