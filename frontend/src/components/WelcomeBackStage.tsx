import Link from "next/link";
import { Anton } from "next/font/google";

const anton = Anton({ weight: "400", subsets: ["latin"] });

// The authenticated half of the app-entry sequence — shown after the
// WEEKEND / League wordmark settles, in place of the signed-out flow's
// "Enter Here" sign (see OpeningExperience.tsx). Same display face
// (Anton) and neon-green accent glow as WEEKEND itself (.wl-weekend in
// globals.css) so this reads as the logo continuing to speak, not a
// separate UI element — the whole point per the brief ("it should feel
// like the logo itself is speaking to the user").
//
// `needsLeague` covers a real signed-in account with no active league
// (email/Google signup creates a bare user row with nothing to join
// until they act — see backend/app/routers/me.py's 404 "No team found
// for this owner"). That used to only surface one screen later, as the
// dashboard's EmptyHero "Join or create a league" banner
// ((home)/page.tsx) — pulling the same two real actions (still the
// same /leagues destination, same forms) forward onto the logo screen
// itself removes a redundant hop for exactly the visitor self-serve
// signup exists to open the door to. `onSkip` — wired only when
// needsLeague is true, see HomeWelcomeBackEntry.tsx — lets a visitor
// who wants to look around first bypass this without getting stuck,
// same escape hatch OpeningExperience's own "Skip intro" gives.
export function WelcomeBackStage({
  displayName,
  needsLeague = false,
  onSkip,
}: {
  displayName: string | null;
  needsLeague?: boolean;
  onSkip?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className={`wl-welcome-back text-2xl sm:text-4xl ${anton.className}`}>
        Welcome Back{displayName ? `, ${displayName}` : ""}
      </p>
      {needsLeague && (
        <div className="wl-auth-enter flex flex-col items-center gap-3">
          <p className="wl-tagline max-w-[18rem] text-sm sm:max-w-sm">
            You&apos;re not on a team yet — join a league you&apos;re already in, or start one of your own.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/leagues#join-league" className="wl-enter-sign px-6 py-2.5 text-xs sm:text-sm">
              Join a League
            </Link>
            <Link href="/leagues#create-league" className="wl-enter-sign px-6 py-2.5 text-xs sm:text-sm">
              Create a League
            </Link>
          </div>
          {onSkip && (
            <button onClick={onSkip} className="wl-skip-intro text-xs">
              Skip for now →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
