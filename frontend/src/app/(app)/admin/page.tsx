import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, getOnlineOwnersServer, getUsageSummaryServer } from "@/lib/api";
import { AdminDashboard } from "@/components/AdminDashboard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Admin — Weekend League" };

// Site-owner-only (require_commissioner_of(DEFAULT_LEAGUE_ID) on the
// backend — see app/routers/admin.py's own docstring for why this is
// deliberately narrower than "any league's commissioner"). Not linked
// from any nav — reached by going straight to /admin.
export default async function AdminPage() {
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

  const [owners, usage] = await Promise.all([
    getOnlineOwnersServer(sessionCookie),
    getUsageSummaryServer(sessionCookie),
  ]);

  // getOnlineOwnersServer/getUsageSummaryServer both turn a 403 into
  // null rather than throwing — a signed-in visitor who isn't the site
  // owner sees a plain message instead of a crashed page.
  if (owners === null || usage === null) {
    return (
      <div className="flex flex-col gap-1 py-6 text-center">
        <p className="text-sm font-medium">Not authorized.</p>
        <p className="text-xs text-black/50 dark:text-white/50">This page is only visible to the site owner.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <AdminDashboard initialOwners={owners} initialUsage={usage} />
    </div>
  );
}
