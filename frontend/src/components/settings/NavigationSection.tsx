"use client";

import { useEffect, useState, type CSSProperties } from "react";
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
import { getPreferences, updateBottomNavOrder, type OwnerPreferences } from "@/lib/api";
import { DESTINATIONS, MOBILE_NAV_ORDER, type DestinationKey } from "@/lib/navDestinations";

function parseOrder(raw: string | null | undefined): DestinationKey[] {
  if (!raw) return MOBILE_NAV_ORDER;
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === MOBILE_NAV_ORDER.length &&
      new Set(parsed).size === MOBILE_NAV_ORDER.length &&
      parsed.every((k) => (MOBILE_NAV_ORDER as string[]).includes(k))
    ) {
      return parsed as DestinationKey[];
    }
  } catch {
    // fall through to the default below
  }
  return MOBILE_NAV_ORDER;
}

/**
 * Reorders the app's fixed nav tabs — drives both the mobile bottom
 * bar (BottomNav.tsx) and the desktop header (PrimaryNav.tsx) from the
 * one saved order, since both show the exact same six destinations.
 * Same drag-and-drop pattern as HomeCardDeck.tsx (a shared drag
 * handle, optimistic save with a swallowed-catch background PUT), but
 * a fixed set with no add/remove: every surface always shows exactly
 * the destinations in MOBILE_NAV_ORDER, only their order is an owner's
 * own choice.
 */
export function NavigationSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [order, setOrder] = useState<DestinationKey[]>(MOBILE_NAV_ORDER);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPreferences()
      .then((p) => {
        setPrefs(p);
        setOrder(parseOrder(p.bottom_nav_order));
      })
      .catch(() => setError("Couldn't load your navigation settings."));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.indexOf(active.id as DestinationKey);
      const to = prev.indexOf(over.id as DestinationKey);
      if (from === -1 || to === -1) return prev;
      const next = arrayMove(prev, from, to);
      updateBottomNavOrder(next).catch(() => {
        setError("Couldn't save that change — try again.");
      });
      return next;
    });
  }

  if (!prefs) {
    return error ? <p className="text-sm text-red-500">{error}</p> : null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Navigation</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          Drag to reorder your nav — applies to both the mobile bottom bar and desktop&apos;s top nav.
        </p>
      </div>

      <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-3 dark:bg-white/[0.03]">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map((key) => (
              <DraggableTab key={key} destKey={key} />
            ))}
          </SortableContext>
        </DndContext>
      </section>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

function DraggableTab({ destKey }: { destKey: DestinationKey }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: destKey });
  const dest = DESTINATIONS[destKey];

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${dest.label}`}
        className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-black/40 active:cursor-grabbing dark:text-white/40"
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
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: dest.color, boxShadow: `0 0 6px ${dest.color}` }}
        aria-hidden
      />
      <span className="font-medium">{dest.label}</span>
    </div>
  );
}
