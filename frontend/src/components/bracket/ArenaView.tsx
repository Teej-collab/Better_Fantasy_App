"use client";

import { useEffect, useRef, useState } from "react";
import type { BracketGame, PlayoffWorld, World, WorldTeam } from "@/lib/bracketEngine";
import { GameTile, TONES, routeLabel, toneFor, weeksLabel } from "@/components/bracket/GameTile";

// The Arena (mockup A): the whole bracket as a floor tilted away from
// you. The title game sits raised at the far end on a gold pedestal,
// the semis below it, the glowing playoff line across the middle, and
// the consolation ladder nearer — sinking toward the Toilet Bowl.
// CSS 3D only (no WebGL): cheap on battery, smooth on phones. The stage
// clips to its own box and is its own stacking context, so the tilted
// floor never draws over the nav. Under 640px wide it's a plain stacked
// list instead.

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
  const [flat, setFlat] = useState(false);
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
            flat={flat}
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
          <button
            type="button"
            onClick={() => setFlat(!flat)}
            className="font-display h-11 rounded-full border border-[#39ff14] px-5 tracking-wide"
            style={{ background: flat ? "#39ff14" : "transparent", color: flat ? "#0d1016" : "#39ff14" }}
          >
            {flat ? "VIEW IN 3D" : "FLAT VIEW"}
          </button>
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
  flat,
  world,
  w,
  teams,
  records,
  me,
  selected,
  onSelect,
}: {
  width: number;
  flat: boolean;
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
  selected: string;
  onSelect: (code: string) => void;
}) {
  const scale = Math.min(1, width / (PLANE_W + 40));
  const height = Math.round((flat ? PLANE_H + 40 : 780) * scale);
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-white/10"
      style={{
        height,
        isolation: "isolate",
        background: "radial-gradient(1200px 700px at 50% 25%, #16202a 0%, #0d1016 70%)",
        perspective: flat ? undefined : 1700 * scale,
        perspectiveOrigin: "50% 12%",
        transition: "height 500ms ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: flat ? 20 * scale : 60 * scale,
          width: PLANE_W,
          height: PLANE_H,
          transformStyle: "preserve-3d",
          transformOrigin: "0 0",
          transform: `scale(${scale}) translateX(-50%) ${flat ? "" : "rotateX(48deg)"}`,
          transition: "transform 700ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          className="absolute inset-0 rounded-[28px] border border-[#1c2027]"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(57,255,20,0.04) 0 1px, transparent 1px 100px), repeating-linear-gradient(0deg, rgba(57,255,20,0.04) 0 1px, transparent 1px 100px), linear-gradient(180deg, #121a20 0%, #0f1418 55%, #1a1410 100%)",
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
          const sel = g.code === selected;
          const z = flat ? 0 : slot.z + (sel ? 36 : 0);
          return (
            <GameTile
              key={g.code}
              game={g}
              all={w.games}
              teams={teams}
              records={records}
              punishment={world.toilet_bowl_punishment}
              me={me}
              selected={sel}
              onSelect={() => onSelect(g.code)}
              style={{
                position: "absolute",
                left: slot.x,
                top: slot.y,
                width: slot.w,
                boxSizing: "border-box",
                transform: `translateZ(${z}px)`,
                transition: "transform 400ms cubic-bezier(.2,.8,.2,1)",
              }}
            />
          );
        })}
        {!flat && (
          <div
            className="font-display absolute text-center text-[22px] tracking-[0.3em] text-[#f5c542]"
            style={{ left: 450, top: -48, width: 300, transform: "translateZ(120px)", textShadow: "0 0 24px rgba(245,197,66,0.6)" }}
          >
            CHAMPIONSHIP
          </div>
        )}
      </div>
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
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
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
              />
            ))}
          </section>
        ))}
    </div>
  );
}
