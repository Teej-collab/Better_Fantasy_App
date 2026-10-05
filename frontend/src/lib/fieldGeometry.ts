// The Gamecast field's 3D look and play paths — pure math, no React, so
// the native app's lib/fieldGeometry.ts is a straight copy of this file.
//
// The field is drawn in perspective, like a broadcast camera up in the
// stands: the far sideline narrower than the near one, so the field
// reads as a surface you're looking across rather than a flat strip.
// Everything is placed with project(u, v, h):
//   u — yards along the field, -10..110 (0 and 100 are the goal lines,
//       the ends are the back of each end zone). The offense always
//       drives toward u = 100, on the right.
//   v — across the field, 0 = far sideline, 1 = near sideline.
//   h — height above the turf in yards, for a ball in the air.

export const VIEW_W = 1000;
export const VIEW_H = 400;

const FAR_Y = 80;
const NEAR_Y = 340;
const FAR_HALF = 370;
const NEAR_HALF = 480;
const CENTER_X = VIEW_W / 2;

export type Pt = { x: number; y: number };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function project(u: number, v: number, h = 0): Pt {
  const half = lerp(FAR_HALF, NEAR_HALF, v);
  const pxPerYard = (2 * half) / 120;
  return {
    x: CENTER_X + ((u - 50) / 60) * half,
    // Height is foreshortened a little, the camera is above the field.
    y: lerp(FAR_Y, NEAR_Y, v) - h * pxPerYard * 0.85,
  };
}

/** A closed polygon over the turf between two yard marks. */
export function bandPoints(u0: number, u1: number, v0 = 0, v1 = 1): Pt[] {
  return [project(u0, v0), project(u1, v0), project(u1, v1), project(u0, v1)];
}

export function pointsAttr(pts: Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function pathD(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
}

/** Angle (degrees) of the end line at `u` drawn bottom→top, for the end
 *  zone's team name to sit along it. */
export function endLineAngle(u: number): number {
  const near = project(u, 1);
  const far = project(u, 0);
  return (Math.atan2(far.y - near.y, far.x - near.x) * 180) / Math.PI;
}

// ---- The last play -------------------------------------------------------

export type FieldPlay = {
  play_type: string;
  description: string;
  team_abbr: string | null;
  yard_line?: number | null;
  yards_gained: number | null;
  is_scoring_play: boolean;
  is_turnover: boolean;
  start_team_abbr?: string | null;
  end_team_abbr?: string | null;
  end_yard_line?: number | null;
};

export type PlayPath = {
  kind: "pass" | "run" | "kick" | "field_goal";
  /** Ground spot where the ball started and where it ended up. */
  fromU: number;
  toU: number;
  /** The ball's flight, sampled — each point has a turf position and a
   *  height. A run is all h = 0. */
  samples: { u: number; v: number; h: number }[];
  /** A pass that fell to the turf: the ball fades where it landed. */
  incomplete: boolean;
  label: string | null;
};

/** Field u for a spot given as yards to `team`'s goal, in a frame where
 *  `offense` drives right. */
function uFor(team: string | null | undefined, yardsToGoal: number, offense: string): number {
  return team && team !== offense ? yardsToGoal : 100 - yardsToGoal;
}

// "pass short left", "deep right", "left end", "right tackle", "up the middle"
function lateral(text: string): number {
  const t = text.toLowerCase();
  // The offense faces right, so the QB's left is the far sideline (up).
  if (/\b(left)\b/.test(t)) return 0.3;
  if (/\b(right)\b/.test(t)) return 0.7;
  return 0.5;
}

function kickYards(text: string): number | null {
  const m = text.match(/\b(?:kicks|punts) (-?\d+) yards?/i);
  return m ? Number(m[1]) : null;
}

const SAMPLES = 36;

function arc(fromU: number, fromV: number, toU: number, toV: number, peak: number) {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES;
    return { u: lerp(fromU, toU, t), v: lerp(fromV, toV, t), h: 4 * peak * t * (1 - t) };
  });
}

function ground(points: { u: number; v: number }[]) {
  // Evenly re-sampled by length, so the ball moves at a steady pace.
  const out: { u: number; v: number; h: number }[] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s];
    const b = points[s + 1];
    const n = Math.max(2, Math.round(Math.abs(b.u - a.u) / 2));
    for (let i = s === 0 ? 0 : 1; i <= n; i++) {
      const t = i / n;
      out.push({ u: lerp(a.u, b.u, t), v: lerp(a.v, b.v, t), h: 0 });
    }
  }
  return out;
}

/**
 * How to draw a play, in a frame where `offense` (the team with the
 * ball NOW) drives right. Null when there's nothing to draw — a timeout,
 * a penalty, or a play missing its spots.
 */
export function playPath(play: FieldPlay, offense: string | null): PlayPath | null {
  if (!offense || play.yard_line === null || play.yard_line === undefined) return null;
  const text = play.description || "";
  const lower = text.toLowerCase();
  const startTeam = play.start_team_abbr ?? play.team_abbr;
  const fromU = uFor(startTeam, play.yard_line, offense);
  const endTeam = play.end_team_abbr ?? startTeam;
  const toU =
    play.end_yard_line !== null && play.end_yard_line !== undefined
      ? uFor(endTeam, play.end_yard_line, offense)
      : fromU + (startTeam === offense ? 1 : -1) * (play.yards_gained ?? 0);
  if (/\bno play\b/i.test(text)) return null;
  // Which way the snapping team was going on this play.
  const dir = startTeam && startTeam !== offense ? -1 : 1;
  const side = lateral(text);

  if (play.play_type === "field_goal" || play.play_type === "extra_point" || /field goal|extra point/i.test(text)) {
    // Kicked from 7 yards behind the line, through the uprights.
    const spot = fromU - dir * 7;
    const posts = dir > 0 ? 110 : -10;
    const good = /\bis good\b/i.test(text) || /field goal good/i.test(play.play_type);
    const landU = good ? posts : posts - dir * 2;
    return {
      kind: "field_goal",
      fromU: spot,
      toU: landU,
      samples: arc(spot, 0.5, landU, 0.5, Math.max(6, Math.abs(landU - spot) * 0.28)),
      incomplete: false,
      label: good ? "It's good!" : /blocked/i.test(text) ? "Blocked" : "No good",
    };
  }

  if (play.play_type === "punt" || play.play_type === "kickoff" || /\b(punts|kicks) -?\d+ yards/i.test(text)) {
    const distance = kickYards(text);
    const kickFrom = play.play_type === "kickoff" ? fromU : fromU - dir * 12;
    const landU = distance !== null ? Math.max(-10, Math.min(110, kickFrom + dir * distance)) : toU;
    const flight = arc(kickFrom, 0.5, landU, 0.5, Math.max(10, Math.abs(landU - kickFrom) * 0.3));
    const back = Math.abs(toU - landU) > 0.5 ? ground([{ u: landU, v: 0.5 }, { u: toU, v: 0.5 }]).slice(1) : [];
    return { kind: "kick", fromU: kickFrom, toU, samples: [...flight, ...back], incomplete: false, label: null };
  }

  if (play.play_type === "pass" && !/\bsacked\b/.test(lower)) {
    const incomplete = /incomplete/.test(lower);
    const dropU = fromU - dir * 5;
    const deep = /\bdeep\b/.test(lower);
    if (incomplete) {
      const target = fromU + dir * (deep ? 22 : 9);
      return {
        kind: "pass",
        fromU: dropU,
        toU: fromU,
        samples: arc(dropU, 0.5, target, side, deep ? 9 : 4),
        incomplete: true,
        label: "Incomplete",
      };
    }
    if (/intercepted/.test(lower)) {
      const catchU = fromU + dir * (deep ? 20 : 10);
      return {
        kind: "pass",
        fromU: dropU,
        toU,
        samples: [...arc(dropU, 0.5, catchU, side, deep ? 9 : 4), ...ground([{ u: catchU, v: side }, { u: toU, v: 0.5 }]).slice(1)],
        incomplete: false,
        label: "Intercepted",
      };
    }
    return {
      kind: "pass",
      fromU: dropU,
      toU,
      samples: arc(dropU, 0.5, toU, side, Math.max(3, Math.abs(toU - dropU) * 0.18)),
      incomplete: false,
      label: play.is_scoring_play ? "Touchdown!" : null,
    };
  }

  if (Math.abs(toU - fromU) < 0.5) return null;
  // Runs, scrambles, sacks, returns: along the turf, cutting toward the
  // side the play went and back toward the middle by the end.
  return {
    kind: "run",
    fromU,
    toU,
    samples: ground([
      { u: fromU, v: 0.5 },
      { u: lerp(fromU, toU, 0.4), v: lerp(0.5, side, 0.6) },
      { u: toU, v: lerp(0.5, side, 0.4) },
    ]),
    incomplete: false,
    label: /\bsacked\b/.test(lower) ? "Sack" : play.is_scoring_play ? "Touchdown!" : null,
  };
}
