import { SurvivorPoolRoom } from "@/components/survivor/SurvivorPoolRoom";

// One survivor pool's room (2026-11-07): ?entry= picks which of your
// entries the pick board is for.
export default async function SurvivorPoolPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string; created?: string }> }) {
  const { id } = await params;
  const { entry, created } = await searchParams;
  return <SurvivorPoolRoom poolId={Number(id)} entryId={entry ? Number(entry) : null} justCreated={Boolean(created)} />;
}
