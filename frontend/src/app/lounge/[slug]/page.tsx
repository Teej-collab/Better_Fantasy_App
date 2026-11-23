import type { Metadata } from "next";
import { getLoungeRoomMeta } from "@/lib/api";
import { LoungeJoinRoom } from "@/components/lounge/LoungeJoinRoom";

// The room's own preview card when its link is texted (2026-11-23).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const room = await getLoungeRoomMeta(slug);
  const title = room ? `Come watch in ${room.name}` : "The Lounge on The Weekend";
  const description = "Live games and the league, together in one room.";
  const image = { url: `/api/og/lounge?slug=${encodeURIComponent(slug)}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { title, description, images: [image], type: "website", siteName: "The Weekend" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

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
