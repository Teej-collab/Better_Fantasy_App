"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import GridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { updateHomeDesktopLayout, updateHomeHiddenCards, type HomeGridLayoutItem } from "@/lib/api";

const COLS = 4;
const ROW_HEIGHT = 140;
const DEFAULT_W = 2;
const DEFAULT_H = 2;

// A sensible starting grid on first visit (or once a brand-new card
// type appears) — two columns wide, stacked in rows, rather than
// everything piled at (0,0). `startY` lets new items append below
// whatever's already laid out instead of overlapping it.
function defaultPositions(keys: string[], startY: number): HomeGridLayoutItem[] {
  return keys.map((key, i) => ({
    i: key,
    x: (i % 2) * DEFAULT_W,
    y: startY + Math.floor(i / 2) * DEFAULT_H,
    w: DEFAULT_W,
    h: DEFAULT_H,
  }));
}

// Reconciles a saved layout against what's actually visible right now:
// drops anything no longer present (hidden or genuinely gone), and
// appends a default position for anything visible that the saved
// layout doesn't know about yet (a newly-added-back card, or a brand
// new card type shipped later) — same "new keys get appended, not
// lost" spirit as the mobile side's mergeCardOrder.
function reconcileLayout(saved: HomeGridLayoutItem[] | null, visibleKeys: string[]): HomeGridLayoutItem[] {
  const kept = (saved ?? []).filter((item) => visibleKeys.includes(item.i));
  const knownKeys = new Set(kept.map((item) => item.i));
  const missing = visibleKeys.filter((key) => !knownKeys.has(key));
  const startY = kept.length > 0 ? Math.max(...kept.map((item) => item.y + item.h)) : 0;
  return [...kept, ...defaultPositions(missing, startY)];
}

/**
 * Desktop's resizable/reorderable home dashboard — a react-grid-layout
 * grid instead of HomeCardDeck's vertical list, since only desktop
 * supports freeform resize (per the owner's own call on scope). Mounted
 * instead of HomeCardDeck when useIsDesktop() is true; both receive
 * the exact same server-built `cards` map from (home)/page.tsx, so
 * only the interactive shell differs per breakpoint.
 *
 * "Edit Home" mode gates whether drag/resize are actually enabled —
 * outside edit mode this is a static, non-interactive arrangement, not
 * a hair-trigger drag surface. Add/remove reuses the exact same
 * home_hidden_cards preference HomeCardDeck.tsx writes to, so hiding a
 * card on mobile hides it on desktop too and vice versa — only its
 * *position/size* (home_desktop_layout) is a separate, desktop-only
 * preference, since mobile has no equivalent concept.
 */
export function HomeGridDesktop({
  cards,
  hiddenCards,
  cardLabels,
  savedLayout,
}: {
  cards: Record<string, ReactNode>;
  hiddenCards: string[];
  cardLabels: Record<string, string>;
  savedLayout: HomeGridLayoutItem[] | null;
}) {
  const router = useRouter();
  const { width, containerRef, mounted } = useContainerWidth();
  const visibleKeys = useMemo(() => Object.keys(cards), [cards]);
  const [layout, setLayout] = useState<HomeGridLayoutItem[]>(() => reconcileLayout(savedLayout, visibleKeys));
  const [localHidden, setLocalHidden] = useState<string[]>(hiddenCards);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  function handleLayoutChange(next: Layout) {
    const plain: HomeGridLayoutItem[] = next.map((item) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));
    setLayout(plain);
    updateHomeDesktopLayout(plain).catch(() => {
      // Background save — same swallowed-catch convention as
      // HomeCardDeck.tsx; the next load falls back to the last save
      // that did succeed.
    });
  }

  function removeCard(key: string) {
    const next = [...localHidden, key];
    setLocalHidden(next);
    updateHomeHiddenCards(next).catch(() => {});
  }

  function addCard(key: string) {
    const next = localHidden.filter((k) => k !== key);
    setLocalHidden(next);
    setShowPicker(false);
    updateHomeHiddenCards(next)
      .then(() => router.refresh())
      .catch(() => {
        setLocalHidden((prev) => (prev.includes(key) ? prev : [...prev, key]));
      });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
        >
          {editing ? "Done" : "Edit Home"}
        </button>
      </div>

      <div ref={containerRef}>
        {mounted && (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [16, 16] }}
            dragConfig={{ enabled: editing, handle: ".grid-drag-handle" }}
            resizeConfig={{ enabled: editing }}
            onLayoutChange={handleLayoutChange}
          >
            {visibleKeys.map((key) => (
              <div key={key} className="group relative overflow-auto">
                {editing && (
                  <>
                    <button
                      type="button"
                      aria-label="Drag to move or resize"
                      className="grid-drag-handle absolute top-1 left-1 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-md bg-[var(--background)]/80 text-black/40 active:cursor-grabbing dark:text-white/40"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                        <circle cx="6" cy="5" r="1.4" />
                        <circle cx="6" cy="10" r="1.4" />
                        <circle cx="6" cy="15" r="1.4" />
                        <circle cx="13" cy="5" r="1.4" />
                        <circle cx="13" cy="10" r="1.4" />
                        <circle cx="13" cy="15" r="1.4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCard(key)}
                      aria-label="Remove this box"
                      className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-[var(--background)]/80 text-red-500/70 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </>
                )}
                <div className="h-full">{cards[key]}</div>
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {editing && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            disabled={localHidden.length === 0}
            className="w-full rounded-xl border border-dashed border-black/15 py-4 text-sm font-medium text-black/50 hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-white/50 dark:hover:bg-white/[0.02]"
          >
            {localHidden.length === 0 ? "Everything's already showing" : "+ Add Box"}
          </button>
          {showPicker && localHidden.length > 0 && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 flex flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900">
              {localHidden.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => addCard(key)}
                  className="px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {cardLabels[key] ?? key}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
