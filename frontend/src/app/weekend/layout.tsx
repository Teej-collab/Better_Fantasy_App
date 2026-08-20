/**
 * /weekend deliberately lives outside both app/(app)/ and app/(home)/
 * — it needs to bleed edge-to-edge for its room background with no
 * nav bar and no ticker at all, and a route group is what actually
 * guarantees that (the server never renders that chrome — or fetches
 * the data behind it — for this route in the first place), unlike the
 * client-side pathname checks this used to rely on.
 */
export default function WeekendLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex-1">{children}</main>;
}
