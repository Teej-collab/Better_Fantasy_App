import { getLoungeRoomMeta } from "@/lib/api";
import { LoungeJoinRoom } from "@/components/lounge/LoungeJoinRoom";

export default async function LoungeSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await getLoungeRoomMeta(slug);

  if (!room) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 px-6 py-24 text-center">
        <h1 className="font-display text-xl font-bold">Lounge not found</h1>
        <p className="text-sm text-white/60">This link may be wrong, or the lounge no longer exists.</p>
      </div>
    );
  }

  if (room.closed) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 px-6 py-24 text-center">
        <h1 className="font-display text-xl font-bold">{room.name}</h1>
        <p className="text-sm text-white/60">This lounge has been closed by its host.</p>
      </div>
    );
  }

  return <LoungeJoinRoom slug={slug} roomName={room.name} />;
}
