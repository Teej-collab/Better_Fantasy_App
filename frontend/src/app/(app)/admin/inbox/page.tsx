import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminInboxServer } from "@/lib/api";
import { InboxPanel } from "@/components/admin/AdminInbox";
import { AdminSection } from "@/components/admin/AdminUi";

export const metadata: Metadata = { title: "Inbox — Admin — The Weekend" };

export default async function AdminInboxPage() {
  const inbox = await getAdminInboxServer((await cookies()).get("session")?.value);
  if (!inbox) {
    return <p className="text-sm text-red-500">Couldn&apos;t load the inbox — try refreshing.</p>;
  }
  return (
    <AdminSection title="Inbox" hint="Everything that needs a person, from the last two weeks. Claim it so you two don't double up.">
      <InboxPanel initial={inbox} />
    </AdminSection>
  );
}
