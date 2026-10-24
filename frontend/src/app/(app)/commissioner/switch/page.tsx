import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { LeagueSwitchPage } from "@/components/commissioner/LeagueSwitch";

export const metadata: Metadata = { title: "Move to The Weekend — The Weekend" };

// Moving a league that still runs on ESPN/Sleeper over for good (2026-10-24).
export default function CommissionerSwitchPage() {
  return (
    <CommishPage title="Move to The Weekend">
      <LeagueSwitchPage />
    </CommishPage>
  );
}
