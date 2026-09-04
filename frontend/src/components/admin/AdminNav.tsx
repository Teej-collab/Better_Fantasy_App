"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/admin", label: "Overview", icon: "◈" },
  { href: "/admin/users", label: "Users", icon: "◐" },
  { href: "/admin/leagues", label: "Leagues", icon: "◆" },
  { href: "/admin/navigation", label: "Navigation", icon: "◉" },
] as const;

// One markup tree for both breakpoints, same approach AccountMenu.tsx
// uses — a persistent left sidebar at sm: and up, a horizontal
// scrollable pill row on mobile (simpler and more robust here than a
// drawer/bottom-sheet: this is a 4-item list, not deep enough to need
// one). usePathname() decides "active" directly rather than each page
// passing it in — unlike LeagueSubNav.tsx's per-page pattern, every
// admin page already renders through this one shared layout
// (app/(app)/admin/layout.tsx), so there's no per-page prop to thread.
export function AdminNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  return (
    <nav
      aria-label="Admin sections"
      className="flex gap-1 overflow-x-auto pb-1 sm:sticky sm:top-4 sm:h-fit sm:w-44 sm:shrink-0 sm:flex-col sm:overflow-visible sm:pb-0"
    >
      {SECTIONS.map((s) => {
        const active = isActive(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:rounded-lg sm:px-3 sm:py-2 ${
              active
                ? "bg-[color-mix(in_srgb,var(--admin-accent)_15%,transparent)] text-[var(--admin-accent)]"
                : "text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"
            }`}
          >
            <span aria-hidden className="text-xs">
              {s.icon}
            </span>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
