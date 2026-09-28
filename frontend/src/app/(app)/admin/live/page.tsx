import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminLiveServer } from "@/lib/api";
import { AdminLive } from "@/components/admin/AdminLive";

export const metadata: Metadata = { title: "Live — Admin — Weekend League" };

export default async function AdminLivePage() {
  const cookieStore = await cookies();
  const live = await getAdminLiveServer(cookieStore.get("session")?.value);
  if (!live) {
    return <p className="text-sm text-red-500">Couldn&apos;t load live activity — try refreshing.</p>;
  }
  return <AdminLive initial={live} />;
}
