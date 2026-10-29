"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAdminBadges, getAdminInbox, type AdminBadges } from "@/lib/api";
import { needsMe } from "@/lib/adminFormat";
import { startVisibleInterval } from "@/lib/visibleInterval";

// `page`: a standalone page outside the app (the Brain, the live system map at
// /brain), opened with a plain link rather than the client router.
// `icon`: an SVG path, drawn white on its `color` square like the app's
// Settings rows (2026-10-28, replacing the old symbol characters).
type Section = {
  href: string;
  label: string;
  icon: string;
  color: string;
  badge?: keyof AdminBadges | "inbox";
  page?: boolean;
};

const GROUPS: { title: string; sections: Section[] }[] = [
  {
    title: "Today",
    sections: [
      { href: "/admin", label: "Command Center", icon: "M3 12l9-8 9 8M5 10v10h14V10", color: "#bf5af2" },
      { href: "/admin/inbox", label: "Inbox", icon: "M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6z", color: "#bf5af2", badge: "inbox" },
    ],
  },
  {
    title: "Usage",
    sections: [
      { href: "/admin/live", label: "Live", icon: "M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M12 11v2", color: "#30d158" },
      { href: "/admin/engagement", label: "Engagement", icon: "M4 20v-8M10 20V5M16 20v-6M21.5 20H2.5", color: "#0a84ff" },
      { href: "/admin/navigation", label: "Navigation", icon: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14", color: "#5e5ce6" },
      { href: "/admin/taps", label: "Taps", icon: "M9 11V5a2 2 0 0 1 4 0v6M13 10a2 2 0 0 1 4 0v4a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L4 14.6a1.8 1.8 0 0 1 3-1.9L9 15", color: "#5e5ce6" },
      { href: "/admin/recaps", label: "Recaps", icon: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4", color: "#ff9f0a" },
      { href: "/admin/charts", label: "Charts & health", icon: "M3 12h4l3-7 4 14 3-7h4", color: "#32ade6" },
    ],
  },
  {
    title: "People",
    sections: [
      { href: "/admin/users", label: "Users", icon: "M16 20c0-2.8-2.7-5-6-5s-6 2.2-6 5M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 20c0-2-1.2-3.7-3-4.5M16 3.5a4 4 0 0 1 0 7", color: "#ff9500" },
      { href: "/admin/leagues", label: "Leagues", icon: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7", color: "#0a84ff" },
      { href: "/admin/waitlist", label: "Waitlist", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2", color: "#d4a500" },
    ],
  },
  {
    title: "Health",
    sections: [
      { href: "/admin/errors", label: "Errors", icon: "M12 8v5M12 16.5v.5M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", color: "#ff3b30", badge: "errors" },
      { href: "/admin/crashes", label: "Crashes", icon: "M13 2 4 14h7l-1 8 9-12h-7z", color: "#ff2d55", badge: "crashes" },
      { href: "/admin/security", label: "Security", icon: "M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 8 0V11", color: "#8e8e93", badge: "security" },
      { href: "/admin/audit", label: "Audit Log", icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01", color: "#8e8e93" },
      { href: "/brain", label: "Brain", icon: "M12 4a3 3 0 0 0-5.6 1.5A3 3 0 0 0 4 10a3 3 0 0 0 1 5.5A3 3 0 0 0 9 20a3 3 0 0 0 3-1.5M12 4a3 3 0 0 1 5.6 1.5A3 3 0 0 1 20 10a3 3 0 0 1-1 5.5A3 3 0 0 1 15 20a3 3 0 0 1-3-1.5M12 4v14.5", color: "#bf5af2", page: true },
      { href: "/admin/ai-costs", label: "AI Costs", icon: "M12 3v18M16.3 7.4C15.7 5.9 14.1 5 12 5c-2.5 0-4.3 1.3-4.3 3.1 0 4.3 8.6 2.4 8.6 6.6 0 1.9-1.8 3.2-4.3 3.2-2.3 0-4-1-4.5-2.6", color: "#30b456" },
    ],
  },
];

const BADGE_POLL_MS = 60 * 1000;

// Every admin page renders through one layout (app/(app)/admin/
// layout.tsx), so usePathname() decides "active" here directly. On a
// phone every section is a pill in a wrapping grid — all visible at
// once, no sideways scrolling to discover the rest (the old single
// scrolling row hid everything past the fourth tab off-screen). At
// sm: and up it's a sticky sidebar grouped under headings.
//
// The red counts are the last 24 hours (GET /admin/badges): crashes,
// distinct errors, and failed sign-ins; Inbox's is what's open and not
// someone else's (GET /admin/inbox).
export function AdminNav() {
  const pathname = usePathname();
  const [badges, setBadges] = useState<(AdminBadges & { inbox: number }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      Promise.all([getAdminBadges(), getAdminInbox().catch(() => null)])
        .then(([b, inbox]) => !cancelled && setBadges({ ...b, inbox: inbox ? needsMe(inbox).length : 0 }))
        .catch(() => {});
    }
    load();
    const stop = startVisibleInterval(load, BADGE_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [pathname]);

  function isActive(href: string) {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-3 sm:sticky sm:top-4 sm:h-fit sm:w-48 sm:shrink-0">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold tracking-wider text-black/50 uppercase dark:text-white/50">
            {group.title}
          </span>
          <div className="grid grid-cols-2 gap-1 min-[420px]:grid-cols-3 sm:grid-cols-1">
            {group.sections.map((s) => {
              const active = isActive(s.href);
              const count = s.badge && badges ? badges[s.badge] : 0;
              const className = `flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-[color-mix(in_srgb,var(--admin-accent)_15%,transparent)] text-[var(--admin-accent)]"
                  : "bg-black/[0.03] text-black/65 hover:bg-black/5 sm:bg-transparent dark:bg-white/[0.04] dark:text-white/65 dark:hover:bg-white/5 sm:dark:bg-transparent"
              }`;
              const content = (
                <>
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: s.color }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={s.icon} />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {count > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-red-500 px-1.5 text-[10px] leading-4 font-bold text-white tabular-nums"
                      aria-label={s.badge === "inbox" ? `${count} open` : `${count} in the last 24 hours`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </>
              );
              return s.page ? (
                <a key={s.href} href={s.href} className={className}>
                  {content}
                </a>
              ) : (
                <Link key={s.href} href={s.href} className={className}>
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
