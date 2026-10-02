import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminSecurityServer } from "@/lib/api";
import { AdminSecurity } from "@/components/admin/AdminSecurity";

export const metadata: Metadata = { title: "Security — Admin — The Weekend" };

export default async function AdminSecurityPage() {
  const cookieStore = await cookies();
  const security = await getAdminSecurityServer(cookieStore.get("session")?.value, 7);
  if (!security) {
    return <p className="text-sm text-red-500">Couldn&apos;t load security events — try refreshing.</p>;
  }
  return <AdminSecurity initial={security} />;
}
