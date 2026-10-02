"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { correctChugBalance, recordChugPayment, waiveChugDoubling } from "@/lib/api";

/**
 * Commissioner/admin tools for one owner's running chug balance — only
 * rendered for a commissioner or site admin (the chug page gates it),
 * and the backend enforces the same check on every endpoint. Each one is
 * recorded as what it was in that owner's "Why?" history:
 * - "Paid": a chug settled outside the app — $10, or done in person
 *   with no video (POST /chug/standing/{id}/record-payment).
 * - "Correction": a straight fix, chugs added or removed, with a note
 *   (POST /chug/standing/{id}/correction).
 * - "Remove wk N doubling": a chug that really was done before MNF
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
  const [correcting, setCorrecting] = useState(false);
  const [amount, setAmount] = useState(1);
  const [note, setNote] = useState("");

  async function run(message: string | null, action: () => Promise<unknown>) {
    if (message && !confirm(message)) return;
    setPending(true);
    try {
      await action();
      router.refresh();
      return true;
    } catch {
      alert("That didn't go through — try again.");
      return false;
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
            run(`Mark 1 of ${ownerName}'s ${outstandingOwed} owed chugs as paid?`, () => recordChugPayment(ownerId, 1))
          }
        >
          Paid
        </button>
      )}
      <button disabled={pending} className={buttonClass} onClick={() => setCorrecting((c) => !c)} aria-expanded={correcting}>
        Correction
      </button>
      {doubledWeeks.map((d) => (
        <button
          key={d.week}
          disabled={pending}
          className={buttonClass}
          onClick={() =>
            run(
              `Remove ${ownerName}'s week ${d.week} doubling? Their balance drops by ${d.owed_after - d.owed_before} (week ${d.week} went ${d.owed_before} → ${d.owed_after}).`,
              () => waiveChugDoubling(ownerId, d.week),
            )
          }
        >
          Remove wk {d.week} doubling
        </button>
      ))}
      {correcting && (
        <form
          className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (amount === 0) return;
            const ok = await run(null, () => correctChugBalance(ownerId, amount, note.trim() || null));
            if (ok) {
              setCorrecting(false);
              setAmount(1);
              setNote("");
            }
          }}
        >
          <span className="text-black/60 dark:text-white/60">Chugs</span>
          <button type="button" className={buttonClass} onClick={() => setAmount((a) => Math.max(-50, a - 1))} aria-label="One fewer">
            −
          </button>
          <span className="w-8 text-center font-mono font-semibold tabular-nums">{amount > 0 ? `+${amount}` : amount}</span>
          <button type="button" className={buttonClass} onClick={() => setAmount((a) => Math.min(50, a + 1))} aria-label="One more">
            +
          </button>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Why? (shows in their history)"
            className="min-w-0 flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
          />
          <button type="submit" disabled={pending || amount === 0} className={buttonClass}>
            Save
          </button>
        </form>
      )}
    </>
  );
}
