"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInCard } from "@/components/SignInCard";
import { redeemCoOwnerInvite } from "@/lib/leaguesApi";

// Handles both halves of the co-owner invite link: a visitor who's
// already signed in (their own account, or one they just created)
// just confirms and redeems; a brand-new friend sees the normal sign-
// in/sign-up card first (SignInCard's onSuccess override skips its
// default dashboard redirect so we can redeem right after auth
// instead). Either path lands on /team once redeemed.
export function JoinCoOwnerForm({ code }: { code: string | undefined }) {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/auth/me")
      .then((res) => setSignedIn(res.ok))
      .catch(() => setSignedIn(false))
      .finally(() => setCheckingAuth(false));
  }, []);

  async function redeem() {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await redeemCoOwnerInvite(code);
      setDone(true);
      setTimeout(() => router.push("/team"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join as co-owner");
    } finally {
      setBusy(false);
    }
  }

  if (!code) {
    return (
      <div
        className="wl-auth-enter relative z-10 flex w-full max-w-sm flex-col gap-3 rounded-2xl p-8 text-center"
        style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
      >
        <h1 className="font-display text-xl font-semibold tracking-wide text-[color:var(--wl-text)] uppercase">
          Invite link incomplete
        </h1>
        <p className="text-sm text-[color:var(--wl-text-secondary)]">
          This link is missing its invite code — ask whoever sent it to send it again.
        </p>
      </div>
    );
  }

  if (checkingAuth) {
    return null;
  }

  if (!signedIn) {
    return <SignInCard variant="signin" onSuccess={redeem} />;
  }

  return (
    <div
      className="wl-auth-enter relative z-10 flex w-full max-w-sm flex-col gap-6 rounded-2xl p-8 text-center"
      style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
    >
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold tracking-[0.25em] text-[color:var(--wl-text-secondary)] uppercase">
          Weekend League
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-[color:var(--wl-text)] uppercase">
          Join as Co-Owner
        </h1>
      </div>

      {done ? (
        <p className="text-sm text-[color:var(--wl-text-secondary)]">
          You&apos;re in — taking you to the team…
        </p>
      ) : (
        <>
          <p className="text-sm text-[color:var(--wl-text-secondary)]">
            You&apos;ll be able to manage this team&apos;s roster and lineup alongside its owner.
          </p>
          {error && <p className="text-center text-xs text-red-400">{error}</p>}
          <button
            onClick={redeem}
            disabled={busy}
            className="rounded-full px-6 py-3.5 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
          >
            {busy ? "Joining…" : "Join as Co-Owner"}
          </button>
        </>
      )}
    </div>
  );
}
