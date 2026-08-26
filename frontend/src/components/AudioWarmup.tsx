"use client";

import { useEffect } from "react";
import { armGlobalAudioUnlock } from "@/lib/introAudioUnlock";

// Mounted once in RootLayout, on every route — see introAudioUnlock.ts
// for why this needs to run app-wide, not just on the boot-intro
// screens themselves.
export function AudioWarmup() {
  useEffect(() => {
    armGlobalAudioUnlock();
  }, []);
  return null;
}
