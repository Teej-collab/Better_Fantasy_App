import { LinkCardView } from "@/components/share/LinkCard";
import { linkCardImage } from "@/lib/linkCardImage";

// A co-owner invite's link preview (2026-11-23), in the share cards' style.
// The link carries only a code, so the card says what it is, not whose team.
export async function GET() {
  return linkCardImage(
    <LinkCardView
      parts={{
        eyebrow: "You're invited",
        title: "Help run my team",
        detail: "Co-own a fantasy team on The Weekend: set the lineup, make the trades and talk trash in the league chat.",
        heroLabel: "Your seat",
        hero: "Co-owner",
      }}
    />,
    3600,
  );
}
