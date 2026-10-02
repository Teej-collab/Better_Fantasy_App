import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminEngagementServer } from "@/lib/api";
import { AdminEngagement } from "@/components/admin/AdminEngagement";

export const metadata: Metadata = { title: "Engagement — Admin — The Weekend" };

export default async function AdminEngagementPage() {
  const cookieStore = await cookies();
  const engagement = await getAdminEngagementServer(cookieStore.get("session")?.value, 30);
  if (!engagement) {
    return <p className="text-sm text-red-500">Couldn&apos;t load engagement — try refreshing.</p>;
  }
  return <AdminEngagement initial={engagement} />;
}
