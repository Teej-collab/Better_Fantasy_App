"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useUnreadChatCount } from "@/lib/useUnreadChatCount";
import { isSectionActive } from "@/components/nav/NavLink";
import { ChatIcon } from "@/components/nav/icons";
import { DESTINATIONS, NAV_ACCENT } from "@/lib/navDestinations";

// Chat needs its own real unread count (client-fetched — see
// useUnreadChatCount's own comment on why), so unlike every other
// primary item it can't be plain NavLink + static children. One
// component covers the desktop text-link style, the (retired) mobile
// icon+label+badge stack, and the icon-only header bubble rather than
// duplicating the fetch/active-state logic across separate files.
const CHAT_COLOR = NAV_ACCENT;

// "header": chat's only home as of 2026-09-02 — a fixed icon-only
// bubble next to the account menu (NavBar.tsx), the same spot on every
// screen size, replacing its old "primary"/"bottom" tab-bar slots
// entirely (see navDestinations.ts's PRIMARY_NAV_ORDER/MOBILE_NAV_ORDER
// comment for why: the owner found the mobile bar's 6 tabs crowded).
// "primary"/"bottom" are kept, unused today, in case a nav slot is
// ever reintroduced rather than deleting working, still-correct code.
export function ChatNavLink({ variant }: { variant: "primary" | "bottom" | "header" }) {
  const pathname = usePathname();
  const active = isSectionActive("chat", pathname);
  const unread = useUnreadChatCount();
  const navColorStyle = {
    ["--nav-color" as string]: CHAT_COLOR,
    ["--nav-color-cosmic" as string]: DESTINATIONS.chat.color,
  };

  if (variant === "header") {
    return (
      <Link
        href="/chat"
        aria-current={active ? "page" : undefined}
        aria-label="Chat"
        className="neon-navlink relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={navColorStyle}
      >
        <ChatIcon className="h-5 w-5" strokeWidth={active ? 2 : 1.75} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1 text-[9px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    );
  }

  if (variant === "bottom") {
    return (
      <Link
        href="/chat"
        aria-current={active ? "page" : undefined}
        className="neon-navlink relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]"
        style={navColorStyle}
      >
        <ChatIcon className="h-6 w-6" strokeWidth={active ? 2 : 1.75} />
        Chat
        {unread > 0 && (
          <span className="absolute top-0.5 right-[calc(50%-1.35rem)] flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1 text-[9px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href="/chat"
      aria-current={active ? "page" : undefined}
      className="neon-navlink relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
      style={navColorStyle}
    >
      Chat
      {unread > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1 text-[10px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
