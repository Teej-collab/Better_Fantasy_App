import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { CommishMembers } from "@/components/commissioner/CommishMembers";

export const metadata: Metadata = { title: "Members & Teams — The Weekend" };

// Members and Teams in one (2026-10-23 overhaul, mockup 4).
export default function CommissionerMembersPage() {
  return (
    <CommishPage title="Members & teams">
      <CommishMembers />
    </CommishPage>
  );
}
