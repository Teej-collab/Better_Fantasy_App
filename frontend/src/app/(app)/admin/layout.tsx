import type { CSSProperties, ReactNode } from "react";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { AdminNav } from "@/components/admin/AdminNav";
import { SignInCard } from "@/components/SignInCard";

// Site-owner-only (require_commissioner_of(DEFAULT_LEAGUE_ID) on the
// backend — see app/routers/admin.py's own docstring). The check here
// is a UX nicety, not the real security boundary: every single
// /admin/* backend endpoint independently re-checks this itself
// (ADMIN_SECURITY.md at the repo root), so a signed-in visitor who
// somehow reached a page under this layout without is_site_owner
// would still get a real 403 from every API call it makes, same as
// if this check didn't exist at all.
//
// One shared gate + nav for every /admin/* page instead of each page
// repeating the same getMe()/authorization check — Overview, Users,
// Leagues, and Navigation all render through this.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (!me.is_site_owner) {
    return (
      <div className="flex flex-col gap-1 py-6 text-center">
        <p className="text-sm font-medium">Not authorized.</p>
        <p className="text-xs text-black/50 dark:text-white/50">This page is only visible to the site owner.</p>
      </div>
    );
  }

  return (
    // --admin-accent: a control-room blue distinct from every real nav
    // destination's own color (lib/navDestinations.ts) — Admin never
    // renders alongside those on screen, so exact hue collision-
    // avoidance doesn't apply the way it does there; this is just
    // Admin's own visual identity, scoped to this subtree only.
    <div style={{ "--admin-accent": "#38bdf8" } as CSSProperties} className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-black/50 dark:text-white/50">The control room — usage, users, and leagues.</p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <AdminNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
