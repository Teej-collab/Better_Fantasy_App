import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminPathsServer, getFeatureUsageServer, getNavigationHeatmapServer } from "@/lib/api";
import { AdminNavigationHeatmap } from "@/components/admin/AdminNavigationHeatmap";

export const metadata: Metadata = { title: "Navigation — Admin — The Weekend" };

export default async function AdminNavigationPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [heatmap, features, paths] = await Promise.all([
    getNavigationHeatmapServer(sessionCookie, 30),
    getFeatureUsageServer(sessionCookie, 30),
    getAdminPathsServer(sessionCookie, 30),
  ]);

  if (!heatmap || !features || !paths) {
    return <p className="text-sm text-red-500">Couldn&apos;t load navigation data — try refreshing.</p>;
  }

  return <AdminNavigationHeatmap initialHeatmap={heatmap} initialFeatures={features} initialPaths={paths} />;
}
