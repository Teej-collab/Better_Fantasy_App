import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  getAdminOverviewServer,
  getNavigationHeatmapServer,
  getOnlineOwnersServer,
} from "@/lib/api";
import { AdminOverview } from "@/components/admin/AdminOverview";

export const metadata: Metadata = { title: "Overview — Admin — Weekend League" };

export default async function AdminOverviewPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [overview, heatmap, owners] = await Promise.all([
    getAdminOverviewServer(sessionCookie),
    getNavigationHeatmapServer(sessionCookie, 7),
    getOnlineOwnersServer(sessionCookie),
  ]);

  if (!overview || !heatmap || !owners) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the overview — try refreshing.</p>;
  }

  return <AdminOverview initialOverview={overview} initialHeatmap={heatmap} initialOnline={owners} />;
}
