import type { Metadata } from "next";
import { cookies } from "next/headers";
import { listAdminLeaguesServer } from "@/lib/api";
import { AdminLeagues } from "@/components/admin/AdminLeagues";

export const metadata: Metadata = { title: "Leagues — Admin — Weekend League" };

export default async function AdminLeaguesPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const data = await listAdminLeaguesServer(sessionCookie, 7);

  if (!data) {
    return <p className="text-sm text-red-500">Couldn&apos;t load leagues — try refreshing.</p>;
  }

  return <AdminLeagues data={data} />;
}
