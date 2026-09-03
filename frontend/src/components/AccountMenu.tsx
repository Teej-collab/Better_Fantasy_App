"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearSession } from "@/lib/logout";

export type Me = { user_id: number; owner_id: number; display_name: string | null; is_commissioner: boolean };

/**
 * Replaces the old plain "{name} / Sign out" pair in AuthStatus.tsx —
 * the user's own identity is now the entry point to everything
 * account-related (Profile, Settings, Notifications, Log Out), not
 * just a settings link plus a sign-out button sitting side by side.
 *
 * One markup tree serves both breakpoints (no separate mobile/desktop
 * component): a fixed bottom sheet by default, switching to an
 * absolutely-positioned anchored popover at `sm:` and up via Tailwind
 * responsive classes — CSS handles the positional switch, the open/
 * close/focus logic below doesn't need to know which one is showing.
 *
 * The scrim + panel render through a portal into document.body rather
 * than as a normal child. NavBar's header has backdrop-blur-sm, and per
 * the CSS spec any element with a non-none backdrop-filter establishes a
 * new containing block for its position: fixed descendants — without the
 * portal, this menu's `fixed inset-x-0 bottom-0` mobile sheet resolves
 * against the header's own short box instead of the viewport, so it
 * opens upward off the top of the screen instead of from the bottom.
 */
export function AccountMenu({ me }: { me: Me }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = itemRefs.current.filter((el): el is HTMLElement => el !== null);
      if (items.length === 0) return;
      const currentIndex = items.findIndex((el) => el === document.activeElement);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = items[(currentIndex + delta + items.length) % items.length];
      next.focus();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    // Land keyboard focus on the first item — a menu that opens without
    // moving focus into it isn't keyboard-navigable at all.
    const raf = requestAnimationFrame(() => itemRefs.current[0]?.focus());
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await clearSession();
    // Same reasoning as the old AuthStatus.tsx logout: the homepage's
    // signed-out gate is decided server-side from the session cookie,
    // so refresh() is required to actually re-run that check against
    // the now-deleted cookie, not just push() to a possibly-cached RSC
    // payload from before logout.
    router.push("/");
    router.refresh();
  }

  const items: { key: string; label: string; href?: string; onClick?: () => void; danger?: boolean }[] = [
    { key: "profile", label: "Profile", href: "/settings?section=profile" },
    { key: "leagues", label: "Leagues", href: "/leagues" },
    // Commissioner-only — the one place a commissioner needs to find
    // their league's admin tools, right under their own name rather
    // than a small text link buried on the League page (2026-09).
    ...(me.is_commissioner
      ? [{ key: "commissioner", label: "Commissioner Tools", href: "/commissioner" }]
      : []),
    { key: "settings", label: "Settings", href: "/settings" },
    { key: "notifications", label: "Notifications", href: "/settings?section=notifications" },
    { key: "logout", label: "Log Out", onClick: handleLogout, danger: true },
  ];

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-black/70 transition-colors hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wl-accent)] dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <span className="max-w-[8rem] truncate">{me.display_name}</span>
        {me.is_commissioner && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--wl-accent)]"
            role="img"
            aria-label="Commissioner"
            title="Commissioner"
          />
        )}
        <span aria-hidden className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <>
            {/* Scrim — mobile only; desktop close-on-outside-click is
                handled by the document listener above without dimming
                the page, matching a native app menu rather than a modal. */}
            <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => setOpen(false)} aria-hidden />

            <div
              ref={menuRef}
              role="menu"
              aria-label="Account menu"
              className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-0.5 rounded-t-2xl border-t border-black/10 bg-[var(--background)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:top-full sm:mt-2 sm:w-56 sm:rounded-xl sm:border sm:border-black/10 sm:pb-2 sm:shadow-lg dark:border-white/10"
            >
              <div className="flex flex-col gap-0.5 px-3 py-2 sm:px-2">
                <span className="truncate text-sm font-semibold">{me.display_name}</span>
                {me.is_commissioner && (
                  <span className="text-xs text-[var(--wl-accent)]">Commissioner</span>
                )}
              </div>
              <div className="my-1 h-px bg-black/10 dark:bg-white/10" />

              {items.map((item, i) => (
                <div key={item.key}>
                  {item.danger && i > 0 && !items[i - 1].danger && (
                    <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
                  )}
                  {item.href ? (
                    <Link
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className="block rounded-lg px-3 py-2.5 text-sm text-black/80 outline-none transition-colors hover:bg-black/5 focus-visible:bg-black/5 sm:py-2 dark:text-white/80 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <button
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      type="button"
                      role="menuitem"
                      onClick={item.onClick}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-500 outline-none transition-colors hover:bg-red-500/10 focus-visible:bg-red-500/10 sm:py-2"
                    >
                      {item.label}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
