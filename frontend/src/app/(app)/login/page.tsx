import type { Metadata } from "next";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Sign In — Weekend League" };

// Direct-linked entry point — Discord's own OAuth redirects here on
// ?error=not_a_league_member (app/routers/auth.py) when someone
// completes Discord's consent screen but isn't actually a recognized
// league member. Renders the exact same SignInCard AuthScreen.tsx
// uses (post-intro step of the normal signed-out front door) so
// landing here directly doesn't feel like a bare fallback — the error
// banner is the only thing this page adds on top.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="wl-gate flex items-center justify-center px-6">
      <div className="wl-ambient wl-ambient--lit" aria-hidden />
      <div className="relative z-10 flex w-full max-w-sm flex-col gap-4">
        {error === "not_a_league_member" && (
          <div
            className="rounded-xl px-4 py-3 text-center text-sm text-[color:var(--wl-text)]"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)" }}
          >
            That Discord account isn&apos;t linked to a team in this league. If you think that&apos;s wrong,
            check with your commissioner — or sign in with email instead below.
          </div>
        )}
        <SignInCard />
      </div>
    </div>
  );
}
