/**
 * Generic placeholder every signed-in route shows the instant a tab is
 * tapped, via app/(app)/loading.tsx and app/(home)/loading.tsx. Before
 * those existed, a nav click did nothing visible until the new page's
 * whole server-side fetch chain finished (often 1s+), which read as the
 * app ignoring the tap. A loading.tsx boundary is also what lets
 * <Link>'s automatic prefetch do real work for dynamic pages — Next
 * only prefetches a dynamic route down to its nearest loading boundary,
 * so with none anywhere, prefetch had nothing to fetch ahead of time.
 *
 * Deliberately shape-agnostic (a title bar and a few panels) rather than
 * per-page skeletons: its job is immediate feedback, not a pixel-exact
 * preview, and one shared shape can't drift out of sync with a page.
 * Plain surface/border tokens instead of .neon-panel so a dozen
 * placeholders don't each start their own animated glow ring.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="wl-skeleton flex flex-col gap-4 motion-safe:animate-pulse">
      <div className="h-8 w-48 rounded-md bg-[var(--wl-border)]" />
      <div className="h-4 w-72 max-w-full rounded bg-[var(--wl-border)] opacity-70" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-[var(--wl-border)] bg-[var(--wl-surface)] p-4"
        >
          <div className="h-5 w-40 rounded bg-[var(--wl-border)]" />
          <div className="h-4 w-full rounded bg-[var(--wl-border)] opacity-70" />
          <div className="h-4 w-5/6 rounded bg-[var(--wl-border)] opacity-70" />
          <div className="h-4 w-2/3 rounded bg-[var(--wl-border)] opacity-70" />
        </div>
      ))}
    </div>
  );
}
