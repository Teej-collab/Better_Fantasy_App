"use client";

import { useEffect, useState } from "react";
import { getRosterSlots, setRosterSlots } from "@/lib/draftApi";

// Same real ESPN roster shape DraftSetupPanel.tsx's own
// DEFAULT_ROSTER_SLOTS uses — the starting point shown here when
// nothing's been staged or drafted yet for the season.
const DEFAULT_ROSTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, "RB/WR/TE": 1, "D/ST": 1, K: 1, BE: 7, IR: 1 };
const SLOT_LABELS: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  "RB/WR/TE": "Flex (RB/WR/TE)",
  "D/ST": "D/ST",
  K: "K",
  BE: "Bench",
  IR: "IR",
};

type Panel = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/**
 * Roster/lineup slot shape, editable independently of Draft Setup
 * (2026-09-03) — DraftSetupPanel.tsx used to be the ONLY place this
 * was ever set, with no standalone edit and no visible form (it just
 * silently sent a hardcoded constant). This is the general-purpose
 * editor; DraftSetupPanel now pre-fills from whatever's staged here
 * instead of always overwriting it with that hardcoded default.
 */
export function RosterSlotsSection() {
  const [values, setValues] = useState<Record<string, number> | null>(null);
  const [editable, setEditable] = useState(true);
  const [panel, setPanel] = useState<Panel>({ status: "idle" });

  useEffect(() => {
    const id = setTimeout(() => {
      getRosterSlots()
        .then(({ roster_slots, editable }) => {
          setValues(roster_slots ?? DEFAULT_ROSTER_SLOTS);
          setEditable(editable);
        })
        .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load roster settings." }));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function save() {
    if (!values) return;
    setPanel({ status: "saving" });
    try {
      const { roster_slots } = await setRosterSlots(values);
      setValues(roster_slots);
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't save roster settings." });
    }
  }

  if (values === null) {
    return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Roster Slots</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          How many of each slot every team&apos;s roster carries.
        </p>
      </div>

      {!editable && (
        <p className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-black/60 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/60">
          A draft already exists for this season, so this is read-only — reset the draft on the Draft page first if
          you need to change roster shape.
        </p>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.keys(DEFAULT_ROSTER_SLOTS).map((key) => (
          <label key={key} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-black/70 dark:text-white/70">{SLOT_LABELS[key] ?? key}</span>
            <input
              type="number"
              min={0}
              disabled={!editable}
              value={values[key] ?? 0}
              onChange={(e) => setValues((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
              className="w-20 shrink-0 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-right tabular-nums disabled:opacity-40 dark:border-white/10"
            />
          </label>
        ))}
      </div>

      {editable && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={panel.status === "saving"}
            className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {panel.status === "saving" ? "Saving…" : "Save roster slots"}
          </button>
          {panel.status === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
          {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
        </div>
      )}
    </section>
  );
}
