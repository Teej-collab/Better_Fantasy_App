import { Anton } from "next/font/google";

const anton = Anton({ weight: "400", subsets: ["latin"] });

// The authenticated half of the app-entry sequence — shown after the
// WEEKEND / League wordmark settles, in place of the signed-out flow's
// "Enter Here" sign (see OpeningExperience.tsx). Same display face
// (Anton) and neon-green accent glow as WEEKEND itself (.wl-weekend in
// globals.css) so this reads as the logo continuing to speak, not a
// separate UI element — the whole point per the brief ("it should feel
// like the logo itself is speaking to the user").
export function WelcomeBackStage({ displayName }: { displayName: string | null }) {
  return (
    <p className={`wl-welcome-back text-2xl sm:text-4xl ${anton.className}`}>
      Welcome Back{displayName ? `, ${displayName}` : ""}
    </p>
  );
}
