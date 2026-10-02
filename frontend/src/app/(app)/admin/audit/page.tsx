import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminAuditLogServer } from "@/lib/api";
import { AdminAuditLog } from "@/components/admin/AdminAuditLog";

export const metadata: Metadata = { title: "Audit Log — Admin — The Weekend" };

export default async function AdminAuditPage() {
  const cookieStore = await cookies();
  const audit = await getAdminAuditLogServer(cookieStore.get("session")?.value);
  if (!audit) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the audit log — try refreshing.</p>;
  }
  return <AdminAuditLog initial={audit} />;
}
