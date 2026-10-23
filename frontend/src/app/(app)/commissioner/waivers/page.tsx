import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { CommishWaivers } from "@/components/commissioner/CommishWaivers";

export const metadata: Metadata = { title: "Waivers — The Weekend" };

// The league's own waiver rules (2026-10-23 overhaul, mockup 3).
export default function CommissionerWaiversPage() {
  return (
    <CommishPage title="Waivers & free agents">
      <CommishWaivers />
    </CommishPage>
  );
}
