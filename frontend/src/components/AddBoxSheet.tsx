"use client";

/**
 * The "+ Add Box" picker for both HomeCardDeck.tsx (mobile) and
 * HomeGridDesktop.tsx (desktop). Previously an absolutely-positioned
 * dropdown anchored below the "+ Add Box" button — since that button
 * sits at the very end of the dashboard, the dropdown rendered mostly
 * or entirely underneath the mobile bottom nav bar (BottomNav.tsx is
 * `fixed` with `z-30`, the dropdown was only `z-10`), so its options
 * were both visually covered and untappable — the nav bar wins hit
 * testing at a higher z-index regardless of paint order.
 *
 * A fixed, viewport-anchored sheet (z-50, above every other fixed
 * chrome in the app) instead of a document-flow dropdown sidesteps
 * that entirely — it can never end up positioned behind or below
 * anything else on the page. Bottom-sheet on narrow/mobile widths,
 * centered dialog from `sm:` up.
 */
export function AddBoxSheet({
  options,
  labels,
  onPick,
  onClose,
}: {
  options: string[];
  labels: Record<string, string>;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className="mb-[env(safe-area-inset-bottom)] w-full max-w-sm rounded-t-2xl border border-black/10 bg-white shadow-lg sm:mb-0 sm:rounded-2xl dark:border-white/10 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">Add a box</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        <div className="flex max-h-[60vh] flex-col overflow-y-auto p-2">
          {options.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className="rounded-lg px-3 py-2.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              {labels[key] ?? key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
