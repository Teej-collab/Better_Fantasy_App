"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getMyLeagues, selectLeague, type League } from "@/lib/leaguesApi";

/**
 * Turns LeagueSubNav's own read-only "active league" chip into a real
 * quick-switcher — see backend/TODO.md's PHASE 9 entry: the backend
 * (resolve_active_league_id/require_league_access) and POST /leagues/
 * {id}/select have been fully ready for this since Phase 5, and
 * /leagues page already has its own "Switch to this league" button,
 * but reaching a different league from anywhere else in the app still
 * meant navigating away to /leagues first. This is the missing piece:
 * an inline dropdown, reachable from the top of every League-family
 * page (standings, matchups, awards, chug, etc. — everywhere
 * LeagueSubNav already renders), for a visitor who belongs to more
 * than one league.
 *
 * Same accessible-menu shape as AccountMenu.tsx (portal into
 * document.body, mobile bottom-sheet / desktop popover via responsive
 * classes, click-outside + Escape + arrow-key navigation) — reusing
 * that established pattern rather than inventing a second one.
 *
 * Leagues are fetched lazily on first open (getMyLeagues(), the same
 * client-callable /leagues/mine request /leagues/page.tsx already
 * uses), not eagerly on every League-family page render — most opens
 * of a page like Standings never touch this menu at all, and the
 * chip's own label (activeLeagueName) is already provided server-side
 * by the page that renders LeagueSubNav, so there's nothing to fetch
 * just to show the trigger.
 */
export function LeagueSwitcher({ activeLeagueName }: { activeLeagueName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [activeLeagueId, setActiveLeagueId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!open || leagues || loadError) return;
    let cancelled = false;
    getMyLeagues()
      .then(({ leagues, activeLeagueId }) => {
        if (!cancelled) {
          setLeagues(leagues);
          setActiveLeagueId(activeLeagueId);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leagues, loadError]);

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
    const raf = requestAnimationFrame(() => itemRefs.current[0]?.focus());
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(raf);
    };
  }, [open, leagues]);

  async function handleSelect(league: League) {
    if (switchingId !== null) return;
    setSwitchingId(league.id);
    try {
      await selectLeague(league.id);
      setActiveLeagueId(league.id);
      setOpen(false);
      // Every league-scoped read on the page underneath (standings,
      // matchups, awards, ...) is server-rendered from the session's
      // active_league_id (require_league_access et al.) — a client nav
      // alone wouldn't re-run those, only a real refresh does.
      router.refresh();
    } catch {
      // Leaves the menu open with the picked item's spinner cleared —
      // same "fail quiet, let them retry" posture as leagues/page.tsx's
      // own switch button.
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="ml-auto flex max-w-[12rem] items-center gap-1 truncate rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-110"
        style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)", color: "var(--wl-text-secondary)" }}
        title="Switch league"
      >
        <span className="truncate">{activeLeagueName}</span>
        <span aria-hidden className={`shrink-0 text-[9px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => setOpen(false)} aria-hidden />
            <div
              ref={menuRef}
              role="menu"
              aria-label="Switch league"
              className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-0.5 rounded-t-2xl border-t border-black/10 bg-[var(--background)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:top-full sm:mt-2 sm:w-64 sm:rounded-xl sm:border sm:border-black/10 sm:pb-2 sm:shadow-lg dark:border-white/10"
            >
              <div className="px-3 py-2 sm:px-2">
                <span className="text-sm font-semibold">Your leagues</span>
              </div>
              <div className="my-1 h-px bg-black/10 dark:bg-white/10" />

              {loadError && (
                <p className="px-3 py-2 text-sm" style={{ color: "var(--wl-text-secondary)" }}>
                  Couldn&apos;t load your leagues — try again.
                </p>
              )}
              {!leagues && !loadError && (
                <p className="px-3 py-2 text-sm" style={{ color: "var(--wl-text-secondary)" }}>
                  Loading…
                </p>
              )}
              {leagues?.map((league, i) => {
                const isActive = league.id === activeLeagueId;
                return (
                  <button
                    key={league.id}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={isActive || switchingId !== null}
                    onClick={() => handleSelect(league)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-black/5 focus-visible:bg-black/5 disabled:cursor-default sm:py-2 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  >
                    <span className="truncate">{league.name}</span>
                    {isActive && (
                      <span className="shrink-0 text-xs" style={{ color: "var(--wl-accent)" }}>
                        ✓
                      </span>
                    )}
                    {switchingId === league.id && (
                      <span className="shrink-0 text-xs" style={{ color: "var(--wl-text-secondary)" }}>
                        …
                      </span>
                    )}
                  </button>
                );
              })}

              <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
              <Link
                ref={(el) => {
                  itemRefs.current[leagues?.length ?? 0] = el;
                }}
                href="/leagues"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm outline-none transition-colors hover:bg-black/5 focus-visible:bg-black/5 sm:py-2 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                style={{ color: "var(--wl-accent)" }}
              >
                Manage leagues
              </Link>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
