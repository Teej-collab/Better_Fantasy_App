/**
 * /lounge/[slug] deliberately lives outside (app)/ — a Lounge join
 * link is meant to work for a fully logged-out guest with no account
 * at all, cold, straight from a text message. (app)/layout.tsx's
 * AppEntry wraps every route in a multi-second boot/splash animation
 * regardless of auth state, and its NavBar/ticker assume a real signed-
 * in app session — neither makes sense for this page. Same pattern as
 * app/weekend/layout.tsx, which opts out of that chrome the same way
 * for the same reason (a route group is what actually guarantees the
 * server never renders — or fetches the data behind — that chrome for
 * this route at all).
 */
export default function LoungeSlugLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex-1 bg-black text-white">{children}</main>;
}
