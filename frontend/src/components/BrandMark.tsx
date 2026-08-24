import Image from "next/image";
import Link from "next/link";

// The header brand mark — the real emblem now (public/images/
// weekend-league-emblem.png): neon-green "WEEKEND" arced over a blue
// cursive "League", ringed in a green-to-blue halo on a starfield,
// pre-cropped to a transparent circle so it sits directly on the
// Cosmic header instead of carrying its own square backing. Replaces
// the earlier plain-text "W" monogram badge (see git history) — this
// repo previously had no logo image asset at all and was CSS/text-
// based everywhere the brand appeared; that's no longer the case for
// this mark specifically, though LeagueWordmark.tsx's plain styled
// text (used elsewhere, e.g. the sign-in gate) is untouched.
export function BrandMark({ href }: { href: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2 text-[color:var(--foreground)]">
      <Image
        src="/images/weekend-league-emblem.png"
        alt="Weekend League"
        width={40}
        height={40}
        priority
        className="h-8 w-8 shrink-0 rounded-full sm:h-9 sm:w-9"
      />
      {/* The emblem alone reads fine on its own at narrow widths — the
          full wordmark returns once there's room, same breakpoint the
          old bare-text brand mark used. */}
      <span className="hidden text-base font-semibold tracking-tight sm:inline">Weekend League</span>
    </Link>
  );
}
