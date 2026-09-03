"use client";

import { useEffect, useState } from "react";
import {
  getLeagueTeamsForTrades,
  getPendingTradesForReview,
  getTradeSettings,
  reviewTrade,
  updateTradeSettings,
  type Trade,
} from "@/lib/tradesApi";

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
  const [reviewRequired, setReviewRequired] = useState(false);
  const [panel, setPanel] = useState<Panel>({ status: "idle" });
  const [pending, setPending] = useState<Trade[] | null>(null);
  const [teamNameById, setTeamNameById] = useState<Map<number, string>>(new Map());
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function refreshPending() {
    try {
      setPending(await getPendingTradesForReview());
    } catch {
      setPending([]);
    }
  }

  useEffect(() => {
    const id = setTimeout(() => {
      getTradeSettings()
        .then((s) => {
          setSeason(s.season);
          setDeadlineInput(s.trade_deadline ? toDatetimeLocalValue(s.trade_deadline) : "");
          setReviewRequired(s.review_required);
        })
        .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load trade settings." }));
      refreshPending();
      getLeagueTeamsForTrades()
        .then((teams) => setTeamNameById(new Map(teams.map((t) => [t.team_id, t.team_name]))))
        .catch(() => setTeamNameById(new Map()));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function save() {
    if (season === null) return;
    setPanel({ status: "saving" });
    try {
      const deadlineIso = deadlineInput ? new Date(deadlineInput).toISOString() : null;
      await updateTradeSettings(season, deadlineIso, reviewRequired);
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't save trade settings." });
    }
  }

  async function respond(tradeId: number, approve: boolean) {
    setReviewBusyId(tradeId);
    setReviewError(null);
    try {
      await reviewTrade(tradeId, approve);
      await refreshPending();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setReviewBusyId(null);
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewRequired}
            onChange={(e) => setReviewRequired(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-black/70 dark:text-white/70">
            Require commissioner review before a trade applies
          </span>
        </label>

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

      {reviewRequired && (
        <div className="flex flex-col gap-2 border-t border-black/5 pt-4 dark:border-white/5">
          <h3 className="text-sm font-semibold">Pending review</h3>
          {reviewError && <p className="text-sm text-red-500">{reviewError}</p>}
          {pending === null || pending.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">No trades awaiting review.</p>
          ) : (
            <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
              {pending.map((trade) => (
                <li key={trade.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <p className="text-black/70 dark:text-white/70">
                    <strong>{teamNameById.get(trade.proposing_team_id) ?? `Team ${trade.proposing_team_id}`}</strong> gives{" "}
                    {trade.assets.filter((a) => a.from_team_id === trade.proposing_team_id).map((a) => a.player_name).join(", ")}{" "}
                    to <strong>{teamNameById.get(trade.receiving_team_id) ?? `Team ${trade.receiving_team_id}`}</strong> for{" "}
                    {trade.assets.filter((a) => a.from_team_id === trade.receiving_team_id).map((a) => a.player_name).join(", ")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respond(trade.id, true)}
                      disabled={reviewBusyId === trade.id}
                      className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {reviewBusyId === trade.id ? "Working…" : "Approve"}
                    </button>
                    <button
                      onClick={() => respond(trade.id, false)}
                      disabled={reviewBusyId === trade.id}
                      className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
                    >
                      Veto
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
