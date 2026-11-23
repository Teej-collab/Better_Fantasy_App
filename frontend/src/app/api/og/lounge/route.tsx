import { LinkCardView } from "@/components/share/LinkCard";
import { getLoungeRoomMeta } from "@/lib/api";
import { linkCardImage } from "@/lib/linkCardImage";

// A private Lounge room's link preview (2026-11-23): the room's name in
// the share cards' style, where it unfurled as the site's generic picture.
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const room = slug ? await getLoungeRoomMeta(slug) : null;
  return linkCardImage(
    <LinkCardView
      parts={{
        eyebrow: "The Lounge · watch together",
        title: room?.name ?? "A Lounge room",
        detail: room?.closed ? "This room has closed." : "Live games, the scores that matter to you and everyone's reactions, together in one room. Tap to come in.",
        heroLabel: room?.closed ? null : "Open now",
        hero: room?.closed ? null : "Come in",
        live: !room?.closed,
      }}
    />,
    60,
  );
}
