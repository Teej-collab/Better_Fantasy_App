"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A row of week chips that scrolls sideways, brought round to the
 *  picked one (the Schedule, 2026-11-08). The chip to show carries
 *  aria-current. */
export function WeekStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = ref.current?.querySelector<HTMLElement>("[aria-current]");
    if (ref.current && on) ref.current.scrollLeft = on.offsetLeft - ref.current.clientWidth / 2 + on.clientWidth / 2;
  });
  return (
    <div ref={ref} className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
      {children}
    </div>
  );
}
