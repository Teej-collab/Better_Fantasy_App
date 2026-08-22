"use client";

import { useRouter } from "next/navigation";
import type { MySettings } from "@/lib/api";
import { clearSession } from "@/lib/logout";

export function AccountSection({ initial }: { initial: MySettings }) {
  const router = useRouter();

  async function handleLogout() {
    await clearSession();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Account & Security</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          How you sign in, and how to leave.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Connected Accounts</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Signed in with Discord{initial.discord_username ? ` as @${initial.discord_username}` : ""}. Only you can
            see or change these settings.
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
            Account deletion isn&apos;t available yet — this league&apos;s history (rosters, chug records, chat) is
            shared with other owners, and safely separating out just your data needs real design work before it
            ships.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Not available yet"
          className="flex w-fit items-center gap-2 rounded-full border border-red-500/30 px-4 py-2 text-sm font-medium text-red-500/50 disabled:cursor-not-allowed"
        >
          Delete Account
          <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase">
            Soon
          </span>
        </button>
      </section>
    </div>
  );
}
