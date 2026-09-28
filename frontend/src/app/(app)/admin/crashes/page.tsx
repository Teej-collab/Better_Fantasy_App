import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getCrashReportsServer } from "@/lib/api";
import { AdminCrashes } from "@/components/admin/AdminCrashes";

export const metadata: Metadata = { title: "Crashes — Admin — Weekend League" };

export default async function AdminCrashesPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const crashes = await getCrashReportsServer(sessionCookie, 30);

  if (!crashes) {
    return <p className="text-sm text-red-500">Couldn&apos;t load crash reports — try refreshing.</p>;
  }

  return <AdminCrashes initial={crashes} />;
}
