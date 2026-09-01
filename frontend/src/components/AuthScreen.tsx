"use client";

import { SignInCard } from "@/components/SignInCard";

// The post-intro step of the signed-out front door (app/(app)/login/
// page.tsx is the other entry point — Discord's own OAuth failure
// redirect — both render the exact same SignInCard so they can never
// visually drift apart). Discord stays the primary path (it verifies
// real league membership for free — owners.discord_user_id — a
// property email/password never gives); email/password is a second,
// independent way to get a real Weekend account, for anyone opening a
// league beyond Discord.
export function AuthScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="wl-gate flex items-center justify-center px-6">
      <div className="wl-ambient wl-ambient--lit" aria-hidden />
      <SignInCard onBack={onBack} />
    </div>
  );
}
