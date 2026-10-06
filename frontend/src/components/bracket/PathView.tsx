"use client";

import type { BracketGame, PlayoffWorld, World, WorldTeam } from "@/lib/bracketEngine";
import { ordinal, pathFor } from "@/lib/bracketEngine";
import { TONES, toneFor, weeksLabel } from "@/components/bracket/GameTile";

// Your Path (mockup B, the Tower): winners ride up, everyone else goes
// down. The penthouse is the title game; the basement is the Toilet
// Bowl. Pick a team and the elevator rides to the floor where they
// finish, with every game on the way.

type Floor = { code: string; name: string; color: string; slab: string; edge: string; games: BracketGame[]; lobby?: boolean };

function floorsFor(games: BracketGame[], playoffCount: number): Floor[] {
  const winners = games.filter((g) => g.bracket === "winners");
  const maxRound = Math.max(...winners.map((g) => g.round));
  const floors: Floor[] = [];
  for (let r = maxRound; r >= 1; r--) {
    const here = winners.filter((g) => g.round === r);
    const top = r === maxRound;
    floors.push({
      code: top ? "PH" : String(r + 1),
      name: top ? "PENTHOUSE" : here.some((g) => g.code.startsWith("SF")) ? "SEMIFINALS" : `ROUND ${r}`,
      color: top ? "#f5c542" : "#39ff14",
      slab: top ? "linear-gradient(180deg,#2b2510,#17140b)" : "linear-gradient(180deg,#16231b,#10161a)",
      edge: top ? "#f5c542" : "#39ff14",
      games: here,
    });
  }
  floors.push({ code: "G", name: `LOBBY · TOP ${playoffCount} GO UP`, color: "#eceef1", slab: "linear-gradient(180deg,#151a20,#111419)", edge: "#2b3340", games: [], lobby: true });
  const cons = games.filter((g) => g.bracket === "consolation");
  const rounds = [...new Set(cons.map((g) => g.round))].sort();
  rounds.forEach((r, i) => {
    const here = cons.filter((g) => g.round === r && !g.toilet_bowl);
    if (here.length)
      floors.push({
        code: `B${i + 1}`,
        name: i === 0 ? "CONSOLATION" : "PLACEMENT",
        color: "#9aa3b2",
        slab: "linear-gradient(180deg,#161b22,#12161c)",
        edge: "#2b3340",
        games: here,
      });
  });
  const bowl = cons.filter((g) => g.toilet_bowl);
  if (bowl.length)
    floors.push({ code: `B${rounds.length + 1}`, name: "THE BOWL", color: "#d9a066", slab: "linear-gradient(180deg,#2a1d12,#140e09)", edge: "#a8743c", games: bowl });
  return floors;
}

export function PathView({
  world,
  w,
  teams,
  records,
  team,
  onTeam,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  team: number;
  onTeam: (teamId: number) => void;
}) {
  const floors = floorsFor(w.games, world.playoff_team_count);
  const path = pathFor(w, team);
  const finalGame = path.games[path.games.length - 1];
  const carIndex = Math.max(0, floors.findIndex((f) => finalGame && f.games.some((g) => g.code === finalGame.code)));
  const seed = w.standings.find((r) => r.team_id === team)?.seed;
  const place = path.place;
  const headlineColor = place === 1 ? "#f5c542" : finalGame?.toilet_bowl ? "#d9a066" : seed && seed <= world.playoff_team_count ? "#39ff14" : "#eceef1";

  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-white/10 p-4 text-[#eceef1] md:flex-row md:p-6" style={{ background: "linear-gradient(180deg,#1a1608 0%,#0d1016 30%,#0d1016 70%,#1a120b 100%)" }}>
      <div className="flex min-w-0 flex-1 gap-3 md:gap-4">
        <div className="relative w-12 shrink-0" aria-hidden>
          <div className="absolute top-0 bottom-0 left-[20px] w-2 rounded" style={{ background: "linear-gradient(180deg,#f5c542,#39ff14 40%,#2b3340 55%,#a8743c)" }} />
          <div
            className="font-display absolute left-[2px] flex h-11 w-11 items-center justify-center rounded-xl bg-[#eceef1] text-sm font-bold text-[#0d1016]"
            style={{
              top: `calc(${(carIndex / Math.max(1, floors.length - 1)) * 100}% - ${(carIndex / Math.max(1, floors.length - 1)) * 44}px)`,
              boxShadow: "0 0 24px rgba(255,255,255,0.5)",
              transition: "top 700ms cubic-bezier(.2,.8,.2,1)",
            }}
          >
            {floors[carIndex]?.code}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {floors.map((f) => (
            <div key={f.code} className="flex items-center gap-3">
              <div className="flex w-24 shrink-0 flex-col">
                <span className="font-display text-2xl leading-none font-bold" style={{ color: f.color }}>
                  {f.code}
                </span>
                <span className="font-mono text-[10px] tracking-wider text-[#9aa3b2]">{f.name}</span>
                {f.games[0] && <span className="font-mono text-[10px] text-[#7f8a99]">{weeksLabel(f.games[0].weeks)}</span>}
              </div>
              <div
                className="flex min-w-0 flex-1 flex-wrap gap-2 rounded-2xl border p-3"
                style={{ background: f.slab, borderColor: f.edge, boxShadow: "0 10px 22px rgba(0,0,0,0.45)" }}
              >
                {f.lobby ? (
                  <div className="flex w-full justify-between font-mono text-xs tracking-wider text-[#39ff14]">
                    <span>▲ SEEDS 1–{world.playoff_team_count} RIDE UP</span>
                    <span>SEEDS {world.playoff_team_count + 1}+ GO DOWN ▼</span>
                  </div>
                ) : (
                  f.games.map((g) => {
                    const mine = g.a === team || g.b === team;
                    return (
                      <div
                        key={g.code}
                        className="flex min-w-[130px] flex-1 flex-col gap-1 rounded-xl p-2"
                        style={{ background: mine ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.25)", border: mine ? "2px solid #fff" : "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <span className="font-mono text-[10px] tracking-wider" style={{ color: TONES[toneFor(g)].kicker }}>
                          {g.toilet_bowl ? "TOILET BOWL" : g.label.toUpperCase()}
                        </span>
                        {[g.a, g.b].map((t, i) => (
                          <span key={i} className="flex items-baseline gap-2" style={{ opacity: g.loser === t && t !== null ? 0.45 : 1 }}>
                            <span className="w-6 font-mono text-[11px] text-[#9aa3b2]">{(i === 0 ? g.seedA : g.seedB) ? `#${i === 0 ? g.seedA : g.seedB}` : ""}</span>
                            <span className="font-display text-base" style={{ color: t === team ? "#fff" : "#eceef1" }}>
                              {t !== null ? teams[t].name : "TBD"}
                            </span>
                          </span>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 md:w-80">
        <div className="font-display text-2xl tracking-wide">RIDE THE ELEVATOR</div>
        <p className="text-sm text-[#9aa3b2]">Pick a team to see every game on its way to where it finishes in this world.</p>
        <div className="grid grid-cols-3 gap-2">
          {w.standings.map((r) => (
            <button
              key={r.team_id}
              type="button"
              onClick={() => onTeam(r.team_id)}
              className="font-display h-11 truncate rounded-xl border px-2 text-sm"
              style={{
                borderColor: r.team_id === team ? "#fff" : "#2b3340",
                background: r.team_id === team ? "#eceef1" : "#12161c",
                color: r.team_id === team ? "#0d1016" : "#eceef1",
              }}
            >
              {r.seed}. {teams[r.team_id].name}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-[#1c2027] bg-[#12161c] p-4">
          <div className="font-display text-3xl leading-none" style={{ color: headlineColor }}>
            #{seed} {teams[team].name}: {place === 1 ? "Champion" : place ? ordinal(place) : "TBD"}
          </div>
          <div className="text-xs text-[#9aa3b2]">{records[team]} in this world</div>
          {path.games.map((g) => {
            const opp = g.a === team ? g.b : g.a;
            const f = floors.find((fl) => fl.games.some((x) => x.code === g.code));
            const result = g.winner === null ? "TBD" : g.winner === team ? (g.decided === "real" ? "won" : "favored to win") : g.decided === "real" ? "lost" : "underdog";
            return (
              <div key={g.code} className="flex gap-3 text-sm">
                <span className="w-8 font-mono text-xs" style={{ color: f?.color }}>
                  {f?.code}
                </span>
                <span className="flex-1 text-[#c9cfd8]">
                  {g.toilet_bowl ? "Toilet Bowl" : g.label} vs {opp !== null ? `#${g.a === team ? g.seedB : g.seedA} ${teams[opp].name}` : "TBD"} — {result}
                </span>
              </div>
            );
          })}
          {finalGame?.toilet_bowl && finalGame.loser === team && (
            <div className="text-sm text-[#d9a066]">Toilet Bowl punishment: {world.toilet_bowl_punishment}</div>
          )}
        </div>
      </div>
    </div>
  );
}
