import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { CommishCalendar } from "@/components/commissioner/CommishCalendar";

export const metadata: Metadata = { title: "Season Calendar — The Weekend" };

// Every date the league runs on (2026-10-23 overhaul, mockup 2).
export default function CommissionerCalendarPage() {
  return (
    <CommishPage title="Season calendar" subtitle="Every date your league runs on. Click one to change it.">
      <CommishCalendar />
    </CommishPage>
  );
}
