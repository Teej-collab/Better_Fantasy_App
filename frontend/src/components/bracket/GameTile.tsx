"use client";

import type { BracketGame, WorldTeam } from "@/lib/bracketEngine";

// One playoff game: label and weeks, both teams (seed, name, team name,
// score once there is one), the winner bright and the loser faded, and
// how it was decided — a real result, the user's pick, or the favorite.
// In the What-If Lab, tapping a team picks them to win (onPick).

export type Tone = "gold" | "win" | "cons" | "bowl";

export function toneFor(g: BracketGame): Tone {
  if (g.code === "F") return "gold";
  if (g.toilet_bowl) return "bowl";
  return g.bracket === "winners" ? "win" : "cons";
}

export const TONES: Record<Tone, { border: string; glow: string; bg: string; kicker: string; foot: string }> = {
  gold: { border: "#f5c542", glow: "rgba(245,197,66,0.40)", bg: "linear-gradient(160deg,#2a2412,#15130c)", kicker: "#f5c542", foot: "#f5c542" },
  win: { border: "#39ff14", glow: "rgba(57,255,20,0.20)", bg: "linear-gradient(160deg,#14201a,#10161a)", kicker: "#39ff14", foot: "#9aa3b2" },
  cons: { border: "#2b3340", glow: "rgba(0,0,0,0.45)", bg: "linear-gradient(160deg,#161b22,#12161c)", kicker: "#8b95a5", foot: "#9aa3b2" },
  bowl: { border: "#a8743c", glow: "rgba(168,116,60,0.45)", bg: "linear-gradient(160deg,#2a1d12,#16100b)", kicker: "#d9a066", foot: "#d9a066" },
};

const DECIDED_TAG: Record<BracketGame["decided"], string> = {
  real: "FINAL",
  pick: "YOUR PICK",
  favorite: "FAVORED",
  pending: "",
};

export function weeksLabel(weeks: number[]): string {
  return weeks.length > 1 ? `WK ${weeks[0]}–${weeks[weeks.length - 1]}` : `WK ${weeks[0]}`;
}

/** Where this game's winner and loser go, in plain words. */
export function routeLabel(g: BracketGame, all: BracketGame[], punishment: string): string {
  if (g.places) {
    const [w, l] = g.places;
    if (g.code === "F") return "Winner: league champion · Loser: 2nd";
    if (g.toilet_bowl) return `Loser: ${ordinalWord(l)} (last) + ${punishment === "TBD" ? "punishment TBD" : punishment}`;
    return `Winner ${ordinalWord(w)} · Loser ${ordinalWord(l)}`;
  }
  const next = (kind: "winner" | "loser") =>
    all.find((x) => x.sources.some((s) => s.kind === kind && s.code === g.code));
  const w = next("winner");
  const l = next("loser");
  return [w && `W → ${shortName(w)}`, l && `L → ${shortName(l)}`].filter(Boolean).join(" · ");
}

function shortName(g: BracketGame): string {
  if (g.code === "F") return "Title game";
  if (g.code === "3RD") return "3rd place";
  if (g.toilet_bowl) return "Toilet Bowl";
  return g.label.split(" · ")[0];
}

function ordinalWord(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function GameTile({
  game,
  all,
  teams,
  records,
  punishment,
  me,
  selected,
  compact,
  onSelect,
  onPick,
  style,
}: {
  game: BracketGame;
  all: BracketGame[];
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  punishment: string;
  me: number | null;
  selected?: boolean;
  compact?: boolean;
  onSelect?: () => void;
  onPick?: (teamId: number) => void;
  style?: React.CSSProperties;
}) {
  const tone = TONES[toneFor(game)];
  const mine = me !== null && (game.a === me || game.b === me);
  const sides = [
    { team: game.a, seed: game.seedA, score: game.score_a, from: game.sources[0] },
    { team: game.b, seed: game.seedB, score: game.score_b, from: game.sources[1] },
  ];
  // Selectable (the Arena): the whole tile is one button. Pickable
  // (the What-If Lab): each team row is its own button instead.
  const Outer = onSelect && !onPick ? "button" : "div";
  return (
    <Outer
      type={Outer === "button" ? "button" : undefined}
      onClick={onSelect && !onPick ? onSelect : undefined}
      aria-label={Outer === "button" ? `${game.label}, ${weeksLabel(game.weeks)}` : undefined}
      className="flex flex-col text-left text-[#eceef1]"
      style={{
        gap: compact ? 6 : 10,
        padding: compact ? "10px 12px" : "14px 16px",
        borderRadius: compact ? 12 : 16,
        border: `${selected || mine ? 2 : 1}px solid ${selected ? "#ffffff" : mine ? "rgba(255,255,255,0.75)" : tone.border}`,
        background: tone.bg,
        boxShadow: `0 18px 40px ${tone.glow}`,
        cursor: Outer === "button" ? "pointer" : undefined,
        ...style,
      }}
    >
      <div className="flex items-center justify-between font-mono tracking-[0.15em]" style={{ fontSize: compact ? 10 : 11, color: tone.kicker }}>
        <span>{game.toilet_bowl ? "TOILET BOWL" : game.label.toUpperCase()}</span>
        <span>{weeksLabel(game.weeks)}</span>
      </div>
      {sides.map((side, i) => {
        const won = game.winner !== null && game.winner === side.team;
        const lost = game.winner !== null && side.team !== null && game.winner !== side.team;
        const team = side.team !== null ? teams[side.team] : null;
        const content = (
          <>
            <span className="font-mono text-[#9aa3b2]" style={{ width: 26, fontSize: 12 }}>
              {side.seed ? `#${side.seed}` : ""}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className="font-display leading-tight"
                style={{ fontSize: compact ? 16 : 20, fontWeight: 600, color: side.team === me ? "#ffffff" : "#eceef1" }}
              >
                {team ? team.name : sourceLabel(side.from, all)}
              </span>
              {!compact && (
                <span className="truncate text-xs text-[#9aa3b2]">
                  {team ? `${team.team_name}${records[team.team_id] ? ` · ${records[team.team_id]}` : ""}` : "to be decided"}
                </span>
              )}
            </span>
            {side.score !== null && game.decided === "real" ? (
              <span className="font-mono font-bold" style={{ fontSize: compact ? 14 : 18 }}>
                {side.score.toFixed(2)}
              </span>
            ) : (
              won && <span className="font-mono text-[10px] text-[#39ff14]">{DECIDED_TAG[game.decided]}</span>
            )}
          </>
        );
        const rowStyle = { opacity: lost ? 0.42 : 1 };
        return onPick && side.team !== null ? (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(side.team!);
            }}
            aria-label={`Pick ${team?.name} to win ${game.label}`}
            className="flex min-h-11 items-center gap-2.5 rounded-lg text-left hover:bg-white/5"
            style={rowStyle}
          >
            {content}
          </button>
        ) : (
          <div key={i} className="flex items-center gap-2.5" style={rowStyle}>
            {content}
          </div>
        );
      })}
      {!compact && (
        <div className="border-t border-white/10 pt-2 text-xs" style={{ color: tone.foot }}>
          {routeLabel(game, all, punishment)}
        </div>
      )}
    </Outer>
  );
}

function sourceLabel(src: BracketGame["sources"][number], all: BracketGame[]): string {
  if (src.kind === "seed") return `#${src.seed} seed`;
  const g = all.find((x) => x.code === src.code);
  return `${src.kind === "winner" ? "Winner" : "Loser"} ${g ? shortName(g) : src.code}`;
}
