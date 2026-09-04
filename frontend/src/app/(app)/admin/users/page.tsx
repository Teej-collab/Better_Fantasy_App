import type { Metadata } from "next";
import { cookies } from "next/headers";
import { listAdminUsersServer } from "@/lib/api";
import { AdminUsers } from "@/components/admin/AdminUsers";

export const metadata: Metadata = { title: "Users — Admin — Weekend League" };

export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const initial = await listAdminUsersServer(sessionCookie);

  if (!initial) {
    return <p className="text-sm text-red-500">Couldn&apos;t load users — try refreshing.</p>;
  }

  return <AdminUsers initial={initial} />;
}
