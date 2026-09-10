/**
 * Public marketing pages (/welcome, /commissioners) — outside both
 * app/(app)/ and app/(home)/ so they render with zero shared chrome
 * (no NavBar, no ticker) and fetch none of the data behind it, same
 * reasoning as app/weekend/layout.tsx's own route group. Unlike
 * /weekend (an in-app "vacancy sign" nav hub for people already using
 * the product), these pages are the actual public face for a stranger
 * who's never seen the app before — see Documentation/Marketing/.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex-1">{children}</main>;
}
