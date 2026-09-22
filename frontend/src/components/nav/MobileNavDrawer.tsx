"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { clearSession } from "@/lib/logout";
import { useUnreadChatCount } from "@/lib/useUnreadChatCount";
import { useWatchPartyLive } from "@/lib/useWatchPartyLive";
import { NavLink, isSectionActive, type NavSection } from "@/components/nav/NavLink";
import { BrandMark } from "@/components/BrandMark";
import { ChatIcon, GamecastIcon, HomeIcon, LeagueIcon, LoungeIcon, MatchupsIcon, TeamIcon } from "@/components/nav/icons";
import { NAV_ACCENT } from "@/lib/navDestinations";

// How long the slide/fade takes both ways — kept in one place since the
// close path's setTimeout (unmounting the portal once the animation
// finishes) has to agree with the CSS transition duration below, or the
// panel would either vanish early (a visible jump-cut) or linger
// invisible after its own transition already finished.
const TRANSITION_MS = 250;
const SWIPE_CLOSE_THRESHOLD_PX = 60;

const ITEM_CLASS = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium";

/**
 * Settings > Labs > "Try the new look" (owner_preferences.beta_layout)
 * mobile chrome — replaces NavBar.tsx's sticky header + BottomNavBeta
 * with a compact hamburger trigger and this slide-in drawer, reclaiming
 * the vertical space both used to permanently reserve. Legacy (non-
 * beta) mobile and ALL of desktop (this renders nothing above `sm:`)
 * are completely untouched — see NavBar.tsx's own comment for the
 * branch that decides which chrome a visitor gets.
 *
 * Modeled on AccountMenu.tsx's already-proven a11y plumbing (portal to
 * document.body, Escape-to-close, click-outside via a document
 * `mousedown` listener, focus returns to the trigger on close) rather
 * than inventing a new pattern — the one addition here is the open/
 * close animation (AccountMenu's menu has no transition) and swipe-to-
 * close, since a full-height drawer reads as static/broken without
 * either on a real device.
 *
 * `mounted` vs. `visible` is what makes the close animation possible at
 * all: unmounting the instant a close is requested (as a plain `open &&
 * portal` would) skips the transition entirely. `mounted` keeps the
 * portal in the DOM for the outgoing transition's duration; `visible`
 * is the class that's actually animated, toggled a frame after mount so
 * the browser has a "closed" state to transition away from rather than
 * painting already-open.
 */
export function MobileNavDrawer({
  signedIn,
  displayName,
  isCommissioner,
  isSiteOwner,
  activeLeagueName,
  matchupsHref,
  isGameDay,
}: {
  signedIn: boolean;
  displayName: string | null;
  isCommissioner: boolean;
  isSiteOwner: boolean;
  // Null for a signed-out visitor or a signed-in one with no active
  // league yet — real data (getActiveLeagueName, the same helper
  // LeagueSubNav's own chip already uses), not a placeholder, since
  // /leagues and league-switching already exist in this app today.
  activeLeagueName: string | null;
  matchupsHref: string;
  isGameDay: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const unread = useUnreadChatCount();
  const watchPartyLive = useWatchPartyLive();

  function open() {
    setMounted(true);
    // Two rAFs: the first lets the portal actually mount with its
    // closed (translated/transparent) classes applied; the second is
    // the frame the browser paints that closed state in, so the
    // subsequent `visible(true)` class change has something to
    // transition from instead of the open state simply appearing.
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  }

  function close() {
    setVisible(false);
    triggerRef.current?.focus();
    window.setTimeout(() => setMounted(false), TRANSITION_MS);
  }

  // Safety net for browser back/forward (a Link tap inside the drawer
  // already calls close() itself before navigating, via onNavigate/
  // onClick below — this only ever fires for the case those miss).
  // Deliberately not a useEffect keyed on `pathname`: an effect that
  // calls setState synchronously in reaction to a prop/state change
  // (rather than from an actual event, e.g. a listener the effect
  // itself registered) is exactly the "you might not need an effect"
  // anti-pattern React's own docs warn about, since it's really a
  // render-time state adjustment wearing an effect's clothes. useState
  // (not useRef — mutating a ref during render is its own separate
  // anti-pattern the lint config here also forbids) tracking the last
  // seen pathname, compared and conditionally reset during render, is
  // React's own documented pattern for this exact case ("Adjusting some
  // state when a prop changes"). Skips the fade-out and focus-return
  // close() otherwise does: the page content already changed abruptly
  // under back/forward navigation, so an instant close reads as correct
  // here, not as a missing animation.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (mounted) {
      setVisible(false);
      setMounted(false);
    }
  }

  // Publishes exactly how far down the real, rendered trigger button
  // reaches — every page's own top clearance (globals.css's
  // `--hamburger-clear-bottom`, read by `.wl-page-shell`/`.wl-ticker-
  // bar`) reads this instead of a hardcoded buffer guess. Real report,
  // 2026-09-17: the fixed 6rem guess (already bumped once, 2026-09-16,
  // from a smaller number) still overlapped Chat's own header on a
  // real iPhone 16 Pro — a hardcoded number can never actually account
  // for every device's own status-bar/Dynamic-Island/safe-area height,
  // only measuring the real element can. Same mount+resize pattern
  // ChatApp.tsx's own `--chat-top-offset` already uses for the same
  // reason. The env(safe-area-inset-top) fallback CSS still uses is
  // only for the brief pre-hydration paint before this effect runs.
  useEffect(() => {
    function measure() {
      if (!triggerRef.current) return;
      const bottom = triggerRef.current.getBoundingClientRect().bottom;
      // A little real breathing room below the button itself, not
      // another blind buffer guess — the button's own bottom edge is
      // now a real, per-device-correct number.
      document.documentElement.style.setProperty("--hamburger-clear-bottom", `${Math.ceil(bottom) + 20}px`);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [mounted]);

  function handleTouchStart(e: TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta < -SWIPE_CLOSE_THRESHOLD_PX) close();
  }

  async function handleLogout() {
    close();
    await clearSession();
    router.push("/");
    router.refresh();
  }

  const primaryItems: {
    key: NavSection;
    href: string;
    label: string;
    Icon: typeof HomeIcon;
    show: boolean;
    live?: boolean;
    // "Live" reads correctly for Gamecast (a real NFL game is live);
    // reused as-is for Chat would wrongly imply the chat itself is
    // live, so that one overrides it to name what's actually live.
    liveLabel?: string;
    badge?: number;
  }[] = [
    { key: "home" as const, href: "/", label: "Home", Icon: HomeIcon, show: true },
    { key: "team" as const, href: "/team", label: "My Team", Icon: TeamIcon, show: signedIn },
    { key: "league" as const, href: "/league", label: "League", Icon: LeagueIcon, show: true },
    { key: "matchups" as const, href: matchupsHref, label: "Matchup", Icon: MatchupsIcon, show: true },
    { key: "gamecast" as const, href: "/gamecast", label: "Gamecast", Icon: GamecastIcon, show: true, live: isGameDay },
    {
      key: "chat" as const,
      href: "/chat",
      label: "Chat",
      Icon: ChatIcon,
      show: signedIn,
      badge: unread,
      live: watchPartyLive,
      liveLabel: "In Room",
    },
    // Right after Chat, not buried in secondaryItems below — a
    // password-protected watch-party room a visitor creates and shares
    // is exactly the kind of thing that needs to be found in one tap,
    // not discovered by scrolling past Settings/Notifications/Feedback
    // (2026-09, reported hard to navigate to from the drawer).
    { key: "lounge" as const, href: "/lounge", label: "Lounge", Icon: LoungeIcon, show: signedIn },
  ].filter((item) => item.show);

  const secondaryItems = signedIn
    ? [
        { key: "settings", href: "/settings", label: "Settings" },
        { key: "notifications", href: "/settings?section=notifications", label: "Notifications" },
        { key: "feedback", href: "/settings?section=feedback", label: "Feedback" },
        ...(isCommissioner ? [{ key: "commissioner", href: "/commissioner", label: "Commissioner Tools" }] : []),
        ...(isSiteOwner ? [{ key: "admin", href: "/admin", label: "Admin" }] : []),
      ]
    : [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (mounted ? close() : open())}
        aria-label={mounted ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mounted}
        aria-controls="mobile-nav-drawer"
        className="fixed left-3 z-40 flex h-11 w-11 items-center justify-center rounded-full transition-colors active:scale-95 sm:hidden"
        style={{
          top: "calc(env(safe-area-inset-top) + 0.75rem)",
          background: "var(--wl-surface)",
          border: "1px solid var(--wl-border)",
        }}
      >
        <span className="relative flex h-3.5 w-5 flex-col justify-between" aria-hidden>
          <span
            className="wl-drawer-bar h-0.5 w-full rounded-full transition-transform duration-200"
            style={{ background: "var(--wl-text)", transform: mounted ? "translateY(6px) rotate(45deg)" : "none" }}
          />
          <span
            className="wl-drawer-bar h-0.5 w-full rounded-full transition-opacity duration-150"
            style={{ background: "var(--wl-text)", opacity: mounted ? 0 : 1 }}
          />
          <span
            className="wl-drawer-bar h-0.5 w-full rounded-full transition-transform duration-200"
            style={{ background: "var(--wl-text)", transform: mounted ? "translateY(-6px) rotate(-45deg)" : "none" }}
          />
        </span>
      </button>

      {mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 sm:hidden">
            <div
              className={`wl-drawer-scrim absolute inset-0 bg-black/50 transition-opacity ${visible ? "opacity-100" : "opacity-0"}`}
              style={{ transitionDuration: `${TRANSITION_MS}ms` }}
              onClick={close}
              aria-hidden
            />
            <div
              ref={panelRef}
              id="mobile-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              tabIndex={-1}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              className={`wl-drawer-panel absolute inset-y-0 left-0 flex w-[82vw] max-w-xs flex-col overflow-y-auto transition-transform ease-out ${
                visible ? "translate-x-0" : "-translate-x-full"
              }`}
              style={{
                background: "var(--wl-bg)",
                borderRight: "1px solid var(--wl-border)",
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
                transitionDuration: `${TRANSITION_MS}ms`,
              }}
            >
              <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
                <BrandMark href="/" />
                {signedIn ? (
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold" style={{ color: "var(--wl-text)" }}>
                      {displayName}
                    </span>
                    {isCommissioner && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: "var(--wl-accent)" }}
                        role="img"
                        aria-label="Commissioner"
                        title="Commissioner"
                      />
                    )}
                  </div>
                ) : (
                  <Link href="/login" onClick={close} className="text-sm font-semibold" style={{ color: "var(--wl-accent)" }}>
                    Sign in →
                  </Link>
                )}
              </div>

              {signedIn && (
                <>
                  <div className="mx-4 h-px shrink-0" style={{ background: "var(--wl-border)" }} />
                  <Link
                    href="/leagues"
                    onClick={close}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                    style={{ color: "var(--wl-text-secondary)" }}
                  >
                    <span className="truncate">{activeLeagueName ?? "Your league"}</span>
                    <span className="shrink-0" style={{ color: "var(--wl-accent)" }}>
                      Switch ›
                    </span>
                  </Link>
                </>
              )}

              <div className="mx-4 h-px shrink-0" style={{ background: "var(--wl-border)" }} />

              <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2 py-2">
                {primaryItems.map((item) => {
                  const active = isSectionActive(item.key, pathname);
                  return (
                    <NavLink
                      key={item.key}
                      href={item.href}
                      section={item.key}
                      activeClassName={ITEM_CLASS}
                      inactiveClassName={ITEM_CLASS}
                      color={NAV_ACCENT}
                      onNavigate={close}
                    >
                      <item.Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.75} />
                      {item.label}
                      {item.live && (
                        <span
                          className="ml-auto text-[10px] font-semibold tracking-wide uppercase"
                          style={{ color: "var(--wl-live)" }}
                        >
                          {item.liveLabel ?? "Live"}
                        </span>
                      )}
                      {!!item.badge && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1 text-[9px] font-semibold text-white">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </nav>

              {secondaryItems.length > 0 && (
                <>
                  <div className="mx-4 h-px shrink-0" style={{ background: "var(--wl-border)" }} />
                  <nav aria-label="Secondary" className="flex flex-col gap-0.5 px-2 py-2">
                    {secondaryItems.map((item) => (
                      <Link
                        key={item.key}
                        href={item.href}
                        onClick={close}
                        className="rounded-lg px-3 py-2.5 text-sm"
                        style={{ color: "var(--wl-text-secondary)" }}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </nav>
                </>
              )}

              {signedIn && (
                <>
                  <div className="mx-4 mt-auto h-px shrink-0" style={{ background: "var(--wl-border)" }} />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mx-2 mb-2 shrink-0 rounded-lg px-3 py-2.5 text-left text-sm text-red-400"
                  >
                    Log Out
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
