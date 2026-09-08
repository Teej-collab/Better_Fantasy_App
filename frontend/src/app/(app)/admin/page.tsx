import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  getAdminActivityServer,
  getAdminAlertsServer,
  getAdminOverviewServer,
  getAdminSystemHealthServer,
  getAdminTimeseriesServer,
  getFeatureUsageServer,
  getMyPreferences,
  getOnlineOwnersServer,
} from "@/lib/api";
import { AdminOverview } from "@/components/admin/AdminOverview";

export const metadata: Metadata = { title: "Overview — Admin — Weekend League" };

export default async function AdminOverviewPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [overview, timeseries, features, activity, alerts, health, owners, myPreferences] = await Promise.all([
    getAdminOverviewServer(sessionCookie),
    getAdminTimeseriesServer(sessionCookie, 30),
    getFeatureUsageServer(sessionCookie, 30),
    getAdminActivityServer(sessionCookie, 15),
    getAdminAlertsServer(sessionCookie),
    getAdminSystemHealthServer(sessionCookie),
    getOnlineOwnersServer(sessionCookie),
    getMyPreferences(sessionCookie),
  ]);

  if (!overview || !timeseries || !features || !activity || !alerts || !health || !owners) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the overview — try refreshing.</p>;
  }

  return (
    <AdminOverview
      initialOverview={overview}
      initialTimeseries={timeseries}
      initialFeatures={features}
      initialActivity={activity}
      initialAlerts={alerts}
      initialHealth={health}
      initialOnline={owners}
      beta={Boolean(myPreferences?.beta_layout)}
    />
  );
}
