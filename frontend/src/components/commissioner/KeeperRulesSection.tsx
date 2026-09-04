"use client";

import { useEffect, useState } from "react";
import { getKeeperRules, lockKeeperRules, setKeeperRules, unlockKeeperRules, type KeeperRules } from "@/lib/api";

// Same hand-built local-time conversion DraftSetupPanel.tsx's own
// ScheduleEditor uses for its <input type="datetime-local"> — needs to
// round-trip exactly back into the same input, not be human-readable,
// so toISOString() (always UTC) would be wrong here.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Panel = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/**
 * The commissioner-facing counterpart to KeepersPanel.tsx's owner-
 * facing picker — backend was already fully built (PUT /keepers/rules,
 * lock/unlock), this is just the missing UI (2026-09-03).
 */
export function KeeperRulesSection() {
  const [rules, setRules] = useState<KeeperRules | null>(null);
  const [maxKeepers, setMaxKeepers] = useState(0);
  const [maxConsecutiveYears, setMaxConsecutiveYears] = useState<string>("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [panel, setPanel] = useState<Panel>({ status: "idle" });
  const [lockBusy, setLockBusy] = useState(false);

  function applyRules(r: KeeperRules) {
    setRules(r);
    setMaxKeepers(r.max_keepers);
    setMaxConsecutiveYears(r.max_consecutive_years === null ? "" : String(r.max_consecutive_years));
    setDeadlineInput(r.keeper_deadline ? toDatetimeLocalValue(r.keeper_deadline) : "");
  }

  useEffect(() => {
    const id = setTimeout(() => {
      getKeeperRules()
        .then(applyRules)
        .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load keeper rules." }));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function save() {
    if (!rules) return;
    setPanel({ status: "saving" });
    try {
      const updated = await setKeeperRules({
        season: rules.season,
        max_keepers: maxKeepers,
        max_consecutive_years: maxConsecutiveYears === "" ? null : Number(maxConsecutiveYears),
        keeper_deadline: deadlineInput ? new Date(deadlineInput).toISOString() : null,
      });
      applyRules(updated);
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't save keeper rules." });
    }
  }

  async function toggleLock() {
    if (!rules) return;
    setLockBusy(true);
    try {
      const updated = rules.locked_at ? await unlockKeeperRules(rules.season) : await lockKeeperRules(rules.season);
      applyRules(updated);
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't change the lock." });
    } finally {
      setLockBusy(false);
    }
  }

  if (rules === null) {
    return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Keeper Rules</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          How many keepers each owner can carry into {rules.season}, and until when.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-2 text-sm sm:w-80">
          <span className="text-black/70 dark:text-white/70">Max keepers</span>
          <input
            type="number"
            min={0}
            value={maxKeepers}
            onChange={(e) => setMaxKeepers(Number(e.target.value))}
            className="w-20 shrink-0 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-right tabular-nums dark:border-white/10"
          />
        </label>

        <label className="flex items-center justify-between gap-2 text-sm sm:w-80">
          <span className="text-black/70 dark:text-white/70">Max consecutive years (blank = no cap)</span>
          <input
            type="number"
            min={1}
            value={maxConsecutiveYears}
            onChange={(e) => setMaxConsecutiveYears(e.target.value)}
            className="w-20 shrink-0 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-right tabular-nums dark:border-white/10"
          />
        </label>

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-black/70 dark:text-white/70">Selection deadline</span>
          <input
            type="datetime-local"
            value={deadlineInput}
            onChange={(e) => setDeadlineInput(e.target.value)}
            className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={panel.status === "saving"}
          className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {panel.status === "saving" ? "Saving…" : "Save keeper rules"}
        </button>
        {panel.status === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
        {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/5">
        <span className="text-sm text-black/50 dark:text-white/50">
          {rules.locked_at ? `Locked ${new Date(rules.locked_at).toLocaleString()}` : "Not locked — owners can still edit their picks."}
        </span>
        <button
          onClick={toggleLock}
          disabled={lockBusy}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
            rules.locked_at
              ? "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              : "border-red-500/30 text-red-500 hover:bg-red-500/10"
          }`}
        >
          {lockBusy ? "Working…" : rules.locked_at ? "Unlock" : "Lock selections"}
        </button>
      </div>
    </section>
  );
}
