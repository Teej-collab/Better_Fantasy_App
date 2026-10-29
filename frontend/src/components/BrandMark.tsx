import Image from "next/image";
import Link from "next/link";
import { seasonalEmblem } from "@/lib/seasonal";

// The header brand mark: the Hive Mark emblem (public/images/
// the-weekend-emblem.png, seasonal copies via lib/seasonal.ts), seven
// neon honeycomb cells, one lit orange, with "The" in orange script over
// a green "WEEKEND". Transparent around the cells, so it sits right on
// the header. LeagueWordmark.tsx's plain styled text (the sign-in gate)
// is separate.
export function BrandMark({ href }: { href: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2 text-[color:var(--foreground)]">
      <Image
        src={seasonalEmblem()}
        alt="The Weekend"
        width={40}
        height={40}
        priority
        className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
      />
      {/* The emblem alone reads fine on its own at narrow widths — the
          full wordmark returns once there's room, same breakpoint the
          old bare-text brand mark used. */}
      <span className="font-display hidden text-base font-semibold tracking-wide uppercase sm:inline">
        The Weekend
      </span>
    </Link>
  );
}
