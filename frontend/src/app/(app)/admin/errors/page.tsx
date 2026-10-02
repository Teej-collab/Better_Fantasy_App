import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminErrorsServer } from "@/lib/api";
import { AdminErrors } from "@/components/admin/AdminErrors";

export const metadata: Metadata = { title: "Errors — Admin — The Weekend" };

export default async function AdminErrorsPage({ searchParams }: { searchParams: Promise<{ fp?: string }> }) {
  const cookieStore = await cookies();
  const [errors, { fp }] = await Promise.all([getAdminErrorsServer(cookieStore.get("session")?.value, 7), searchParams]);
  if (!errors) {
    return <p className="text-sm text-red-500">Couldn&apos;t load errors — try refreshing.</p>;
  }
  return <AdminErrors initial={errors} initialFingerprint={fp ?? null} />;
}
