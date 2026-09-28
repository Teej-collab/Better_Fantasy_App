"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAdminBadges, type AdminBadges } from "@/lib/api";

type Section = { href: string; label: string; icon: string; badge?: keyof AdminBadges };

const GROUPS: { title: string; sections: Section[] }[] = [
  {
    title: "Usage",
    sections: [
      { href: "/admin", label: "Overview", icon: "◈" },
      { href: "/admin/live", label: "Live", icon: "◍" },
      { href: "/admin/engagement", label: "Engagement", icon: "◭" },
      { href: "/admin/navigation", label: "Navigation", icon: "◉" },
    ],
  },
  {
    title: "People",
    sections: [
      { href: "/admin/users", label: "Users", icon: "◐" },
      { href: "/admin/leagues", label: "Leagues", icon: "◆" },
    ],
  },
  {
    title: "Health",
    sections: [
      { href: "/admin/crashes", label: "Crashes", icon: "◬", badge: "crashes" },
      { href: "/admin/errors", label: "Errors", icon: "◮", badge: "errors" },
      { href: "/admin/security", label: "Security", icon: "◘", badge: "security" },
      { href: "/admin/audit", label: "Audit Log", icon: "◫" },
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
// distinct errors, and failed sign-ins.
export function AdminNav() {
  const pathname = usePathname();
  const [badges, setBadges] = useState<AdminBadges | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      getAdminBadges()
        .then((b) => !cancelled && setBadges(b))
        .catch(() => {});
    }
    load();
    const id = setInterval(load, BADGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pathname]);

  function isActive(href: string) {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-3 sm:sticky sm:top-4 sm:h-fit sm:w-48 sm:shrink-0">
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold tracking-wider text-black/40 uppercase dark:text-white/40">
            {group.title}
          </span>
          <div className="grid grid-cols-2 gap-1 min-[420px]:grid-cols-3 sm:grid-cols-1">
            {group.sections.map((s) => {
              const active = isActive(s.href);
              const count = s.badge && badges ? badges[s.badge] : 0;
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className={`flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[color-mix(in_srgb,var(--admin-accent)_15%,transparent)] text-[var(--admin-accent)]"
                      : "bg-black/[0.03] text-black/65 hover:bg-black/5 sm:bg-transparent dark:bg-white/[0.04] dark:text-white/65 dark:hover:bg-white/5 sm:dark:bg-transparent"
                  }`}
                >
                  <span aria-hidden className="text-xs">
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {count > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-red-500 px-1.5 text-[10px] leading-4 font-bold text-white tabular-nums"
                      aria-label={`${count} in the last 24 hours`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
