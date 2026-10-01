"use client";

import { useEffect } from "react";
import { trackRecapOpened } from "@/lib/analyticsEvents";

// Records one read of a week's recap for Admin > Recaps. Renders nothing.
export function RecapOpenTracker({ season, week, source }: { season: number; week: number; source: "push" | "home" | "page" }) {
  useEffect(() => {
    trackRecapOpened(season, week, source);
  }, [season, week, source]);
  return null;
}
