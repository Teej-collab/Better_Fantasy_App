"use client";

import { useEffect, useRef, useState } from "react";
import type { BracketGame, PlayoffWorld, World, WorldTeam } from "@/lib/bracketEngine";
import { GameTile, TONES, routeLabel, toneFor, weeksLabel } from "@/components/bracket/GameTile";

// The Arena: the whole bracket on one board — the title game at the
// top, the semis below it, the glowing playoff line across the middle,
// and the consolation ladder below that down to the Toilet Bowl. Flat
// (2026-10: the tilted-3D version didn't read well); the board scales
// to its width and clips to its own box so it never draws over the
// nav. Under 640px wide it's a plain stacked list instead. The What-If
// Lab reuses the board (BracketBoard) with picking turned on.

const PLANE_W = 1200;
const PLANE_H = 1080;
const SLOTS: Record<string, { x: number; y: number; w: number; z: number }> = {
  F: { x: 450, y: 40, w: 300, z: 90 },
  SF1: { x: 90, y: 250, w: 290, z: 40 },
  SF2: { x: 820, y: 250, w: 290, z: 40 },
  "3RD": { x: 470, y: 300, w: 260, z: 20 },
  C1: { x: 20, y: 570, w: 270, z: 0 },
  C2: { x: 320, y: 570, w: 270, z: 0 },
  C3: { x: 620, y: 570, w: 270, z: 0 },
  C4: { x: 920, y: 570, w: 270, z: 0 },
  C5: { x: 20, y: 820, w: 270, z: -10 },
  C6: { x: 320, y: 820, w: 270, z: -14 },
  C7: { x: 620, y: 820, w: 270, z: -18 },
  C8: { x: 905, y: 810, w: 290, z: -40 },
};

export function ArenaView({
  world,
  w,
  teams,
  records,
  me,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string>("F");

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = w.games.every((g) => SLOTS[g.code]);
  const narrow = width > 0 && width < 640;
  const sel = w.games.find((g) => g.code === selected) ?? w.games[0];

  return (
    <div className="flex flex-col gap-3">
      <div ref={stageRef} className="w-full">
        {narrow || !placed ? (
          <StackedBracket world={world} w={w} teams={teams} records={records} me={me} />
        ) : (
          <Stage
            width={width}
            world={world}
            w={w}
            teams={teams}
            records={records}
            me={me}
            selected={selected}
            onSelect={setSelected}
          />
        )}
      </div>
      {!narrow && placed && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/10 bg-[#12161c] px-5 py-4 text-[#eceef1]">
          <span className="font-display text-xl tracking-wide" style={{ color: TONES[toneFor(sel)].kicker }}>
            {sel.toilet_bowl ? "TOILET BOWL" : sel.label.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 text-sm text-[#c9cfd8]">
            {weeksLabel(sel.weeks).replace("WK", "Weeks")}: {nameFor(sel.a, sel.seedA, teams)} vs {nameFor(sel.b, sel.seedB, teams)}.{" "}
            {routeLabel(sel, w.games, world.toilet_bowl_punishment)}.
            {sel.decided === "favorite" && sel.winner !== null && ` Favored on points per game: ${teams[sel.winner].name}.`}
          </span>
        </div>
      )}
    </div>
  );
}

function nameFor(team: number | null, seed: number | null, teams: Record<number, WorldTeam>): string {
  if (team === null) return "TBD";
  return `${seed ? `#${seed} ` : ""}${teams[team].name}`;
}

function Stage({
  width,
  world,
  w,
  teams,
  records,
  me,
  selected,
  onSelect,
  onPick,
}: {
  width: number;
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
  selected?: string;
  onSelect?: (code: string) => void;
  onPick?: (code: string, teamId: number) => void;
}) {
  const scale = Math.min(1, width / (PLANE_W + 40));
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-white/10"
      style={{
        height: Math.round((PLANE_H + 30) * scale),
        isolation: "isolate",
        background: "radial-gradient(1200px 700px at 50% 25%, #16202a 0%, #0d1016 70%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 10 * scale,
          width: PLANE_W,
          height: PLANE_H,
          transformOrigin: "0 0",
          transform: `scale(${scale}) translateX(-50%)`,
        }}
      >
        <div
          className="absolute inset-0 rounded-[28px] border border-[#1c2027]"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(57,255,20,0.03) 0 1px, transparent 1px 100px), repeating-linear-gradient(0deg, rgba(57,255,20,0.03) 0 1px, transparent 1px 100px), linear-gradient(180deg, #121a20 0%, #0f1418 55%, #1a1410 100%)",
          }}
        />
        <div className="absolute right-0 left-0" style={{ top: 515, height: 2, background: "linear-gradient(90deg, transparent, #39ff14, transparent)", boxShadow: "0 0 18px #39ff14" }} />
        <div className="absolute font-mono text-xs tracking-[0.25em] text-[#39ff14]" style={{ left: 40, top: 488 }}>
          PLAYOFF LINE — TOP {world.playoff_team_count}
        </div>
        <div className="absolute font-mono text-xs tracking-[0.25em] text-[#9aa3b2]" style={{ left: 40, top: 532 }}>
          CONSOLATION LADDER · EVERY SPOT IS PLAYED FOR
        </div>
        {w.games.map((g) => {
          const slot = SLOTS[g.code];
          return (
            <GameTile
              key={g.code}
              game={g}
              all={w.games}
              teams={teams}
              records={records}
              punishment={world.toilet_bowl_punishment}
              me={me}
              selected={g.code === selected}
              onSelect={onSelect && !onPick ? () => onSelect(g.code) : undefined}
              onPick={onPick ? (t) => onPick(g.code, t) : undefined}
              style={{ position: "absolute", left: slot.x, top: slot.y, width: slot.w, boxSizing: "border-box" }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The flat board on its own, for the What-If Lab: tap a team to pick
 *  them. Stacks into a list on narrow screens. */
export function BracketBoard({
  world,
  w,
  teams,
  records,
  me,
  onPick,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
  onPick: (code: string, teamId: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const placed = w.games.every((g) => SLOTS[g.code]);
  return (
    <div ref={ref} className="w-full">
      {width > 0 && width < 640 || !placed ? (
        <StackedBracket world={world} w={w} teams={teams} records={records} me={me} onPick={onPick} />
      ) : (
        <Stage width={width} world={world} w={w} teams={teams} records={records} me={me} onPick={onPick} />
      )}
    </div>
  );
}

/** Phones: winners first, then the ladder, as a simple list. */
function StackedBracket({
  world,
  w,
  teams,
  records,
  me,
  onPick,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
  onPick?: (code: string, teamId: number) => void;
}) {
  const sections: [string, BracketGame[]][] = [
    ["Winners' bracket", w.games.filter((g) => g.bracket === "winners")],
    ["Consolation ladder", w.games.filter((g) => g.bracket === "consolation")],
  ];
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-[#0d1016] p-3">
      {sections
        .filter(([, games]) => games.length)
        .map(([title, games]) => (
          <section key={title} className="flex flex-col gap-2">
            <h2 className="font-display px-1 text-lg tracking-wide text-[#eceef1]">{title.toUpperCase()}</h2>
            {games.map((g) => (
              <GameTile
                key={g.code}
                game={g}
                all={w.games}
                teams={teams}
                records={records}
                punishment={world.toilet_bowl_punishment}
                me={me}
                onPick={onPick ? (t) => onPick(g.code, t) : undefined}
              />
            ))}
          </section>
        ))}
    </div>
  );
}
