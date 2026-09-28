"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAdminBadges, type AdminBadges } from "@/lib/api";

const POLL_MS = 60 * 1000;

const ITEMS: { key: keyof AdminBadges; label: string; href: string }[] = [
  { key: "crashes", label: "Crashes", href: "/admin/crashes" },
  { key: "errors", label: "Errors", href: "/admin/errors" },
  { key: "security", label: "Failed sign-ins", href: "/admin/security" },
];

// Top of Overview: the last 24 hours of app health at a glance, each
// tile linking to its page. Green when quiet, red when not.
export function AdminHealthStrip() {
  const [badges, setBadges] = useState<AdminBadges | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      getAdminBadges()
        .then((b) => !cancelled && setBadges(b))
        .catch(() => {});
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="grid grid-cols-3 gap-2">
      {ITEMS.map((item) => {
        const n = badges?.[item.key];
        const bad = n !== undefined && n > 0;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`flex min-w-0 flex-col gap-0.5 rounded-xl border px-3 py-2 transition-colors ${
              bad
                ? "border-red-500/40 bg-red-500/10 hover:bg-red-500/15"
                : "border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10"
            }`}
          >
            <span className="truncate text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              {item.label} · 24h
            </span>
            <span className={`font-display text-xl font-semibold tabular-nums ${bad ? "text-red-500" : "text-emerald-500"}`}>
              {n === undefined ? "–" : n}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
