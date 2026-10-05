"use client";

import { useEffect, useMemo, useState } from "react";
import {
  VIEW_H,
  VIEW_W,
  bandPoints,
  endLineAngle,
  pathD,
  playPath,
  pointsAttr,
  project,
  type PlayPath,
} from "@/lib/fieldGeometry";
import { nflTeamColor, nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import type { GamecastPlay, LiveGame } from "@/lib/gamecastApi";
import { prefersReducedMotion } from "@/lib/useWeekendIntro";

const NON_SNAP_TYPES = new Set(["timeout", "other"]);
const YARD_LABELS: [number, string][] = [
  [20, "20"],
  [50, "50"],
  [80, "20"],
];
const PLAY_MS: Record<PlayPath["kind"], number> = { pass: 1100, run: 900, kick: 1900, field_goal: 1500 };

function ordinal(n: number) {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

function lastSnap(game: LiveGame): GamecastPlay | null {
  return game.plays.find((p) => p.is_scoring_play || !NON_SNAP_TYPES.has(p.play_type)) ?? null;
}

/**
 * The broadcast-style field: drawn in perspective (the far sideline
 * narrower, see lib/fieldGeometry.ts), team-colored end zones with their
 * names, goalposts, the line of scrimmage and the yellow first-down
 * line, and a pin with the offense's logo on the ball.
 *
 * Every new snap is replayed on it: a pass arcs from the pocket to where
 * it was caught (toward the side ESPN's description names), a punt,
 * kickoff or field goal flies high and comes down (then the return runs
 * back along the turf), a run or sack slides along the ground — the ball
 * casts a shadow on the turf while it's in the air. After the play the
 * path stays as an arrow, with a dashed line on to the first-down mark.
 *
 * The offense always drives left → right, so there's no need to track
 * which physical end of a real field either team defends. Reduced
 * motion shows each play's finished state without the flight.
 */
export function FieldVisualization({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  const offense = game.possession_team_abbr;
  const defense =
    offense === game.home_team.abbr ? game.away_team.abbr : offense === game.away_team.abbr ? game.home_team.abbr : null;
  const hasLiveBall = game.status === "in_progress" && game.yards_to_goal !== null && offense !== null;
  const possessionColor = offense ? nflTeamColor(offense) : null;
  const defenseColor = defense ? nflTeamColor(defense) : null;
  const ytg = game.yards_to_goal ?? 50;
  const ballU = 100 - ytg;
  const goalToGo = game.distance !== null && game.distance >= ytg;
  const firstU = hasLiveBall && game.distance !== null && !goalToGo ? 100 - Math.max(0, ytg - game.distance) : null;

  const snap = lastSnap(game);
  const path = useMemo(() => (hasLiveBall && snap ? playPath(snap, offense) : null), [hasLiveBall, snap, offense]);
  const progress = usePlayProgress(snap?.play_id ?? null, path);

  const downText = game.down ? `${ordinal(game.down)} & ${goalToGo ? "Goal" : (game.distance ?? "?")}` : null;
  const leftName = hasLiveBall ? (nflTeamName(offense)?.split(" ").pop() ?? offense) : null;
  const rightName = hasLiveBall && defense ? (nflTeamName(defense)?.split(" ").pop() ?? defense) : null;

  // The one live-tier card on this screen (Documentation/UX/
  // 01_Design_System.md's motion-budget rule) — the field literally
  // shows the ball moving, so it's the one place a static live accent
  // earns its keep; everything else on Gamecast goes flat under beta.
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? (hasLiveBall ? "wl-card--live" : "wl-card") : "neon-panel"}`}
      style={!beta && possessionColor ? { ["--panel-glow" as string]: possessionColor } : undefined}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Field Position</h2>
        {game.is_redzone && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-500 uppercase">
            Red Zone
          </span>
        )}
      </div>

      {hasLiveBall && (
        <div className="grid grid-cols-2 divide-x divide-white/15 text-center">
          <div>
            <p className="text-xs text-white/50">Down</p>
            <p className="text-lg font-bold tabular-nums">{downText ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-white/50">Ball on</p>
            <p className="text-lg font-bold tabular-nums">{game.field_position_label ?? "—"}</p>
          </div>
        </div>
      )}

      <div className="relative">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" role="img" aria-label={fieldLabel(game, downText)}>
          <defs>
            <linearGradient id="fv-turf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#26282d" />
              <stop offset="1" stopColor="#1d1f23" />
            </linearGradient>
            <filter id="fv-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker id="fv-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#fff" />
            </marker>
          </defs>

          {/* Turf, with alternating 10-yard bands like a mowed field. */}
          <polygon points={pointsAttr(bandPoints(-10, 110))} fill="url(#fv-turf)" />
          {Array.from({ length: 10 }, (_, i) =>
            i % 2 === 1 ? (
              <polygon key={`b${i}`} points={pointsAttr(bandPoints(i * 10, i * 10 + 10))} fill="rgba(255,255,255,0.035)" />
            ) : null
          )}
          {hasLiveBall && game.is_redzone && (
            <polygon points={pointsAttr(bandPoints(80, 100))} fill="rgba(239,68,68,0.12)" />
          )}

          {/* End zones: the offense's own on the left, its target on the right. */}
          <EndZone u0={-10} u1={0} color={hasLiveBall ? (possessionColor ?? "#333") : "#2b2d31"} name={leftName} />
          <EndZone u0={100} u1={110} color={hasLiveBall ? (defenseColor ?? "#333") : "#2b2d31"} name={rightName} />

          {Array.from({ length: 11 }, (_, i) => {
            const a = project(i * 10, 0);
            const b = project(i * 10, 1);
            return (
              <line
                key={`l${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#fff"
                strokeOpacity={i === 5 ? 0.35 : 0.16}
                strokeWidth={i === 0 || i === 10 ? 3 : 2}
              />
            );
          })}

          <Goalpost u={-10} />
          <Goalpost u={110} />

          {hasLiveBall && (
            <>
              <GroundLine u={ballU} color="#60a5fa" width={3} />
              {firstU !== null && <GroundLine u={firstU} color="#facc15" width={4} glow />}
              <PlayTrail path={path} progress={progress} ballU={ballU} firstU={firstU} />
              <BallPin u={ballU} team={offense} color={possessionColor} visible={progress >= 1} />
            </>
          )}

          {/* Yard numbers under the near sideline, the teams at each goal line. */}
          {hasLiveBall && (
            <>
              <YardLabel u={0} text={offense ?? ""} />
              <YardLabel u={100} text={defense ?? ""} />
            </>
          )}
          {YARD_LABELS.map(([u, text]) => (
            <YardLabel key={u} u={u} text={text} />
          ))}

          {!hasLiveBall && (
            <text x={VIEW_W / 2} y={(project(50, 0.5).y)} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.45)" fontSize="28">
              {game.status === "final" ? "Game complete" : game.status === "halftime" ? "Halftime" : game.status === "scheduled" ? "Not started yet" : "—"}
            </text>
          )}
        </svg>
        {path?.label && progress >= 1 && (
          <span className="gamecast-play-label pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-0.5 text-xs font-bold text-white">
            {path.label}
          </span>
        )}
      </div>

      {hasLiveBall && (
        <p className="text-center text-sm text-black/60 dark:text-white/60">
          <span className="font-semibold" style={{ color: possessionColor ?? undefined }}>
            {offense}
          </span>{" "}
          ball · {game.field_position_label}
          {game.current_drive && (
            <span className="text-white/40">
              {" "}
              · Drive: {game.current_drive.play_count} plays, {game.current_drive.yards} yds
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function fieldLabel(game: LiveGame, downText: string | null): string {
  if (game.status !== "in_progress" || !game.possession_team_abbr) return "Football field";
  return `${game.possession_team_abbr} ball${game.field_position_label ? ` at ${game.field_position_label}` : ""}${downText ? `, ${downText}` : ""}${game.is_redzone ? ", in the red zone" : ""}.`;
}

/** 0 → 1 over a new play's flight; restarts whenever the snap changes. */
function usePlayProgress(playId: string | null, path: PlayPath | null): number {
  const [state, setState] = useState<{ id: string | null; p: number }>({ id: null, p: 1 });
  useEffect(() => {
    if (!path || playId === null || prefersReducedMotion() || document.documentElement.classList.contains("motion-reduced")) {
      return;
    }
    const duration = PLAY_MS[path.kind];
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      setState({ id: playId, p });
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playId, path]);
  return state.id === playId ? state.p : 1;
}

function EndZone({ u0, u1, color, name }: { u0: number; u1: number; color: string; name: string | null }) {
  const mid = project((u0 + u1) / 2, 0.5);
  const angle = endLineAngle((u0 + u1) / 2);
  // Left reads bottom → top, right top → bottom, like a broadcast.
  const rotate = u0 < 50 ? angle : angle + 180;
  return (
    <>
      <polygon points={pointsAttr(bandPoints(u0, u1))} fill={color} fillOpacity={0.92} />
      {name && (
        <text
          x={mid.x}
          y={mid.y}
          transform={`rotate(${rotate.toFixed(1)} ${mid.x.toFixed(1)} ${mid.y.toFixed(1)})`}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize="34"
          fontWeight="900"
          letterSpacing="2"
          style={{ textTransform: "uppercase" }}
        >
          {name}
        </text>
      )}
    </>
  );
}

function Goalpost({ u }: { u: number }) {
  // Seen from the stands the crossbar runs across the field, so it
  // reads as an upright "U": a post, a short crossbar, two uprights.
  const base = project(u, 0.5);
  const bar = project(u, 0.5, 3.3);
  const l = project(u, 0.4, 3.3);
  const r = project(u, 0.6, 3.3);
  const lt = project(u, 0.4, 11);
  const rt = project(u, 0.6, 11);
  return (
    <g stroke="#facc15" strokeWidth={4} strokeLinecap="round" fill="none">
      <line x1={base.x} y1={base.y} x2={bar.x} y2={bar.y} stroke="#9ca3af" />
      <path d={`M${lt.x},${lt.y} L${l.x},${l.y} L${r.x},${r.y} L${rt.x},${rt.y}`} />
    </g>
  );
}

function GroundLine({ u, color, width, glow = false }: { u: number; color: string; width: number; glow?: boolean }) {
  const a = project(u, 0);
  const b = project(u, 1);
  return (
    <line
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={color}
      strokeWidth={width}
      filter={glow ? "url(#fv-glow)" : undefined}
    />
  );
}

function YardLabel({ u, text }: { u: number; text: string }) {
  const p = project(u, 1);
  return (
    <text x={p.x} y={p.y + 36} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="26" fontWeight="600">
      {text}
    </text>
  );
}

function PlayTrail({ path, progress, ballU, firstU }: { path: PlayPath | null; progress: number; ballU: number; firstU: number | null }) {
  if (!path) return null;
  const count = path.samples.length;
  const upto = Math.max(1, Math.round(progress * (count - 1)));
  const shown = path.samples.slice(0, upto + 1);
  const air = shown.map((s) => project(s.u, s.v, s.h));
  const shadow = shown.map((s) => project(s.u, s.v));
  const head = shown[shown.length - 1];
  const done = progress >= 1;
  const airborne = path.kind !== "run";
  const ballAt = project(head.u, head.v, head.h);
  const shadowAt = project(head.u, head.v);
  const dashFrom = project(ballU, 0.5);
  const dashTo = firstU !== null ? project(firstU, 0.5) : null;
  return (
    <g>
      {airborne && <path d={pathD(shadow)} stroke="rgba(0,0,0,0.45)" strokeWidth={3} fill="none" strokeDasharray="2 6" />}
      <path
        d={pathD(air)}
        stroke="#fff"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={path.incomplete && done ? 0.45 : 0.95}
        markerEnd={done && !path.incomplete ? "url(#fv-arrow)" : undefined}
      />
      {done && dashTo && Math.abs((firstU ?? 0) - ballU) > 0.5 && (
        <line x1={dashFrom.x} y1={dashFrom.y} x2={dashTo.x} y2={dashTo.y} stroke="#fff" strokeWidth={4} strokeDasharray="8 8" opacity={0.85} />
      )}
      {!done && (
        <>
          {airborne && <ellipse cx={shadowAt.x} cy={shadowAt.y} rx={9} ry={3.5} fill="rgba(0,0,0,0.5)" />}
          <g transform={`translate(${ballAt.x.toFixed(1)} ${ballAt.y.toFixed(1)}) rotate(${path.kind === "run" ? 0 : -20})`}>
            <ellipse rx={11} ry={7} fill="#8b4513" stroke="#3b1d07" strokeWidth={1.5} />
            <line x1={-4} y1={0} x2={4} y2={0} stroke="#fff" strokeWidth={1.5} />
          </g>
        </>
      )}
    </g>
  );
}

function BallPin({ u, team, color, visible }: { u: number; team: string | null; color: string | null; visible: boolean }) {
  const at = project(u, 0.5);
  const logo = teamLogoUrl(team);
  // A map pin standing on the ball's spot, the offense's logo inside.
  return (
    <g
      style={{ transform: `translate(${at.x}px, ${at.y}px)`, opacity: visible ? 1 : 0, transition: "transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.3s" }}
    >
      <ellipse cx={0} cy={0} rx={10} ry={4} fill="rgba(0,0,0,0.45)" />
      <path d="M0,0 C-10,-22 -32,-38 -32,-62 A32,32 0 1 1 32,-62 C32,-38 10,-22 0,0 Z" fill="#2b2d31" stroke="#fff" strokeWidth={3} />
      <circle cx={0} cy={-62} r={24} fill={color ?? "#444"} />
      {logo ? (
        <image href={logo} x={-22} y={-84} width={44} height={44} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <text x={0} y={-62} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="18" fontWeight="800">
          {team}
        </text>
      )}
    </g>
  );
}
