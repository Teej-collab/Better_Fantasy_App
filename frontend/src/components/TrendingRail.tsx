"use client";

import Link from "next/link";
import { useState } from "react";
import type { TrendingPlayers } from "@/lib/api";
import { ANTON, EliteCard, ELITE, HEX_CLIP, SEG_OFF, SEG_ON, SEG_WRAP } from "@/components/elite/Elite";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";

// The Free Agents page's Trending rail (elite Web A "Wire Room",
// 2026-11-05): the most added or dropped players across this app's
// leagues — the last day, or the last week when the day is too quiet to
// rank — and all of Sleeper (labeled as such) only when even the week is
// quiet. Each has a bar for how hard he's moving; green counts are
// players still free in your league.
export function TrendingRail({ adds, drops }: { adds: TrendingPlayers | null; drops: TrendingPlayers | null }) {
  const [kind, setKind] = useState<"add" | "drop">("add");
  const { openPlayerCard } = usePlayerCard();
  const data = kind === "add" ? adds : drops;
  const players = (data?.players ?? []).slice(0, 10);
  const accent = kind === "add" ? ELITE.green : ELITE.orange;
  const max = players[0]?.count || 1;
  const span = data?.window === "7d" ? "Last 7 days" : "Last 24 hrs";
  const fromSleeper = data !== null && data.source !== "app";
  const where = fromSleeper
    ? "Trending across Sleeper"
    : `${data?.leagues_tracked ?? 0} ${data?.leagues_tracked === 1 ? "league" : "leagues"} on The Weekend`;

  return (
    <EliteCard tone="green" className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className={`${ANTON} text-[22px] tracking-wide`}>TRENDING</h2>
        <div className={SEG_WRAP}>
          <button type="button" onClick={() => setKind("add")} aria-pressed={kind === "add"} className={kind === "add" ? SEG_ON : SEG_OFF}>
            Adds
          </button>
          <button type="button" onClick={() => setKind("drop")} aria-pressed={kind === "drop"} className={kind === "drop" ? SEG_ON : SEG_OFF}>
            Drops
          </button>
        </div>
      </div>
      <p className="text-xs text-[#f5f4ec]/55">
        {span} · {where}
        {fromSleeper && <span className="mt-0.5 block">Switches to our leagues once they&apos;re busy enough to rank.</span>}
      </p>
      {players.length === 0 ? (
        <p className="text-sm text-[#f5f4ec]/55">Nothing moving yet.</p>
      ) : (
        <ol className="flex flex-col">
          {players.map((p, i) => (
            <li key={p.sleeper_player_id} className="flex items-center gap-2.5 border-b border-white/[0.06] py-2 last:border-b-0">
              <span
                className={`${ANTON} flex h-7 w-[26px] shrink-0 items-center justify-center text-[13px]`}
                style={{ clipPath: HEX_CLIP, background: i === 0 ? ELITE.orange : "#1b2330", color: i === 0 ? ELITE.deep : "#c9d2dc" }}
              >
                {i + 1}
              </span>
              <PlayerHeadshot sleeperPlayerId={p.sleeper_player_id} proTeam={p.pro_team} name={p.full_name} size={32} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2 text-[13px]">
                  <button type="button" onClick={() => openPlayerCard(p.sleeper_player_id)} className="truncate text-left font-bold hover:underline">
                    {p.full_name}
                  </button>
                  <span className="shrink-0 text-[11px] text-[#f5f4ec]/50">
                    {p.position === "DEF" ? "D/ST" : p.position} · {p.pro_team ?? "FA"}
                  </span>
                </span>
                <span className="block h-[5px] rounded bg-[#1b2330]">
                  <span
                    className="block h-[5px] rounded"
                    style={{ width: `${Math.round((p.count / max) * 100)}%`, background: accent, boxShadow: `0 0 6px ${accent}` }}
                  />
                </span>
              </span>
              <span
                className={`${ANTON} w-12 shrink-0 text-right text-[17px]`}
                style={{ color: p.available ? accent : "rgba(245,244,236,.45)" }}
                title={p.available ? "Available in your league" : "Rostered in your league"}
              >
                {kind === "add" ? "+" : "−"}
                {p.count >= 10000 ? `${Math.round(p.count / 1000)}k` : p.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] leading-relaxed text-[#f5f4ec]/55">
        Counts every pickup and drop, including moves made on ESPN and Sleeper in connected leagues.{" "}
        <span style={{ color: accent }} className="font-bold">
          Bright
        </span>{" "}
        = still available in your league.
      </p>
      <Link href="/free-agents/trending" className="text-xs font-bold text-[#39ff14] hover:underline">
        See all trending →
      </Link>
    </EliteCard>
  );
}
