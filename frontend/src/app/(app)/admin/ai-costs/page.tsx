import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminAiUsageServer } from "@/lib/api";
import { AdminAiCosts } from "@/components/admin/AdminAiCosts";

export const metadata: Metadata = { title: "AI Costs — Admin — The Weekend" };

export default async function AdminAiCostsPage() {
  const usage = await getAdminAiUsageServer((await cookies()).get("session")?.value, 7);
  if (!usage) {
    return <p className="text-sm text-red-500">Couldn&apos;t load AI costs — try refreshing.</p>;
  }
  return <AdminAiCosts initial={usage} />;
}
