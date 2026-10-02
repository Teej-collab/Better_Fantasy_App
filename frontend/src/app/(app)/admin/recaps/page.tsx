import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminRecapsServer } from "@/lib/api";
import { AdminRecaps } from "@/components/admin/AdminRecaps";

export const metadata: Metadata = { title: "Recaps — Admin — The Weekend" };

export default async function AdminRecapsPage() {
  const cookieStore = await cookies();
  const recaps = await getAdminRecapsServer(cookieStore.get("session")?.value);
  if (!recaps) {
    return <p className="text-sm text-red-500">Couldn&apos;t load recap stats — try refreshing.</p>;
  }
  return <AdminRecaps data={recaps} />;
}
