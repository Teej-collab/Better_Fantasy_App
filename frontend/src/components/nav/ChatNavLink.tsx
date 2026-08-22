"use client";

import { usePathname } from "next/navigation";
import { useUnreadChatCount } from "@/lib/useUnreadChatCount";
import { isSectionActive } from "@/components/nav/NavLink";
import { ChatIcon } from "@/components/nav/icons";

// Chat needs its own real unread count (client-fetched — see
// useUnreadChatCount's own comment on why), so unlike every other
// primary item it can't be plain NavLink + static children. One
// component covers both the desktop text-link style and the mobile
// icon+label+badge stack rather than duplicating the fetch/active-
// state logic across two near-identical files.
export function ChatNavLink({ variant }: { variant: "primary" | "bottom" }) {
  const pathname = usePathname();
  const active = isSectionActive("chat", pathname);
  const unread = useUnreadChatCount();

  if (variant === "bottom") {
    return (
      <a
        href="/chat"
        aria-current={active ? "page" : undefined}
        className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors ${
          active ? "text-[color:var(--foreground)]" : "text-black/45 dark:text-white/45"
        }`}
      >
        <ChatIcon className="h-6 w-6" strokeWidth={active ? 2 : 1.75} />
        Chat
        {unread > 0 && (
          <span className="absolute top-0.5 right-[calc(50%-1.35rem)] flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1 text-[9px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </a>
    );
  }

  return (
    <a
      href="/chat"
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-black/[0.06] text-[color:var(--foreground)] dark:bg-white/[0.08]"
          : "text-black/60 hover:bg-black/[0.03] hover:text-black dark:text-white/60 dark:hover:bg-white/[0.04] dark:hover:text-white"
      }`}
    >
      Chat
      {unread > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1 text-[10px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </a>
  );
}
