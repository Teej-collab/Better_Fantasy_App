"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
import { updateHomeCardOrder, updateHomeHiddenCards } from "@/lib/api";

/**
 * Lets a signed-in owner drag-and-drop reorder the home dashboard's
 * cards — "every owner can make their page their own." `cards` is
 * built server-side by (home)/page.tsx: one entry per card key that
 * both has something to show this week AND isn't in the owner's
 * `hiddenCards` list (see that file's own comment on why hiding is
 * checked at each card's own assignment instead of skipping the
 * underlying data fetch — several of those fetches are shared with the
 * always-visible ticker above this deck). `initialOrder` is already
 * the owner's saved order merged with the default order.
 *
 * "Edit Home" mode reveals a remove ("×") button per card and an
 * "+ Add Box" tile that opens a picker of currently-hidden card types.
 * Outside edit mode the deck renders exactly as it always has — no
 * extra chrome cluttering the normal browsing view.
 *
 * Reordering is optimistic (local state updates instantly, the save
 * happens in the background with a swallowed `.catch()` — the same
 * convention used everywhere else preferences are saved in this app).
 * Removing a card is also instant/local. Adding one back needs a real
 * `router.refresh()` — the card's actual content was never built
 * server-side while hidden, so there's nothing to reveal locally.
 * `(home)/page.tsx` keys this component on the current set of visible
 * card keys specifically so that refresh forces a real remount (fresh
 * `useState` initializers picking up the newly-un-hidden card) instead
 * of trying to reconcile stale local state against new props from an
 * effect, which the "don't setState synchronously inside an effect"
 * lint rule (rightly) steers away from here.
 */
export function HomeCardDeck({
  initialOrder,
  cards,
  hiddenCards,
  cardLabels,
}: {
  initialOrder: string[];
  cards: Record<string, ReactNode>;
  hiddenCards: string[];
  cardLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(() => initialOrder.filter((key) => cards[key] != null));
  const [localHidden, setLocalHidden] = useState<string[]>(hiddenCards);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const visibleOrder = useMemo(() => order.filter((key) => !localHidden.includes(key)), [order, localHidden]);

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

  function removeCard(key: string) {
    const next = [...localHidden, key];
    setLocalHidden(next);
    updateHomeHiddenCards(next).catch(() => {
      // Same swallowed-background-save convention as reordering.
    });
  }

  function addCard(key: string) {
    const next = localHidden.filter((k) => k !== key);
    setLocalHidden(next);
    setShowPicker(false);
    updateHomeHiddenCards(next)
      .then(() => router.refresh())
      .catch(() => {
        // Revert the optimistic local change if the save itself failed
        // — otherwise the UI would claim a box is back while the saved
        // preference still says it's hidden.
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-6">
            {visibleOrder.map((key) => (
              <DraggableCard key={key} id={key} editing={editing} onRemove={() => removeCard(key)}>
                {cards[key]}
              </DraggableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

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

function DraggableCard({
  id,
  editing,
  onRemove,
  children,
}: {
  id: string;
  editing: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
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
      {editing && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this box"
          className="absolute -top-1 right-7 flex h-6 w-6 -translate-y-full items-center justify-center rounded-md text-red-500/70 hover:text-red-500"
        >
          ✕
        </button>
      )}
      {children}
    </div>
  );
}
