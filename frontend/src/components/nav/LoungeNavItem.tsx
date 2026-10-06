"use client";

import Link from "next/link";
import { NavLink } from "@/components/nav/NavLink";
import { LoungeIcon } from "@/components/nav/icons";
import { NAV_ACCENT } from "@/lib/navDestinations";
import { useLoungeStatus } from "@/lib/useWatchPartyLive";

// The Lounge, front and center (2026-10): it used to live only in the
// account menu. Desktop gets a nav item, the phone bar a tab, and Home a
// banner — each lighting up LIVE (with how many are watching) when
// anyone's in the League Lounge or a watch party.

export function LoungeNavItem({ variant }: { variant: "desktop" | "bottom" }) {
  const { live, watching } = useLoungeStatus();
  if (variant === "bottom") {
    return (
      <NavLink
        href="/lounge"
        section="lounge"
        activeClassName="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium"
        inactiveClassName="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]"
        color={NAV_ACCENT}
        cosmicColor={NAV_ACCENT}
      >
        <span className="relative">
          <LoungeIcon className="h-6 w-6" />
          {live && <span className="live-dot absolute -top-0.5 -right-1" aria-hidden />}
        </span>
        Lounge
        {live && <span className="sr-only">, live now</span>}
      </NavLink>
    );
  }
  return (
    <NavLink
      href="/lounge"
      section="lounge"
      activeClassName="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
      inactiveClassName="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
      color={NAV_ACCENT}
      cosmicColor={NAV_ACCENT}
    >
      <LoungeIcon className="h-4 w-4" />
      <span className="flex flex-col items-start leading-none">
        Lounge
        {live && (
          <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-[var(--wl-live)] uppercase">
            <span className="live-dot" aria-hidden />
            Live{watching > 0 ? ` · ${watching}` : ""}
          </span>
        )}
      </span>
    </NavLink>
  );
}

/** Home's Lounge banner: live rooms first, otherwise the pitch. */
export function LoungeBanner() {
  const { live, watching, rooms } = useLoungeStatus();
  return (
    <Link
      href="/lounge"
      className="flex items-center gap-3 rounded-2xl border px-4 py-3 text-[#f3f4f6] no-underline"
      style={
        live
          ? { background: "linear-gradient(90deg, rgba(220,20,60,0.22), rgba(220,20,60,0.06))", borderColor: "rgba(220,20,60,0.5)" }
          : { background: "#12151d", borderColor: "rgba(255,255,255,0.1)" }
      }
    >
      <LoungeIcon className="h-7 w-7 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          {live && <span className="rounded bg-[#dc143c] px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">LIVE</span>}
          <b className="font-display text-base tracking-wide uppercase">The Lounge</b>
        </span>
        <span className="truncate text-xs text-[#c9cfd8]">
          {live
            ? `${watching} watching${rooms > 1 ? ` in ${rooms} rooms` : ""} — video, the game on the TV, and the league's fantasy moments live`
            : "Watch the games with the league: video chat, a shared TV, and every fantasy swing as it happens"}
        </span>
      </span>
      <span className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-extrabold" style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}>
        {live ? "Jump in" : "Open"}
      </span>
    </Link>
  );
}
