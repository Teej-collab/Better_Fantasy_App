import { redirect } from "next/navigation";

// The Bracket lives in Standings → Playoffs now (2026-10). Older shared
// what-if links (/bracket?mode=whatif&w=…) land there with the world
// intact.
export default async function BracketRedirect({ searchParams }: { searchParams: Promise<{ mode?: string; w?: string }> }) {
  const { mode, w } = await searchParams;
  const params = new URLSearchParams({ view: "playoffs" });
  if (mode) params.set("mode", mode);
  if (w) params.set("w", w);
  redirect(`/standings?${params.toString()}`);
}
