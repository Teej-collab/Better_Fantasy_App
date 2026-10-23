import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { CommishCorner } from "@/components/commissioner/CommishCorner";

export const metadata: Metadata = { title: "Commish Corner — The Weekend" };

// Announcements and the change log (2026-10-23 overhaul, mockup 7).
export default function CommissionerCornerPage() {
  return (
    <CommishPage title="Commish Corner" subtitle="Announcements go to everyone in the league.">
      <CommishCorner />
    </CommishPage>
  );
}
