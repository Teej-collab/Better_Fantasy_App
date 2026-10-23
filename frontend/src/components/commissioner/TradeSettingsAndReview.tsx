"use client";

import { useEffect, useState } from "react";
import { CommishTradeBoard } from "@/components/commissioner/CommishTradeBoard";
import { getTradeSettings, updateTradeSettings, type TradeReviewMode } from "@/lib/tradesApi";

const REVIEW_MODES: { value: TradeReviewMode; label: string; help: string }[] = [
  {
    value: "commissioner",
    label: "Commissioner review",
    help: "Accepted trades wait out the review period, then process. You can veto or push one through early.",
  },
  {
    value: "league_vote",
    label: "League vote",
    help: "Accepted trades wait out the review period while the other teams can vote to veto. You can still veto or approve.",
  },
  { value: "approval", label: "Commissioner approval", help: "Accepted trades wait until you approve them." },
  { value: "none", label: "No review", help: "Trades process the moment they're accepted." },
];
const REVIEW_HOURS = [0, 12, 24, 48, 72];

// Real ISO 8601 -> the "YYYY-MM-DDTHH:mm" shape <input type="datetime-
// local"> needs, in the browser's own local time — same hand-built
// conversion DraftSetupPanel.tsx's ScheduleEditor uses (toISOString()
// would be wrong here, it's always UTC).
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Panel = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function TradeSettingsAndReview() {
  const [season, setSeason] = useState<number | null>(null);
  const [deadlineInput, setDeadlineInput] = useState("");
  const [reviewMode, setReviewMode] = useState<TradeReviewMode>("commissioner");
  const [reviewHours, setReviewHours] = useState(24);
  const [vetoVotes, setVetoVotes] = useState<number | null>(null);
  const [defaultVetoVotes, setDefaultVetoVotes] = useState(2);
  const [panel, setPanel] = useState<Panel>({ status: "idle" });

  useEffect(() => {
    const id = setTimeout(() => {
      getTradeSettings()
        .then((s) => {
          setSeason(s.season);
          setDeadlineInput(s.trade_deadline ? toDatetimeLocalValue(s.trade_deadline) : "");
          setReviewMode(s.review_mode ?? (s.review_required ? "approval" : "none"));
          setReviewHours(s.review_hours ?? 24);
          setVetoVotes(s.veto_votes_needed ?? null);
          setDefaultVetoVotes(s.effective_veto_votes_needed ?? 2);
        })
        .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load trade settings." }));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function save() {
    if (season === null) return;
    setPanel({ status: "saving" });
    try {
      const deadlineIso = deadlineInput ? new Date(deadlineInput).toISOString() : null;
      await updateTradeSettings(season, deadlineIso, { mode: reviewMode, hours: reviewHours, vetoVotesNeeded: vetoVotes });
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't save trade settings." });
    }
  }

  if (season === null) {
    return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Trade Settings</h2>
        <p className="text-sm text-black/50 dark:text-white/50">Controls for how trades work in this league.</p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-black/70 dark:text-white/70">Trade deadline</span>
          <input
            type="datetime-local"
            value={deadlineInput}
            onChange={(e) => setDeadlineInput(e.target.value)}
            className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
          {deadlineInput && (
            <button
              onClick={() => setDeadlineInput("")}
              className="text-xs text-black/50 hover:underline dark:text-white/50"
            >
              Clear
            </button>
          )}
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-black/70 dark:text-white/70">When a trade is accepted</legend>
          {REVIEW_MODES.map((mode) => (
            <label key={mode.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="trade-review-mode"
                checked={reviewMode === mode.value}
                onChange={() => setReviewMode(mode.value)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-medium">{mode.label}</span>
                <span className="block text-xs text-black/50 dark:text-white/50">{mode.help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {(reviewMode === "commissioner" || reviewMode === "league_vote") && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-black/70 dark:text-white/70">Review period</span>
            <select
              value={reviewHours}
              onChange={(e) => setReviewHours(Number(e.target.value))}
              className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
            >
              {REVIEW_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? "None (process on accept)" : h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </label>
        )}

        {reviewMode === "league_vote" && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-black/70 dark:text-white/70">Veto votes needed</span>
            <input
              type="number"
              min={1}
              max={20}
              value={vetoVotes ?? ""}
              placeholder={String(defaultVetoVotes)}
              onChange={(e) => setVetoVotes(e.target.value ? Math.max(1, Number(e.target.value)) : null)}
              className="w-20 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
            />
            <span className="text-xs text-black/50 dark:text-white/50">Blank = a third of the league ({defaultVetoVotes})</span>
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={panel.status === "saving"}
            className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {panel.status === "saving" ? "Saving…" : "Save trade settings"}
          </button>
          {panel.status === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
          {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
        </div>
      </div>

      {reviewMode !== "none" && (
        <div className="border-t border-black/5 pt-4 dark:border-white/5">
          <CommishTradeBoard />
        </div>
      )}
    </section>
  );
}
