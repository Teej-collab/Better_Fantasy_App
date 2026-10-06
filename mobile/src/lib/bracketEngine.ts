// The playoff bracket and What-If engine — the same code as the web's
// frontend/src/lib/bracketEngine.ts; keep the two in step.
//
// GET /seasons/{season}/playoffs/world (backend/app/domain/playoffs.py
// get_playoff_world) hands over the teams, every regular-season game and
// the bracket spec (every game's code, where its two teams come from and
// what places it decides). Everything else is computed here, on the
// device, so flipping a result reseeds the whole bracket instantly:
// standings (wins, ties as half, then points for — the backend's
// get_standings order), seeds, every playoff game, and final places down
// to the Toilet Bowl.
//
// A scenario is the user's what-ifs: regular-season results flipped,
// unplayed games picked, and playoff games picked. Anything not picked
// goes to the favorite (higher points per game in real games so far).

export type WorldTeam = { team_id: number; team_name: string; owner_id: number; logo_url: string | null; name: string };
export type WorldGame = {
  id: number;
  week: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  played: boolean;
};
export type Source = { kind: 'seed'; seed: number } | { kind: 'winner' | 'loser'; code: string };
export type SpecGame = {
  code: string;
  bracket: 'winners' | 'consolation';
  round: number;
  slot: number;
  label: string;
  sources: [Source, Source];
  places: [number, number] | null;
  weeks: number[];
  toilet_bowl: boolean;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a_seed: number | null;
  team_b_seed: number | null;
  score_a: number | null;
  score_b: number | null;
  winner_team_id: number | null;
};
export type PlayoffWorld = {
  season: number;
  status: 'projected' | 'live';
  playoff_team_count: number;
  weeks_per_matchup: number;
  start_week: number;
  regular_season_last_week: number | null;
  toilet_bowl_punishment: string;
  teams: WorldTeam[];
  schedule: WorldGame[];
  games: SpecGame[];
};

export type Scenario = {
  /** Regular-season games (by matchup id) whose real result is flipped. */
  flips: number[];
  /** Unplayed regular-season games: matchup id -> winning team id. */
  picks: Record<number, number>;
  /** Playoff games: game code -> winning team id. */
  playoff: Record<string, number>;
};
export const EMPTY_SCENARIO: Scenario = { flips: [], picks: {}, playoff: {} };

export type StandingRow = { team_id: number; wins: number; losses: number; ties: number; points_for: number; ppg: number; seed: number };
export type Decided = 'real' | 'pick' | 'favorite' | 'pending';
export type BracketGame = SpecGame & {
  a: number | null;
  b: number | null;
  seedA: number | null;
  seedB: number | null;
  winner: number | null;
  loser: number | null;
  decided: Decided;
};
export type World = {
  standings: StandingRow[];
  /** matchup id -> winning team id (null for a real tie). */
  results: Record<number, number | null>;
  games: BracketGame[];
  places: Record<number, number>;
};

export function isEmpty(s: Scenario): boolean {
  return s.flips.length === 0 && Object.keys(s.picks).length === 0 && Object.keys(s.playoff).length === 0;
}

export function changeCount(s: Scenario): number {
  return s.flips.length + Object.keys(s.picks).length + Object.keys(s.playoff).length;
}

/** Points per game from real, played games — who's 'favored'. */
export function realPpg(world: PlayoffWorld): Record<number, number> {
  const pf: Record<number, number> = {};
  const gp: Record<number, number> = {};
  for (const t of world.teams) {
    pf[t.team_id] = 0;
    gp[t.team_id] = 0;
  }
  for (const g of world.schedule) {
    if (!g.played) continue;
    pf[g.home_team_id] += g.home_score;
    pf[g.away_team_id] += g.away_score;
    gp[g.home_team_id] += 1;
    gp[g.away_team_id] += 1;
  }
  const out: Record<number, number> = {};
  for (const t of world.teams) out[t.team_id] = gp[t.team_id] ? pf[t.team_id] / gp[t.team_id] : 0;
  return out;
}

function favorite(a: number, b: number, ppg: Record<number, number>): number {
  return (ppg[a] ?? 0) >= (ppg[b] ?? 0) ? a : b;
}

/** The whole season and bracket in one world — reality when the
 *  scenario is empty, a what-if otherwise. */
export function buildWorld(world: PlayoffWorld, scenario: Scenario = EMPTY_SCENARIO): World {
  const ppg = realPpg(world);
  const flips = new Set(scenario.flips);
  const results: Record<number, number | null> = {};
  const rows: Record<number, Omit<StandingRow, 'seed'>> = {};
  for (const t of world.teams) rows[t.team_id] = { team_id: t.team_id, wins: 0, losses: 0, ties: 0, points_for: 0, ppg: ppg[t.team_id] };

  for (const g of world.schedule) {
    const h = g.home_team_id;
    const a = g.away_team_id;
    let winner: number | null;
    if (g.played) {
      rows[h].points_for += g.home_score;
      rows[a].points_for += g.away_score;
      winner = g.home_score > g.away_score ? h : g.away_score > g.home_score ? a : null;
      if (flips.has(g.id)) winner = winner === h ? a : h;
    } else {
      const pick = scenario.picks[g.id];
      winner = pick === h || pick === a ? pick : favorite(h, a, ppg);
    }
    results[g.id] = winner;
    if (winner === null) {
      rows[h].ties += 1;
      rows[a].ties += 1;
    } else {
      rows[winner].wins += 1;
      rows[winner === h ? a : h].losses += 1;
    }
  }

  const standings = Object.values(rows)
    .sort((x, y) => y.wins + 0.5 * y.ties - (x.wins + 0.5 * x.ties) || y.points_for - x.points_for)
    .map((r, i) => ({ ...r, seed: i + 1 }));
  const seedOf: Record<number, number> = {};
  for (const r of standings) seedOf[r.team_id] = r.seed;

  // Once the real bracket exists and the regular season hasn't been
  // changed, its real seeds and results stand.
  const useReal = world.status === 'live' && scenario.flips.length === 0 && Object.keys(scenario.picks).length === 0;
  const done: Record<string, BracketGame> = {};
  const games: BracketGame[] = [];
  const places: Record<number, number> = {};
  const fromSource = (src: Source): number | null => {
    if (src.kind === 'seed') return standings[src.seed - 1]?.team_id ?? null;
    const g = done[src.code];
    return g ? (src.kind === 'winner' ? g.winner : g.loser) : null;
  };
  for (const spec of world.games) {
    let a = fromSource(spec.sources[0]);
    let b = fromSource(spec.sources[1]);
    let seedA = a !== null ? seedOf[a] : null;
    let seedB = b !== null ? seedOf[b] : null;
    if (useReal && spec.team_a_id !== null && spec.team_b_id !== null) {
      a = spec.team_a_id;
      b = spec.team_b_id;
      seedA = spec.team_a_seed;
      seedB = spec.team_b_seed;
    }
    let winner: number | null = null;
    let decided: Decided = 'pending';
    if (a !== null && b !== null) {
      const pick = scenario.playoff[spec.code];
      const realWinner = useReal || (spec.team_a_id === a && spec.team_b_id === b) ? spec.winner_team_id : null;
      if (pick === a || pick === b) {
        winner = pick;
        decided = 'pick';
      } else if (realWinner === a || realWinner === b) {
        winner = realWinner;
        decided = 'real';
      } else {
        winner = favorite(a, b, ppg);
        decided = 'favorite';
      }
    }
    const loser = winner === null ? null : winner === a ? b : a;
    const game: BracketGame = { ...spec, a, b, seedA, seedB, winner, loser, decided };
    done[spec.code] = game;
    games.push(game);
    if (spec.places && winner !== null && loser !== null) {
      places[winner] = spec.places[0];
      places[loser] = spec.places[1];
    }
  }
  return { standings, results, games, places };
}

/** The games a team plays in the bracket, in order, and where it ends up. */
export function pathFor(w: World, teamId: number): { games: BracketGame[]; place: number | null } {
  return { games: w.games.filter((g) => g.a === teamId || g.b === teamId), place: w.places[teamId] ?? null };
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export function recordOf(r: Pick<StandingRow, 'wins' | 'losses' | 'ties'>): string {
  return `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
}

// Share links: the scenario rides in the URL (?w=...), so a what-if
// world opens exactly as its author built it — no server state needed.
// Format: f.<id>,<id>~p.<id>:<team>,...~x.<code>:<team>,...~me.<team>
export function encodeScenario(s: Scenario, me?: number | null): string {
  const parts: string[] = [];
  if (s.flips.length) parts.push(`f.${s.flips.join(',')}`);
  const picks = Object.entries(s.picks);
  if (picks.length) parts.push(`p.${picks.map(([g, t]) => `${g}:${t}`).join(',')}`);
  const playoff = Object.entries(s.playoff);
  if (playoff.length) parts.push(`x.${playoff.map(([c, t]) => `${c}:${t}`).join(',')}`);
  if (me) parts.push(`me.${me}`);
  return parts.join('~');
}

export function decodeScenario(raw: string | null | undefined): { scenario: Scenario; me: number | null } {
  const scenario: Scenario = { flips: [], picks: {}, playoff: {} };
  let me: number | null = null;
  for (const part of (raw ?? '').split('~')) {
    const dot = part.indexOf('.');
    if (dot < 0) continue;
    const key = part.slice(0, dot);
    const body = part.slice(dot + 1);
    if (key === 'f') scenario.flips = body.split(',').map(Number).filter(Number.isFinite);
    if (key === 'me' && Number.isFinite(Number(body))) me = Number(body);
    if (key === 'p' || key === 'x') {
      for (const pair of body.split(',')) {
        const [k, v] = pair.split(':');
        const team = Number(v);
        if (!k || !Number.isFinite(team)) continue;
        if (key === 'p' && Number.isFinite(Number(k))) scenario.picks[Number(k)] = team;
        if (key === 'x' && /^[A-Z0-9-]+$/.test(k)) scenario.playoff[k] = team;
      }
    }
  }
  return { scenario, me };
}

/** One line for a share message: where `me` ends up in this world. */
export function scenarioHeadline(world: PlayoffWorld, w: World, me: number): string {
  const name = world.teams.find((t) => t.team_id === me)?.name ?? 'This team';
  const row = w.standings.find((r) => r.team_id === me);
  const place = w.places[me];
  const finish = place === 1 ? 'wins the title' : place ? `finishes ${ordinal(place)}` : '';
  return `${name} goes ${row ? recordOf(row) : ''}${row ? `, the #${row.seed} seed` : ''}${finish ? `, and ${finish}` : ''}`;
}
