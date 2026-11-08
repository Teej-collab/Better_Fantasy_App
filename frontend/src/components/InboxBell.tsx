"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { INBOX_CHANGED, inboxApi } from "@/lib/inboxApi";

// The notification inbox's bell (2026-11-08), next to the account menu,
// with what's unread. Checks every minute and when the tab comes back.
export function InboxBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      inboxApi.unread().then(
        (r) => alive && setUnread(r.unread),
        () => {},
      );
    load();
    const timer = window.setInterval(load, 60_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    const onChange = (e: Event) => setUnread((e as CustomEvent<number>).detail);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(INBOX_CHANGED, onChange);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(INBOX_CHANGED, onChange);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/70 hover:text-black dark:text-white/80 dark:hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff3b5c] px-1 text-[9px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
