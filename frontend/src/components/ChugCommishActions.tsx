"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { recordChugPayment, waiveChugDoubling } from "@/lib/api";

/**
 * Commissioner-only corrections for one owner's running chug balance —
 * only rendered for a signed-in commissioner (the chug page gates it),
 * and the backend enforces the same check on every endpoint.
 * - "Mark 1 paid": a chug done in person with no video (POST
 *   /chug/standing/{id}/record-payment).
 * - "Waive week N doubling": a chug that really was done before MNF
 *   kickoff but didn't get credited in time (POST
 *   /chug/standing/{id}/waive-doubling).
 */
export function ChugCommishActions({
  ownerId,
  ownerName,
  outstandingOwed,
  doubledWeeks,
}: {
  ownerId: number;
  ownerName: string;
  outstandingOwed: number;
  doubledWeeks: { week: number; owed_before: number; owed_after: number }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(message: string, action: () => Promise<unknown>) {
    if (!confirm(message)) return;
    setPending(true);
    try {
      await action();
      router.refresh();
    } catch {
      alert("That didn't go through — try again.");
    } finally {
      setPending(false);
    }
  }

  const buttonClass =
    "rounded-full border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400";

  return (
    <>
      {outstandingOwed > 0 && (
        <button
          disabled={pending}
          className={buttonClass}
          onClick={() =>
            run(`Mark 1 of ${ownerName}'s ${outstandingOwed} owed chugs as done?`, () => recordChugPayment(ownerId, 1))
          }
        >
          Mark 1 paid
        </button>
      )}
      {doubledWeeks.map((d) => (
        <button
          key={d.week}
          disabled={pending}
          className={buttonClass}
          onClick={() =>
            run(
              `Waive ${ownerName}'s week ${d.week} doubling? Their balance drops by ${d.owed_after - d.owed_before} (week ${d.week} went ${d.owed_before} → ${d.owed_after}).`,
              () => waiveChugDoubling(ownerId, d.week),
            )
          }
        >
          Waive wk {d.week} doubling
        </button>
      ))}
    </>
  );
}
