"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { updateHomeCardOrder } from "@/lib/api";

/**
 * Lets a signed-in owner drag-and-drop reorder the home dashboard's
 * cards — "every owner can make their page their own." `cards` is
 * built server-side by (home)/page.tsx: one entry per card key that
 * actually has something to show this week (a card whose data
 * condition is false — e.g. no other matchups — is simply absent from
 * this map, never rendered here regardless of where it falls in
 * `initialOrder`). `initialOrder` is already the owner's saved order
 * merged with the default order (see (home)/page.tsx for that merge),
 * so this component only ever deals with keys that are actually
 * present in `cards`.
 *
 * Reordering is optimistic: local state updates the instant a drag
 * ends, the save to the backend happens in the background and never
 * blocks or visibly fails the interaction — losing a reorder attempt
 * to a flaky network call isn't worth interrupting the user over, and
 * the next real page load just falls back to whatever was last saved
 * successfully.
 */
export function HomeCardDeck({
  initialOrder,
  cards,
}: {
  initialOrder: string[];
  cards: Record<string, ReactNode>;
}) {
  const [order, setOrder] = useState(() => initialOrder.filter((key) => cards[key] != null));

  // PointerSensor covers mouse + modern touch; TouchSensor's own small
  // activation delay is what keeps a normal tap-to-scroll or tap-to-
  // navigate on mobile from being swallowed as an accidental drag —
  // the drag handle itself (not the card body) is the only thing
  // these sensors are ever attached to, so this is belt-and-suspenders
  // more than strictly required.
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
      updateHomeCardOrder(next).catch(() => {
        // Background save — nothing for the user to react to here;
        // their next visit just falls back to the last order that did
        // save successfully.
      });
      return next;
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-6">
          {order.map((key) => (
            <DraggableCard key={key} id={key}>
              {cards[key]}
            </DraggableCard>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      {/* A dedicated handle, not the whole card — dragging the card
          body itself would fight with real clicks/links inside it
          (a team name, "View full matchup →", etc.). Positioned to sit
          just above each card without shifting its own layout. */}
      <button
        type="button"
        aria-label="Drag to reorder"
        className="absolute -top-1 right-0 flex h-6 w-6 -translate-y-full cursor-grab items-center justify-center rounded-md text-black/40 opacity-100 transition-opacity active:cursor-grabbing dark:text-white/40 sm:text-black/25 sm:opacity-0 sm:group-hover:opacity-100 sm:hover:text-black/50 dark:sm:text-white/25 dark:sm:hover:text-white/50"
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
      {children}
    </div>
  );
}
