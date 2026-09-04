import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminLeagueDetailServer } from "@/lib/api";
import { AdminLeagueDetail } from "@/components/admin/AdminLeagueDetail";

export const metadata: Metadata = { title: "League — Admin — Weekend League" };

export default async function AdminLeagueDetailPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const league = await getAdminLeagueDetailServer(sessionCookie, leagueId, 7);

  if (!league) {
    return <p className="text-sm text-red-500">League not found.</p>;
  }

  return <AdminLeagueDetail league={league} />;
}
