"use client";

import { useEffect, useState } from "react";
import {
  acceptTrade,
  cancelTrade,
  getLeagueTeamsForTrades,
  getMyTrades,
  getTeamRosterForTrade,
  proposeTrade,
  rejectTrade,
  type Trade,
  type TradeRosterPlayer,
  type TradeStatus,
  type TradeTeam,
} from "@/lib/tradesApi";

type ProposePanel = { status: "idle" } | { status: "submitting" } | { status: "error"; message: string };

const STATUS_LABEL: Record<TradeStatus, string> = {
  pending: "Pending",
  awaiting_review: "Awaiting commissioner review",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  vetoed: "Vetoed",
};

const STATUS_COLOR: Record<TradeStatus, string> = {
  pending: "text-amber-600 dark:text-amber-400",
  awaiting_review: "text-amber-600 dark:text-amber-400",
  accepted: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-black/50 dark:text-white/50",
  cancelled: "text-black/50 dark:text-white/50",
  vetoed: "text-red-500",
};

/**
 * Propose-a-trade flow (pick a team, pick players from each roster,
 * propose) plus a "My Trades" list with Accept/Reject/Cancel scoped to
 * whichever side of each trade the viewer is on — same client-fetch-
 * on-mount + refresh() shape as leagues/page.tsx, since this is the
 * same "personal admin" class of page, not a server-rendered display
 * page like Team/Matchup.
 */
export function TradesApp() {
  const [myOwnerId, setMyOwnerId] = useState<number | null>(null);
  const [teams, setTeams] = useState<TradeTeam[] | null>(null);
  const [myTrades, setMyTrades] = useState<Trade[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [myRoster, setMyRoster] = useState<TradeRosterPlayer[]>([]);
  const [theirRoster, setTheirRoster] = useState<TradeRosterPlayer[]>([]);
  const [give, setGive] = useState<Set<string>>(new Set());
  const [receive, setReceive] = useState<Set<string>>(new Set());
  const [proposePanel, setProposePanel] = useState<ProposePanel>({ status: "idle" });
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);

  const myTeam = teams?.find((t) => t.owner_id === myOwnerId) ?? null;
  const otherTeams = teams?.filter((t) => t.owner_id !== myOwnerId) ?? [];
  const teamNameById = new Map((teams ?? []).map((t) => [t.team_id, t.team_name]));

  async function refresh() {
    try {
      const me = await fetch("/auth/me")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      setMyOwnerId(me?.owner_id ?? null);
      const [teamList, trades] = await Promise.all([getLeagueTeamsForTrades(), getMyTrades()]);
      setTeams(teamList);
      setMyTrades(trades);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load trades.");
    }
  }

  useEffect(() => {
    // setTimeout(0) rather than calling refresh() directly in the effect
    // body — same trick this app's other client-fetch-on-mount pages use
    // (see leagues/page.tsx) to avoid react-hooks/set-state-in-effect.
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, []);

  const myTeamId = myTeam?.team_id ?? null;

  useEffect(() => {
    // setTimeout(0) rather than calling setMyRoster directly in the
    // effect body — same trick used throughout this app (see
    // DraftCountdownCard.tsx) to avoid react-hooks/set-state-in-effect.
    const id = setTimeout(() => {
      if (myTeamId === null) {
        setMyRoster([]);
        return;
      }
      getTeamRosterForTrade(myTeamId)
        .then(setMyRoster)
        .catch(() => setMyRoster([]));
    }, 0);
    return () => clearTimeout(id);
  }, [myTeamId]);

  useEffect(() => {
    const id = setTimeout(() => {
      setReceive(new Set());
      setTheirRoster([]);
      if (selectedTeamId === null) return;
      getTeamRosterForTrade(selectedTeamId)
        .then(setTheirRoster)
        .catch(() => setTheirRoster([]));
    }, 0);
    return () => clearTimeout(id);
  }, [selectedTeamId]);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function submitPropose() {
    if (selectedTeamId === null || give.size === 0 || receive.size === 0) return;
    setProposePanel({ status: "submitting" });
    try {
      await proposeTrade(selectedTeamId, [...give], [...receive]);
      setGive(new Set());
      setReceive(new Set());
      setSelectedTeamId(null);
      setProposePanel({ status: "idle" });
      await refresh();
    } catch (err) {
      setProposePanel({
        status: "error",
        message: err instanceof Error ? err.message : "Couldn't propose that trade.",
      });
    }
  }

  async function runAction(tradeId: number, action: (id: number) => Promise<Trade>) {
    setActionBusyId(tradeId);
    setError(null);
    try {
      await action(tradeId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    } finally {
      setActionBusyId(null);
    }
  }

  if (teams === null) return null;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <section className="neon-panel flex flex-col gap-4 rounded-lg bg-black/[0.015] p-4 dark:bg-white/[0.03]">
        <h2 className="font-medium">Propose a trade</h2>

        {otherTeams.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No other teams in this league yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {otherTeams.map((t) => (
                <button
                  key={t.team_id}
                  onClick={() => setSelectedTeamId(t.team_id)}
                  className={
                    selectedTeamId === t.team_id
                      ? "rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                  }
                >
                  {t.team_name}
                </button>
              ))}
            </div>

            {selectedTeamId !== null && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <PlayerPicker
                    title="You give"
                    players={myRoster}
                    selected={give}
                    onToggle={(id) => toggle(give, setGive, id)}
                  />
                  <PlayerPicker
                    title="You receive"
                    players={theirRoster}
                    selected={receive}
                    onToggle={(id) => toggle(receive, setReceive, id)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  {proposePanel.status === "error" && (
                    <p className="text-sm text-red-500">{proposePanel.message}</p>
                  )}
                  <button
                    onClick={submitPropose}
                    disabled={give.size === 0 || receive.size === 0 || proposePanel.status === "submitting"}
                    className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    {proposePanel.status === "submitting" ? "Proposing…" : "Propose trade"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">My trades</h2>
        {myTrades === null || myTrades.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No trades yet.</p>
        ) : (
          <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
            {myTrades.map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                myTeamId={myTeam?.team_id ?? null}
                teamNameById={teamNameById}
                busy={actionBusyId === trade.id}
                onAccept={() => runAction(trade.id, acceptTrade)}
                onReject={() => runAction(trade.id, rejectTrade)}
                onCancel={() => runAction(trade.id, cancelTrade)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlayerPicker({
  title,
  players,
  selected,
  onToggle,
}: {
  title: string;
  players: TradeRosterPlayer[];
  selected: Set<string>;
  onToggle: (sleeperPlayerId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</span>
      {players.length === 0 ? (
        <p className="text-sm text-black/40 dark:text-white/40">No players.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {players.map((p) => (
            <button
              key={p.sleeper_player_id}
              onClick={() => onToggle(p.sleeper_player_id)}
              className={
                selected.has(p.sleeper_player_id)
                  ? "flex items-center justify-between rounded-lg bg-[var(--wl-accent-dim)] px-3 py-2 text-left text-sm text-white"
                  : "flex items-center justify-between rounded-lg border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              }
            >
              <span>{p.player_name}</span>
              <span className={selected.has(p.sleeper_player_id) ? "text-white/70" : "text-black/40 dark:text-white/40"}>
                {p.position}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TradeRow({
  trade,
  myTeamId,
  teamNameById,
  busy,
  onAccept,
  onReject,
  onCancel,
}: {
  trade: Trade;
  myTeamId: number | null;
  teamNameById: Map<number, string>;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const isProposer = myTeamId !== null && trade.proposing_team_id === myTeamId;
  const isReceiver = myTeamId !== null && trade.receiving_team_id === myTeamId;
  const give = trade.assets.filter((a) => a.from_team_id === trade.proposing_team_id);
  const receive = trade.assets.filter((a) => a.from_team_id === trade.receiving_team_id);
  const otherTeamName = teamNameById.get(isProposer ? trade.receiving_team_id : trade.proposing_team_id) ?? "—";

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{isProposer ? `To ${otherTeamName}` : `From ${otherTeamName}`}</span>
        <span className={`text-xs font-semibold ${STATUS_COLOR[trade.status]}`}>{STATUS_LABEL[trade.status]}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 text-black/70 sm:grid-cols-2 dark:text-white/70">
        <div>
          <span className="text-xs text-black/40 dark:text-white/40">{isProposer ? "You give" : "They give"}</span>
          <p>{give.map((a) => a.player_name).join(", ") || "—"}</p>
        </div>
        <div>
          <span className="text-xs text-black/40 dark:text-white/40">{isProposer ? "You receive" : "They receive"}</span>
          <p>{receive.map((a) => a.player_name).join(", ") || "—"}</p>
        </div>
      </div>

      {trade.status === "pending" && isReceiver && (
        <div className="flex gap-2">
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? "Working…" : "Accept"}
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
          >
            Reject
          </button>
        </div>
      )}

      {trade.status === "pending" && isProposer && (
        <button
          onClick={onCancel}
          disabled={busy}
          className="w-fit rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
        >
          {busy ? "Working…" : "Cancel"}
        </button>
      )}
    </li>
  );
}
