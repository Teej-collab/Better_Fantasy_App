"use client";

import { useEffect, useRef, useState } from "react";
import type { BracketGame, PlayoffWorld, World, WorldTeam } from "@/lib/bracketEngine";
import { GameTile, TONES, routeLabel, toneFor, weeksLabel } from "@/components/bracket/GameTile";

// The bracket, laid out as a bracket (2026-10, after the ESPN reference):
// Round 1 (weeks 14-15) on the left, Round 2 (weeks 16-17) on the right.
// The winners' bracket draws its lines from the two semis into the title
// game, with the 3rd-place game under it; the consolation ladder lines
// each first-round game up with a second-round game, the cards' own
// footers saying where winners and losers go (GmC1: W → GmC5, L → GmC6).
// Narrow screens get the two rounds as swipeable pages. The cards are the
// same GameTiles everywhere; the What-If Lab reuses this (BracketBoard)
// with picking turned on.

type Pick = (code: string, teamId: number) => void;
type LayoutProps = {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
  selected?: string;
  onSelect?: (code: string) => void;
  onPick?: Pick;
};

const NARROW = 720;

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
  const [selected, setSelected] = useState<string>("F");
  const sel = w.games.find((g) => g.code === selected) ?? w.games[0];
  return (
    <div className="flex flex-col gap-3">
      <BracketLayout world={world} w={w} teams={teams} records={records} me={me} selected={selected} onSelect={setSelected} />
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
    </div>
  );
}

/** The bracket on its own, for the What-If Lab: tap a team to pick them. */
export function BracketBoard(props: Omit<LayoutProps, "selected" | "onSelect"> & { onPick: Pick }) {
  return <BracketLayout {...props} />;
}

function nameFor(team: number | null, seed: number | null, teams: Record<number, WorldTeam>): string {
  if (team === null) return "TBD";
  return `${seed ? `#${seed} ` : ""}${teams[team].name}`;
}

function BracketLayout(props: LayoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const byCode = Object.fromEntries(props.w.games.map((g) => [g.code, g]));
  const standard = ["SF1", "SF2", "F", "3RD"].every((c) => byCode[c]);
  return (
    <div ref={ref} className="w-full">
      {!standard ? (
        <ByRound {...props} />
      ) : width > 0 && width < NARROW ? (
        <RoundPager {...props} byCode={byCode} />
      ) : (
        <BracketGrid {...props} byCode={byCode} />
      )}
    </div>
  );
}

function Tile({ code, byCode, ...p }: LayoutProps & { code: string; byCode: Record<string, BracketGame>; className?: string }) {
  const g = byCode[code];
  if (!g) return null;
  return (
    <GameTile
      game={g}
      all={p.w.games}
      teams={p.teams}
      records={p.records}
      punishment={p.world.toilet_bowl_punishment}
      me={p.me}
      selected={p.selected === code}
      onSelect={p.onSelect && !p.onPick ? () => p.onSelect!(code) : undefined}
      onPick={p.onPick ? (t) => p.onPick!(code, t) : undefined}
      style={{ height: "100%", boxSizing: "border-box" }}
    />
  );
}

function roundWeeks(games: BracketGame[], round: number): string {
  const g = games.find((x) => x.round === round);
  return g ? weeksLabel(g.weeks).replace("WK", "NFL WEEK").replace("–", "–NFL WEEK ") : "";
}

const COLS = "grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)]";

/** Wide screens: two columns, Round 1 → Round 2. */
function BracketGrid(p: LayoutProps & { byCode: Record<string, BracketGame> }) {
  const consolation = ["C1", "C2", "C3", "C4"].filter((c) => p.byCode[c]);
  const ladder: Record<string, string> = { C1: "C5", C2: "C6", C3: "C7", C4: "C8" };
  return (
    <div className="flex flex-col gap-8 rounded-3xl border border-white/10 bg-[#0d1016] p-5 text-[#eceef1]">
      <section className="flex flex-col gap-4">
        <SectionTitle title="WINNER'S BRACKET" color="#39ff14" />
        <RoundHeaders games={p.w.games} rightLabel="CHAMPIONSHIP" />
        <div className={`${COLS} auto-rows-fr gap-y-4`}>
          <div className="col-start-1 row-start-1">
            <Tile {...p} code="SF1" />
          </div>
          <div className="col-start-1 row-start-2">
            <Tile {...p} code="SF2" />
          </div>
          {/* The bracket's lines: each semi into the title game. */}
          <div className="relative col-start-2 row-span-2 row-start-1" aria-hidden>
            <div className="absolute top-1/4 bottom-1/4 left-0 w-1/2 rounded-r-lg border-y-2 border-r-2 border-[#39ff14]/70" />
            <div className="absolute top-1/2 right-0 left-1/2 border-t-2 border-[#f5c542]/80" />
          </div>
          <div className="col-start-3 row-span-2 row-start-1 flex items-center">
            <div className="w-full">
              <Tile {...p} code="F" />
            </div>
          </div>
        </div>
        <div className={`${COLS} items-center`}>
          <p className="col-start-1 text-right text-xs text-[#9aa3b2]">The two semifinal losers play for 3rd</p>
          <div className="col-start-2 border-t-2 border-dashed border-[#9aa3b2]/60" aria-hidden />
          <div className="col-start-3">
            <Tile {...p} code="3RD" />
          </div>
        </div>
      </section>

      {consolation.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="h-0.5 bg-[#39ff14] shadow-[0_0_14px_#39ff14]" aria-hidden />
          <SectionTitle title="CONSOLATION LADDER" color="#9aa3b2" note="Every spot is played for — down to the Toilet Bowl" />
          <RoundHeaders games={p.w.games.filter((g) => g.bracket === "consolation")} rightLabel="ROUND 2" />
          <div className={`${COLS} auto-rows-fr gap-y-4`}>
            {consolation.map((code) => (
              <div key={code} className="contents">
                <div className="col-start-1">
                  <Tile {...p} code={code} />
                </div>
                <div className="col-start-2 flex items-center" aria-hidden>
                  <div className="w-full border-t-2 border-[#2b3340]" />
                </div>
                <div className="col-start-3">
                  <Tile {...p} code={ladder[code]} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ title, color, note }: { title: string; color: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h2 className="font-display text-2xl tracking-wide" style={{ color }}>
        {title}
      </h2>
      {note && <span className="text-xs text-[#9aa3b2]">{note}</span>}
    </div>
  );
}

function RoundHeaders({ games, rightLabel }: { games: BracketGame[]; rightLabel: string }) {
  return (
    <div className={`${COLS} border-b-2 border-white/25 pb-2 font-mono text-[11px] tracking-[0.15em] text-[#9aa3b2]`}>
      <span className="col-start-1">ROUND 1 | {roundWeeks(games, 1)}</span>
      <span className="col-start-3">
        {rightLabel} | {roundWeeks(games, 2)}
      </span>
    </div>
  );
}

/** Phones: Round 1 on one page, Round 2 on the next — swipe between. */
function RoundPager(p: LayoutProps & { byCode: Record<string, BracketGame> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pages = [
    { title: "ROUND 1", round: 1, winners: ["SF1", "SF2"], ladder: ["C1", "C2", "C3", "C4"] },
    { title: "ROUND 2", round: 2, winners: ["F", "3RD"], ladder: ["C5", "C6", "C7", "C8"] },
  ];
  const go = (i: number) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Rounds" className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#12161c] p-1">
        {pages.map((pg, i) => (
          <button
            key={pg.title}
            type="button"
            role="tab"
            aria-selected={page === i}
            onClick={() => go(i)}
            className="font-display h-10 rounded-lg text-sm tracking-wide"
            style={{ background: page === i ? "#eceef1" : "transparent", color: page === i ? "#0d1016" : "#9aa3b2" }}
          >
            {pg.title} · {roundWeeks(p.w.games, pg.round).replace(/NFL WEEK /g, "WK ")}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (next !== page) setPage(next);
        }}
        className="flex snap-x snap-mandatory overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {pages.map((pg) => (
          <div key={pg.title} className="flex w-full shrink-0 snap-start flex-col gap-3 px-0.5">
            <SectionTitle title={pg.round === 2 ? "CHAMPIONSHIP & 3RD" : "WINNER'S BRACKET"} color="#39ff14" />
            {pg.winners.map((c) => (
              <Tile key={c} {...p} code={c} />
            ))}
            {pg.ladder.some((c) => p.byCode[c]) && (
              <>
                <div className="my-1 h-0.5 bg-[#39ff14] shadow-[0_0_10px_#39ff14]" aria-hidden />
                <SectionTitle title="CONSOLATION LADDER" color="#9aa3b2" />
                {pg.ladder.map((c) => (
                  <Tile key={c} {...p} code={c} />
                ))}
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-[#7f8a99]">Swipe for {page === 0 ? "Round 2" : "Round 1"}</p>
    </div>
  );
}

/** Any other bracket shape: each bracket's rounds in order. */
function ByRound(p: LayoutProps) {
  const byCode = Object.fromEntries(p.w.games.map((g) => [g.code, g]));
  const groups: [string, BracketGame[]][] = [
    ["Winner's bracket", p.w.games.filter((g) => g.bracket === "winners")],
    ["Consolation ladder", p.w.games.filter((g) => g.bracket === "consolation")],
  ];
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-[#0d1016] p-3">
      {groups
        .filter(([, games]) => games.length)
        .map(([title, games]) => (
          <section key={title} className="flex flex-col gap-2">
            <h2 className="font-display px-1 text-lg tracking-wide text-[#eceef1]">{title.toUpperCase()}</h2>
            {games.map((g) => (
              <Tile key={g.code} {...p} code={g.code} byCode={byCode} />
            ))}
          </section>
        ))}
    </div>
  );
}
