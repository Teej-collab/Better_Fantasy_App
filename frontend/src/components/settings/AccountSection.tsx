"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAccount, type MySettings } from "@/lib/api";
import { clearSession } from "@/lib/logout";

export function AccountSection({ initial }: { initial: MySettings }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    await clearSession();
    router.push("/");
    router.refresh();
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      await clearSession();
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong deleting your account.");
      setDeleting(false);
      setConfirming(false);
    }
  }

  // Every real, currently-linked sign-in method — not a single assumed
  // one. Used to unconditionally say "Signed in with Discord" no
  // matter the account's actual auth method; false for anyone who
  // signed up with email or Google (2026-08-31 audit).
  const connections: string[] = [];
  if (initial.has_discord) connections.push(initial.discord_username ? `Discord (@${initial.discord_username})` : "Discord");
  if (initial.has_google) connections.push("Google");
  if (initial.has_password) connections.push(initial.email ? `Email (${initial.email})` : "Email");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Account & Security</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          How you sign in, and how to leave.
        </p>
      </div>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Connected Accounts</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            {connections.length > 0
              ? `Signed in with ${connections.join(" and ")}.`
              : "Signed in."}{" "}
            Only you can see or change these settings.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-fit rounded-full border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          Log Out
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.03] p-5">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-red-500 uppercase">Danger Zone</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Deletes your login for good — the email/Discord/Google connections above, your password, your own
            feedback. This league&apos;s shared history (rosters, chug records, chat, rivalries, awards) belongs to
            everyone in it and stays exactly as it is, just no longer linked to a login you can sign into.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-fit rounded-full border border-red-500/30 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10"
          >
            Delete Account
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Are you sure? This can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="w-fit rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete my account"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="w-fit rounded-full border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
