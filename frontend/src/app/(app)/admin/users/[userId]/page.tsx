import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminUserDetailServer } from "@/lib/api";
import { AdminUserDetail } from "@/components/admin/AdminUserDetail";

export const metadata: Metadata = { title: "User — Admin — Weekend League" };

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const user = await getAdminUserDetailServer(sessionCookie, userId);

  if (!user) {
    return <p className="text-sm text-red-500">User not found.</p>;
  }

  return <AdminUserDetail user={user} />;
}
