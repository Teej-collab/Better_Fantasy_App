"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getPreferences, updateHomeCardOrder } from "@/lib/api";

// Matches the backend's own _VALID_HOME_CARD_KEYS (app/routers/settings.py)
// and today's default visual order — the order a first-time visitor (or
// anyone whose saved home_card_order doesn't parse) sees.
export const DEFAULT_HOME_CARD_ORDER = [
  "yourWeek",
  "awards",
  "standings",
  "powerRankings",
  "matchups",
  "rivalries",
  "discover",
];

function parseOrder(raw: string | null | undefined, present: string[]): string[] {
  const presentSet = new Set(present);
  let base = DEFAULT_HOME_CARD_ORDER;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string" && DEFAULT_HOME_CARD_ORDER.includes(k))) {
        base = parsed as string[];
      }
    } catch {
      // fall through to the default order below
    }
  }
  // A saved order can predate a card that's newly present, or omit one
  // that's absent this week — reconcile against what's actually here
  // rather than trusting the saved list verbatim.
  const known = base.filter((k) => presentSet.has(k));
  const missing = DEFAULT_HOME_CARD_ORDER.filter((k) => presentSet.has(k) && !known.includes(k));
  return [...known, ...missing];
}

/**
 * Lets a signed-in owner drag-and-drop reorder the homepage's six main
 * cards — Your Week, Standings, Matchups, Rivalries, Awards, and
 * Discover. Reorder-only (no hide/show, no resize): every card that
 * has something to show this week is always shown, in whatever order
 * the owner last dragged it to, at the same full-width `gap-6` spacing
 * this page already uses everywhere else. `cards` is built server-side
 * by (home)/page.tsx — a key is only present when that card has real
 * content to show this week.
 *
 * Drag handles only appear in "Edit Home" mode so normal browsing has
 * zero extra chrome. Reordering saves optimistically (local state
 * updates instantly; the PUT happens in the background with a
 * swallowed `.catch()`, same convention NavigationSection.tsx uses for
 * bottom_nav_order) — a failed save just means the next visit falls
 * back to the last order that did save.
 */
export function HomeCardDeck({ cards }: { cards: Record<string, ReactNode> }) {
  const present = Object.keys(cards).filter((k) => cards[k] != null);
  const [order, setOrder] = useState<string[]>(() => parseOrder(null, present));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    getPreferences()
      .then((p) => setOrder(parseOrder(p.home_card_order, present)))
      .catch(() => {
        // Keep the default order already in state — reordering is a
        // nice-to-have, not worth an error banner if the fetch fails.
      });
    // Only ever needs to run once on mount — `present` reflects this
    // page load's own server-fetched data and won't change underneath
    // this client component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.indexOf(String(active.id));
      const to = prev.indexOf(String(over.id));
      if (from === -1 || to === -1) return prev;
      const next = arrayMove(prev, from, to);
      updateHomeCardOrder(next).catch(() => {});
      return next;
    });
  }

  if (present.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
        >
          {editing ? "Done" : "Rearrange"}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-6">
            {order.map((key) => (
              <DraggableCard key={key} id={key} editing={editing}>
                {cards[key]}
              </DraggableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function DraggableCard({ id, editing, children }: { id: string; editing: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {children}
      {/* Only in edit mode, so normal browsing has zero extra chrome —
          anchored to this card's own top-right corner, poking slightly
          outside it, so it never collides with the card's own content
          underneath. */}
      {editing && (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="absolute -top-2 -right-2 z-20 flex h-7 w-7 cursor-grab items-center justify-center rounded-full border border-black/10 bg-[var(--background)] text-black/60 shadow-sm active:cursor-grabbing dark:border-white/10 dark:text-white/60"
          {...attributes}
          {...listeners}
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
      )}
    </div>
  );
}
