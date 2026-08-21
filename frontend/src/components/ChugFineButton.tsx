"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearChugFine } from "@/lib/api";

/**
 * Commissioner-only — marks a real-life fine payment, clearing it off
 * the owed total. Only ever shown to a signed-in commissioner (gated by
 * the server component that renders this), and the backend enforces the
 * same check independently (see POST /chug/standing/{id}/clear-fine) —
 * this button isn't the only thing standing between a random visitor
 * and clearing someone's fine.
 */
export function ChugFineButton({ ownerId, fineAmount }: { ownerId: number; fineAmount: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!confirm(`Mark the full $${fineAmount} fine as paid and clear it?`)) return;
    setPending(true);
    try {
      await clearChugFine(ownerId);
      router.refresh();
    } catch {
      alert("Failed to clear the fine — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="rounded-full border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
    >
      {pending ? "Clearing…" : "Mark fine paid"}
    </button>
  );
}
