import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminTapsServer } from "@/lib/api";
import { AdminTaps } from "@/components/admin/AdminTaps";

export const metadata: Metadata = { title: "Taps — Admin — The Weekend" };

const WINDOWS = [7, 30, 90];

export default async function AdminTapsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = WINDOWS.includes(Number(raw)) ? Number(raw) : 30;
  const cookieStore = await cookies();
  const taps = await getAdminTapsServer(cookieStore.get("session")?.value, days);
  if (!taps) {
    return <p className="text-sm text-red-500">Couldn&apos;t load taps — try refreshing.</p>;
  }
  return <AdminTaps data={taps} windows={WINDOWS} />;
}
