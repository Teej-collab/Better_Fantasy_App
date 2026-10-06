"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_SCENARIO,
  buildWorld,
  changeCount,
  decodeScenario,
  encodeScenario,
  isEmpty,
  recordOf,
  scenarioHeadline,
  type PlayoffWorld,
  type Scenario,
  type WorldTeam,
} from "@/lib/bracketEngine";
import type { PlayoffOdds } from "@/lib/api";
import { ArenaView } from "@/components/bracket/ArenaView";
import { PathView } from "@/components/bracket/PathView";
import { WhatIfView } from "@/components/bracket/WhatIfView";

// The Bracket (2026-10; Standings → Playoffs): one world — reality, or the what-if the
// user is building — shown three ways. The pill top-left switches
// between the Arena (the 3D bracket), Your Path (the Tower) and the
// What-If Lab. The what-if rides in the URL (?w=), so a shared link
// opens exactly the world its author built.

type Mode = "arena" | "path" | "whatif";
const MODES: { key: Mode; label: string }[] = [
  { key: "arena", label: "Bracket" },
  { key: "path", label: "Your Path" },
  { key: "whatif", label: "What-If" },
];

export function BracketExperience({
  season,
  myOwnerId,
  initialMode,
  initialW,
}: {
  season: number;
  myOwnerId: number;
  initialMode: string | undefined;
  initialW: string | undefined;
}) {
  const shared = useMemo(() => decodeScenario(initialW), [initialW]);
  const [world, setWorld] = useState<PlayoffWorld | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>(initialMode === "path" || initialMode === "whatif" ? initialMode : "arena");
  const [scenario, setScenario] = useState<Scenario>(shared.scenario);
  const [meChoice, setMeChoice] = useState<number | null>(shared.me);
  const [pathChoice, setPathChoice] = useState<number | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [odds, setOdds] = useState<{ key: string; real: PlayoffOdds | null; alt: PlayoffOdds | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/backend/seasons/${season}/playoffs/world`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { world: null }))
      .then((body: { world: PlayoffWorld | null }) => {
        if (!cancelled) setWorld(body.world);
      })
      .catch(() => {
        if (!cancelled) setWorld(null);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  // Playoff chances for whoever "me" is — reality, plus the what-if
  // world while one is being built (debounced: a flurry of taps is one
  // request). Simulated server-side (backend/app/domain/playoff_odds.py).
  const myTeamId = world ? (world.teams.find((t) => t.owner_id === myOwnerId)?.team_id ?? null) : null;
  const focusTeam = meChoice ?? myTeamId;
  const encoded = isEmpty(scenario) ? "" : encodeScenario(scenario);
  const oddsKey = `${focusTeam}|${encoded}`;
  useEffect(() => {
    if (!world || focusTeam === null) return;
    let cancelled = false;
    const get = (w: string) =>
      fetch(`/api/backend/seasons/${season}/playoffs/odds?team=${focusTeam}${w ? `&w=${encodeURIComponent(w)}` : ""}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { odds: null }))
        .then((b: { odds: PlayoffOdds | null }) => b.odds)
        .catch(() => null);
    const timer = setTimeout(async () => {
      const [real, alt] = await Promise.all([get(""), encoded ? get(encoded) : Promise.resolve(null)]);
      if (!cancelled) setOdds({ key: oddsKey, real, alt });
    }, encoded ? 450 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [world, season, focusTeam, encoded, oddsKey]);

  const base = useMemo(() => (world ? buildWorld(world) : null), [world]);
  const alt = useMemo(() => (world ? buildWorld(world, scenario) : null), [world, scenario]);

  if (world === undefined) return <div className="h-96 animate-pulse rounded-3xl bg-[#12161c]" aria-label="Loading the bracket" />;
  if (world === null || !base || !alt) {
    return (
      <p className="rounded-2xl border border-white/10 p-6 text-sm text-black/60 dark:text-white/60">
        The bracket appears once the league&apos;s playoff settings are in place (Commissioner Tools → League settings).
      </p>
    );
  }

  const teams: Record<number, WorldTeam> = {};
  for (const t of world.teams) teams[t.team_id] = t;
  const myTeam = world.teams.find((t) => t.owner_id === myOwnerId)?.team_id ?? null;
  const me = meChoice !== null && teams[meChoice] ? meChoice : (myTeam ?? world.teams[0].team_id);
  const shown = isEmpty(scenario) ? base : alt;
  const records: Record<number, string> = {};
  for (const r of shown.standings) records[r.team_id] = recordOf(r);

  function syncUrl(nextMode: Mode, nextScenario: Scenario, nextMe: number) {
    const params = new URLSearchParams(window.location.search);
    params.set("mode", nextMode);
    if (isEmpty(nextScenario)) params.delete("w");
    else params.set("w", encodeScenario(nextScenario, nextMe));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }
  const changeMode = (m: Mode) => {
    setMode(m);
    syncUrl(m, scenario, me);
  };
  const changeScenario = (s: Scenario) => {
    setScenario(s);
    setShareNote(null);
    syncUrl(mode, s, me);
  };
  const changeMe = (t: number) => {
    setMeChoice(t);
    setScenario(EMPTY_SCENARIO);
    setShareNote(null);
    syncUrl(mode, EMPTY_SCENARIO, t);
  };
  const link = () => `${window.location.origin}/standings?view=playoffs&mode=whatif&w=${encodeScenario(scenario, me)}`;
  const shareLink = async () => {
    try {
      await navigator.clipboard.writeText(link());
      setShareNote("Link copied. Anyone in the league can open this exact world.");
    } catch {
      setShareNote(link());
    }
  };
  const shareChat = async () => {
    const body = `What if… ${scenarioHeadline(world, alt, me)}. See it: ${link()}`;
    const res = await fetch("/api/backend/chat/league/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setShareNote(res.ok ? "Posted to the league chat." : "Couldn't post to the chat — try Copy link.");
  };

  const pathTeam = pathChoice !== null && teams[pathChoice] ? pathChoice : me;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Bracket views" className="flex gap-1 rounded-full border border-white/10 bg-[#12161c] p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => changeMode(m.key)}
              className="font-display h-10 rounded-full px-4 text-sm tracking-wide"
              style={{ background: mode === m.key ? "#eceef1" : "transparent", color: mode === m.key ? "#0d1016" : "#9aa3b2" }}
            >
              {m.label.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="text-sm text-black/60 dark:text-white/60">
          {world.status === "live"
            ? "Live — real results, favorites for what's left."
            : "Projected — the rest of the season and every playoff game go to the favorites."}
        </span>
      </div>

      {!isEmpty(scenario) && mode !== "whatif" && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#39ff14] bg-[rgba(57,255,20,0.06)] px-4 py-3 text-sm text-[#eceef1]">
          <span className="font-display tracking-wide text-[#39ff14]">WHAT-IF WORLD</span>
          <span className="flex-1">
            {changeCount(scenario)} change{changeCount(scenario) > 1 ? "s" : ""} from reality — {scenarioHeadline(world, alt, me)}.
          </span>
          <button type="button" onClick={() => changeMode("whatif")} className="font-display h-9 rounded-full border border-[#39ff14] px-3 text-[#39ff14]">
            EDIT
          </button>
          <button type="button" onClick={() => changeScenario(EMPTY_SCENARIO)} className="font-display h-9 rounded-full border border-white/20 px-3">
            BACK TO REALITY
          </button>
        </div>
      )}

      {mode === "arena" && <ArenaView world={world} w={shown} teams={teams} records={records} me={me} />}
      {mode === "path" && <PathView world={world} w={shown} teams={teams} records={records} team={pathTeam} onTeam={setPathChoice} />}
      {mode === "whatif" && (
        <WhatIfView
          world={world}
          base={base}
          alt={alt}
          teams={teams}
          scenario={scenario}
          onScenario={changeScenario}
          me={me}
          onMe={changeMe}
          onShareLink={shareLink}
          onShareChat={shareChat}
          shareNote={shareNote}
          // The last numbers stay up while new ones simulate (no jump).
          odds={odds && odds.key.split("|")[0] === String(focusTeam) ? odds : null}
          oddsUpdating={odds?.key !== oddsKey}
        />
      )}
    </div>
  );
}
