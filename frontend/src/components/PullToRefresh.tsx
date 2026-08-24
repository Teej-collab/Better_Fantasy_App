"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRefreshApplicationData } from "@/lib/usePullToRefresh";

const PULL_THRESHOLD_PX = 70; // distance to pull before "release to refresh"
const MAX_PULL_PX = 110; // the indicator caps out here regardless of how far the finger travels
const RESISTANCE = 0.5; // pulled distance grows slower than the raw finger movement, like iOS's own overscroll

type PullState = "idle" | "pulling" | "ready" | "refreshing";

/**
 * A native-feeling pull-to-refresh gesture, mounted once around the page
 * content in (app)/layout.tsx and (home)/layout.tsx (not /weekend — its
 * own chrome-free atmosphere isn't a "refresh my data" kind of screen).
 *
 * Safety is the whole point of the touchmove logic below: this only ever
 * takes over the gesture — calling preventDefault() to stop the browser's
 * own scroll/overscroll — once it has confirmed the page is scrolled all
 * the way to the top AND the finger is moving down, never on an upward
 * swipe, a sideways swipe, or a downward swipe that started mid-page. A
 * normal touchstart lower on the page, or a touchmove after the page has
 * scrolled away from the top mid-gesture, is left alone entirely for the
 * browser to handle as ordinary scrolling.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refresh = useRefreshApplicationData();
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const [pullState, setPullState] = useState<PullState>("idle");
  const [pullDistance, setPullDistance] = useState(0);
  const pullStateRef = useRef<PullState>("idle");
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || pullStateRef.current === "refreshing") {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
      activeRef.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0 || window.scrollY > 0) {
        // Not actually pulling down, or the page scrolled away from the
        // top mid-gesture — hand the gesture back to the browser.
        if (activeRef.current) {
          activeRef.current = false;
          pullStateRef.current = "idle";
          setPullState("idle");
          setPullDistance(0);
        }
        return;
      }

      activeRef.current = true;
      // Only takes over the gesture once a genuine downward pull at the
      // top is confirmed (the two checks above) — never on the very
      // first touchmove of an ordinary scroll.
      e.preventDefault();
      const distance = Math.min(delta * RESISTANCE, MAX_PULL_PX);
      const next: PullState = distance >= PULL_THRESHOLD_PX ? "ready" : "pulling";
      pullStateRef.current = next;
      setPullState(next);
      setPullDistance(distance);
    }

    function onTouchEnd() {
      startYRef.current = null;
      if (!activeRef.current) return;
      activeRef.current = false;

      if (pullStateRef.current === "ready") {
        pullStateRef.current = "refreshing";
        setPullState("refreshing");
        setPullDistance(PULL_THRESHOLD_PX);
        refreshRef.current();
        // The boot sequence replaying is itself the "refresh finished"
        // signal to the visitor — this timer just retires the pull
        // indicator once that's had time to take over the screen.
        setTimeout(() => {
          pullStateRef.current = "idle";
          setPullState("idle");
          setPullDistance(0);
        }, 900);
      } else {
        pullStateRef.current = "idle";
        setPullState("idle");
        setPullDistance(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <div ref={containerRef}>
      <div
        className="pull-to-refresh-indicator"
        aria-hidden={pullState === "idle"}
        style={{
          height: pullState === "idle" ? 0 : Math.max(pullDistance, pullState === "refreshing" ? PULL_THRESHOLD_PX : 0),
        }}
      >
        {pullState !== "idle" && (
          <div className={`pull-to-refresh-glyph ${pullState === "refreshing" ? "pull-to-refresh-glyph--spin" : ""}`}>
            {pullState === "refreshing" ? (
              <span className="pull-to-refresh-spinner" aria-label="Refreshing" />
            ) : (
              <span
                className="pull-to-refresh-arrow"
                style={{ transform: `rotate(${pullState === "ready" ? 180 : 0}deg)` }}
              >
                ↓
              </span>
            )}
            <span className="pull-to-refresh-label">
              {pullState === "refreshing" ? "Refreshing…" : pullState === "ready" ? "Release to refresh" : "Pull to refresh"}
            </span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
