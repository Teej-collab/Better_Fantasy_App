"use client";

import { useEffect, useState } from "react";
import { GroupTitle, panelClass } from "@/components/commissioner/CommishBits";
import { commishApi, TONES, type CommishTradeReview, type ReviewTrade } from "@/lib/commishApi";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Trades waiting on the commissioner (2026-10-23 overhaul, mockup 5):
// what each side gets, how lopsided it looks by rest-of-season
// projections, veto votes and when it goes through. Approve, or veto
// with a reason both teams are told. Same as the app's ReviewBoard in
// mobile/src/app/commissioner/trades.tsx.

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Going through now";
  const h = Math.floor(ms / 3_600_000);
  return `Goes through in ${h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`}`;
}

export function CommishTradeBoard() {
  const [data, setData] = useState<CommishTradeReview | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    commishApi.trades().then(setData).catch(() => setData(null));
  }, [version]);

  const trades = data?.trades ?? [];
  return (
    <section className="flex flex-col gap-3">
      <GroupTitle title={`Waiting on you${trades.length ? ` · ${trades.length}` : ""}`} color={TONES.orange} />
      {!data ? (
        <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>
      ) : trades.length === 0 ? (
        <p className="text-sm text-black/55 dark:text-white/55">No trades are waiting for review.</p>
      ) : (
        trades.map((t) => (
          <ReviewCard
            key={t.id}
            trade={t}
            votesNeeded={data.settings.effective_veto_votes_needed}
            voting={data.settings.review_mode === "league_vote"}
            onDone={() => setVersion((v) => v + 1)}
          />
        ))
      )}
    </section>
  );
}

function ReviewCard({ trade, votesNeeded, voting, onDone }: { trade: ReviewTrade; votesNeeded: number; voting: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<"approve" | "veto" | null>(null);
  const [vetoing, setVetoing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [a, b] = trade.sides;
  const total = Math.max(1, (a?.ros_points ?? 0) + (b?.ros_points ?? 0));
  const share = (a?.ros_points ?? 0) / total;
  const gap = Math.abs((a?.ros_points ?? 0) - (b?.ros_points ?? 0));
  const leader = (a?.ros_points ?? 0) >= (b?.ros_points ?? 0) ? a : b;
  const verdict = gap < total * 0.1 ? "Looks even" : gap < total * 0.3 ? `Leans ${leader?.team_name ?? "one side"}` : "Very lopsided";
  const verdictColor = gap < total * 0.1 ? "#16a34a" : gap < total * 0.3 ? "#ca8a04" : "#ef4444";

  async function respond(approve: boolean) {
    setBusy(approve ? "approve" : "veto");
    setError(null);
    try {
      await commishApi.reviewTrade(trade.id, approve, approve ? undefined : reason.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={`${panelClass} flex flex-col gap-3 p-4`}>
      <div className="flex justify-between gap-2 text-xs text-black/55 dark:text-white/55">
        <span>{trade.accepted_at ? `Accepted ${new Date(trade.accepted_at).toLocaleString()}` : "Waiting for your approval"}</span>
        {trade.status === "in_review" && <span className="font-bold text-amber-500">{countdown(trade.review_ends_at)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {trade.sides.map((side) => (
          <div key={side.team_id} className="flex flex-col gap-1 rounded-xl bg-black/[0.04] p-3 dark:bg-white/[0.05]">
            <span className="truncate text-sm font-extrabold">{side.team_name ?? "Team"}</span>
            <span className="text-[11px] font-bold tracking-wider text-black/50 uppercase dark:text-white/50">Gets</span>
            {side.gets.map((g) => (
              <span key={g.sleeper_player_id} className="text-sm font-semibold">
                {g.name}{" "}
                <span className="text-xs font-normal text-black/50 dark:text-white/50">
                  {g.position === "DEF" ? "D/ST" : g.position}
                  {g.pro_team ? ` · ${g.pro_team}` : ""}
                  {g.injury_status ? ` · ${g.injury_status}` : ""}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-black/55 dark:text-white/55">Rest-of-season projection</span>
          <span className="font-bold" style={{ color: verdictColor }}>
            {verdict}
          </span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <span style={{ width: `${Math.max(share, 0.02) * 100}%`, backgroundColor: TONES.blue }} />
          <span className="flex-1" style={{ backgroundColor: TONES.orange }} />
        </div>
        <div className="flex justify-between text-xs font-bold">
          <span style={{ color: TONES.blue }}>{a ? `${a.ros_points.toFixed(1)} pts` : ""}</span>
          <span style={{ color: TONES.orange }}>{b ? `${b.ros_points.toFixed(1)} pts` : ""}</span>
        </div>
      </div>
      {voting && (
        <span className="text-xs text-black/55 dark:text-white/55">
          {trade.veto_votes} veto vote{trade.veto_votes === 1 ? "" : "s"} so far · {votesNeeded} needed
        </span>
      )}
      {trade.note && <span className="text-sm text-black/60 dark:text-white/60">“{trade.note}”</span>}
      {vetoing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Why? Both teams see this (optional)"
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setVetoing(false)} className="min-h-11 flex-1 rounded-xl border border-black/15 font-bold dark:border-white/15">
              Cancel
            </button>
            <button type="button" onClick={() => respond(false)} disabled={!!busy} className="min-h-11 flex-1 rounded-xl border border-red-500/50 font-bold text-red-500 disabled:opacity-50">
              {busy === "veto" ? "Vetoing…" : "Veto trade"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => respond(true)}
            disabled={!!busy}
            className="min-h-11 flex-1 rounded-xl font-extrabold text-black disabled:opacity-50"
            style={{ backgroundColor: NAV_ACCENT }}
          >
            {busy === "approve" ? "Approving…" : trade.status === "in_review" ? "Approve now" : "Approve"}
          </button>
          <button type="button" onClick={() => setVetoing(true)} disabled={!!busy} className="min-h-11 flex-1 rounded-xl border border-red-500/50 font-bold text-red-500 disabled:opacity-50">
            Veto…
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </article>
  );
}
