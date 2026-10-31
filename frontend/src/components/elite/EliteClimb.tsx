"use client";

import { useState } from "react";
import type { PowerRankTrendTeam } from "@/lib/api";
import { ANTON, ELITE, EliteCard, eliteChipClass } from "@/components/elite/Elite";

// The Climb (elite pass, 2026-10-31): every team's weekly power rank on
// one chart. Yours is orange, the biggest climb green and the biggest
// fall a dashed blue; pick a team to light its line. The app's twin is
// PowerTrend in mobile/src/components/league/Sections.tsx.
const W = 640;
const H = 300;
const PAD_X = 22;
const TOP = 14;
const BOTTOM = 28;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function EliteClimb({ teams, myOwnerId }: { teams: PowerRankTrendTeam[]; myOwnerId: number | null }) {
  const [picked, setPicked] = useState<number | null>(null);
  const weeks = Array.from(new Set(teams.flatMap((t) => t.weeks.map((w) => w.week)))).sort((a, b) => a - b);
  const count = teams.length;
  const x = (idx: number) => (weeks.length > 1 ? PAD_X + (idx * (W - 2 * PAD_X)) / (weeks.length - 1) : W / 2);
  const y = (rank: number) => (count > 1 ? TOP + ((rank - 1) * (H - TOP - BOTTOM)) / (count - 1) : H / 2);
  const series = teams.map((t) => {
    const pts = weeks
      .map((w, idx) => {
        const rank = t.weeks.find((p) => p.week === w)?.power_rank;
        return rank !== undefined ? { idx, rank } : null;
      })
      .filter((p): p is { idx: number; rank: number } => p !== null);
    const first = pts[0]?.rank ?? null;
    const last = pts[pts.length - 1]?.rank ?? null;
    return {
      team: t,
      pts,
      first,
      last,
      delta: first !== null && last !== null ? first - last : 0,
      line: pts.map((p) => `${x(p.idx).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" "),
    };
  });
  type S = (typeof series)[number];
  const mine = series.find((s) => myOwnerId !== null && s.team.owner_id === myOwnerId) ?? null;
  const climb = series.reduce<S | null>((best, s) => (s.delta > 0 && (!best || s.delta > best.delta) ? s : best), null);
  const fall = series.reduce<S | null>((worst, s) => (s.delta < 0 && (!worst || s.delta < worst.delta) ? s : worst), null);
  const pickedS = series.find((s) => s.team.team_id === picked) ?? null;
  const special = new Set([mine?.team.team_id, climb?.team.team_id, fall?.team.team_id, picked].filter((v): v is number => v != null));
  const labelEvery = weeks.length > 9 ? 2 : 1;
  const dot = (s: S | null, color: string, r = 5) => {
    const last = s?.pts[s.pts.length - 1];
    return last ? <circle cx={x(last.idx)} cy={y(last.rank)} r={r} fill={color} /> : null;
  };

  return (
    <div className="flex flex-col gap-3">
      <EliteCard tone="deep" className="flex flex-col gap-2 py-3.5">
        <div className="flex items-baseline justify-between px-4">
          <span className={`${ANTON} text-xl`}>THE CLIMB</span>
          <span className="text-xs" style={{ color: ELITE.soft }}>
            Rank by week
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Power rank by week for all ${count} teams`}>
          {[1, Math.ceil(count / 2), count].map((r) => (
            <line key={r} x1={PAD_X} x2={W - PAD_X} y1={y(r)} y2={y(r)} stroke="rgba(245,244,236,.06)" />
          ))}
          {series
            .filter((s) => !special.has(s.team.team_id) && s.pts.length > 1)
            .map((s) => (
              <polyline key={s.team.team_id} points={s.line} fill="none" stroke="rgba(245,244,236,.18)" strokeWidth={1.5} strokeLinejoin="round" />
            ))}
          {fall && <polyline points={fall.line} fill="none" stroke={ELITE.blue} strokeWidth={2.5} strokeDasharray="5 4" strokeLinejoin="round" />}
          {climb && <polyline points={climb.line} fill="none" stroke={ELITE.green} strokeWidth={2.5} strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${ELITE.green})` }} />}
          {pickedS && <polyline points={pickedS.line} fill="none" stroke={ELITE.cream} strokeWidth={3} strokeLinejoin="round" />}
          {mine && <polyline points={mine.line} fill="none" stroke={ELITE.orange} strokeWidth={3.5} strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${ELITE.orange})` }} />}
          {dot(fall, ELITE.blue)}
          {dot(climb, ELITE.green)}
          {dot(pickedS, ELITE.cream)}
          {dot(mine, ELITE.orange, 6)}
          {weeks.map((w, idx) =>
            idx % labelEvery === 0 || idx === weeks.length - 1 ? (
              <text key={w} x={x(idx)} y={H - 8} fontSize={11} fontWeight={700} fill="rgba(245,244,236,.55)" textAnchor="middle">
                W{w}
              </text>
            ) : null
          )}
        </svg>
        <div className="flex flex-wrap gap-1.5 px-3">
          {mine && <Legend color={ELITE.orange} label={`${mine.team.team_name} · you`} />}
          {climb && <Legend color={ELITE.green} label="Biggest climb" />}
          {fall && <Legend color={ELITE.blue} label="Biggest fall" dashed />}
        </div>
        <div className="flex flex-wrap gap-1.5 px-3">
          {series.map((s) => {
            const on = picked === s.team.team_id;
            return (
              <button key={s.team.team_id} type="button" aria-pressed={on} onClick={() => setPicked(on ? null : s.team.team_id)} className={eliteChipClass(on)}>
                {s.last ?? "—"} · {s.team.team_name}
              </button>
            );
          })}
        </div>
      </EliteCard>
      {(climb || fall) && (
        <div className="grid grid-cols-2 gap-2.5">
          {climb && <Move label="BIGGEST CLIMB" color={ELITE.green} s={climb} />}
          {fall && <Move label="BIGGEST FALL" color={ELITE.blue} s={fall} />}
        </div>
      )}
    </div>
  );

  function Move({ label, color, s }: { label: string; color: string; s: S }) {
    return (
      <EliteCard className="flex flex-col gap-1 rounded-[18px] px-3.5 py-3" style={{ borderColor: `${color}59` }}>
        <span className="text-[11px] font-extrabold tracking-[1.5px]" style={{ color }}>
          {label}
        </span>
        <span className="font-bold">{s.team.team_name}</span>
        <span className={`${ANTON} text-xl`}>
          {ordinal(s.first!)} → {ordinal(s.last!)}
        </span>
      </EliteCard>
    );
  }
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex min-h-8 items-center gap-1.5 rounded-[10px] border border-white/[0.12] bg-[#10151c] px-2.5 text-xs font-semibold">
      <i className="w-3.5 border-t-[3px]" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {label}
    </span>
  );
}
