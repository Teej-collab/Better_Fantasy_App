"use client";

import { useEffect, useRef, useState } from "react";
import { MoreIcon } from "@/components/nav/icons";

type Group = { heading: string; links: { href: string; label: string }[] };

const GROUPS: Group[] = [
  {
    heading: "Fantasy",
    links: [
      { href: "/players", label: "Player Cards" },
      { href: "/free-agents", label: "Free Agents" },
    ],
  },
  {
    heading: "League",
    links: [
      { href: "/seasons/latest/awards", label: "Awards" },
      { href: "/rivalries", label: "Rivalries" },
      { href: "/rules", label: "Rules" },
    ],
  },
  {
    heading: "Other",
    links: [{ href: "/chug", label: "Chug Leaderboard" }],
  },
];

/**
 * Mobile-only secondary-feature access, replacing what used to just be
 * more links crammed into the horizontal-scroll strip. Same bottom-
 * sheet overlay pattern AccountMenu.tsx already established (scrim,
 * outside-click/Escape close, focus moved into the sheet on open) —
 * this is the "More" tab itself, not just its content, since the
 * trigger needs the exact same active/inactive visual treatment as
 * every other bottom-nav item.
 */
export function MoreSheet({ awardsHref }: { awardsHref: string }) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (sheetRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const raf = requestAnimationFrame(() => firstLinkRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  const groups = GROUPS.map((g) =>
    g.heading === "League"
      ? { ...g, links: g.links.map((l) => (l.href === "/seasons/latest/awards" ? { ...l, href: awardsHref } : l)) }
      : g
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors ${
          open ? "text-[color:var(--foreground)]" : "text-black/45 dark:text-white/45"
        }`}
      >
        <MoreIcon className="h-6 w-6" strokeWidth={open ? 2 : 1.75} />
        More
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={sheetRef}
            role="menu"
            aria-label="More"
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-4 rounded-t-2xl border-t border-black/10 bg-[var(--background)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-white/10"
          >
            <div className="mx-auto h-1 w-9 rounded-full bg-black/15 dark:bg-white/15" aria-hidden />
            {groups.map((group, gi) => (
              <div key={group.heading} className="flex flex-col gap-1">
                <h2 className="px-1 text-xs font-semibold tracking-wide text-black/40 uppercase dark:text-white/40">
                  {group.heading}
                </h2>
                {group.links.map((link, li) => (
                  <a
                    key={link.href}
                    ref={gi === 0 && li === 0 ? firstLinkRef : undefined}
                    href={link.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm text-black/80 outline-none transition-colors hover:bg-black/5 focus-visible:bg-black/5 dark:text-white/80 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
