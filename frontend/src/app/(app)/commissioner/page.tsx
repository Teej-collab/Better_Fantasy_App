import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { CommishHub } from "@/components/commissioner/CommishHub";

export const metadata: Metadata = { title: "Commissioner — The Weekend" };

/**
 * The Commissioner hub. Redesigned 2026-10-23 (the Commissioner Tools
 * overhaul, mockup 1) from eleven look-alike tiles into a "Needs you"
 * list, the league at a glance and the tools in four groups, each
 * showing its current setting (CommishHub). Every tool is still its
 * own focused page.
 */
export default function CommissionerPage() {
  return (
    <CommishPage title="Commissioner" back={false}>
      <CommishHub />
    </CommishPage>
  );
}
