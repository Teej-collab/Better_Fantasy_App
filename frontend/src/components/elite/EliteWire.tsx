"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeagueActivityItem, LeagueActivityRosterItem, LeagueActivityTradeItem } from "@/lib/api";
import { relativeTime } from "@/lib/adminFormat";
import { ELITE, EliteCard, eliteChipClass, HEX_CLIP, StatTile } from "@/components/elite/Elite";

// The Wire (elite pass, 2026-10-31): League Activity as a neon timeline
// grouped by day, one owner's moves that day folded into one card, adds
// as green chips and drops as orange, trades split by who gets what,
// plus this week's numbers and filters. The app's twin is
// mobile/src/components/league/Sections.tsx ActivitySection.

type Filter = "all" | "trades" | "moves" | "mine";
type Card = { kind: "trade"; item: LeagueActivityTradeItem } | { kind: "roster"; items: LeagueActivityRosterItem[] };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_TAG: Record<LeagueActivityRosterItem["source"], string | null> = { free_agent: null, waiver: "WAIVER CLAIM", commissioner: "COMMISSIONER" };

function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(d)) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function involves(item: LeagueActivityItem, ownerId: number | null): boolean {
  if (ownerId === null) return false;
  return item.kind === "roster" ? item.owner_id === ownerId : item.proposing_owner_id === ownerId || item.receiving_owner_id === ownerId;
}

export function EliteWire({ items, myOwnerId, ownerByTeam }: { items: LeagueActivityItem[]; myOwnerId: number | null; ownerByTeam: Record<number, number> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [now] = useState(() => Date.now());

  const recent = items.filter((i) => new Date(i.timestamp).getTime() >= now - WEEK_MS);
  const busy = new Map<string, number>();
  for (const i of recent) {
    for (const name of i.kind === "roster" ? [i.owner_name] : [i.proposing_owner_name, i.receiving_owner_name]) busy.set(name, (busy.get(name) ?? 0) + 1);
  }
  const busiest = [...busy.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  const shown = items.filter((i) =>
    filter === "trades" ? i.kind === "trade" : filter === "moves" ? i.kind === "roster" : filter === "mine" ? involves(i, myOwnerId) : true
  );
  const days: { label: string; cards: Card[] }[] = [];
  for (const item of shown) {
    const label = dayLabel(item.timestamp, now);
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { label, cards: [] };
      days.push(day);
    }
    if (item.kind === "trade") {
      day.cards.push({ kind: "trade", item });
      continue;
    }
    const same = day.cards.find((c): c is Extract<Card, { kind: "roster" }> => c.kind === "roster" && c.items[0].owner_id === item.owner_id);
    if (same) same.items.push(item);
    else day.cards.push({ kind: "roster", items: [item] });
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "trades", label: "Trades" },
    { key: "moves", label: "Adds & drops" },
    ...(myOwnerId !== null ? [{ key: "mine" as const, label: "Mine" }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <StatTile value={String(recent.length)} caption="moves this week" color={ELITE.green} />
        <StatTile value={String(recent.filter((i) => i.kind === "trade").length)} caption="trades" color={ELITE.peach} />
        <StatTile value={busiest ? busiest[0] : "—"} caption={busiest ? `busiest · ${busiest[1]}` : "busiest"} />
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={eliteChipClass(filter === f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">Nothing here yet.</p>
      ) : (
        <div className="relative flex flex-col gap-3">
          <span aria-hidden className="absolute top-0 bottom-0 left-[9px] w-0.5" style={{ background: "linear-gradient(180deg, #39ff14, rgba(57,255,20,.15))" }} />
          {days.map((day) => (
            <section key={day.label} className="flex flex-col gap-2.5">
              <h3 className="pl-8 text-[11px] font-extrabold tracking-[2px] text-black/55 dark:text-white/60">{day.label}</h3>
              {day.cards.map((card, i) => {
                const mine = card.kind === "trade" ? involves(card.item, myOwnerId) : card.items[0].owner_id === myOwnerId;
                const lit = mine || card.kind === "trade";
                return (
                  <div key={i} className="relative pl-8">
                    <i
                      aria-hidden
                      className="absolute top-4 left-[2px] h-[18px] w-4"
                      style={{ clipPath: HEX_CLIP, background: lit ? ELITE.orange : ELITE.green, boxShadow: `0 0 8px ${lit ? ELITE.orange : ELITE.green}` }}
                    />
                    {card.kind === "trade" ? <TradeCard item={card.item} ownerByTeam={ownerByTeam} /> : <MovesCard items={card.items} mine={mine} />}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ name, added, plain }: { name: string; added?: boolean; plain?: boolean }) {
  return (
    <span
      className="inline-flex min-h-[30px] items-center rounded-[10px] px-2.5 text-[13px] font-semibold"
      style={added ? { background: "rgba(57,255,20,.12)", color: ELITE.mint } : { background: "rgba(255,122,26,.12)", color: ELITE.peach }}
    >
      {plain ? "" : added ? "+ " : "− "}
      {name}
    </span>
  );
}

function MovesCard({ items, mine }: { items: LeagueActivityRosterItem[]; mine: boolean }) {
  const first = items[0];
  const tags = Array.from(new Set(items.map((i) => SOURCE_TAG[i.source]).filter(Boolean)));
  return (
    <EliteCard className="flex flex-col gap-2 rounded-[18px] px-3.5 py-3" style={mine ? { borderColor: "rgba(255,122,26,.4)" } : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0">
          <Link href={`/owners/${first.owner_id}`} className="font-bold hover:underline">
            {first.owner_name}
          </Link>{" "}
          <span className="text-xs" style={{ color: ELITE.soft }}>
            · {first.team_name}
            {mine ? " · you" : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs whitespace-nowrap" style={{ color: ELITE.faint }}>
          {relativeTime(first.timestamp)}
          {items.length > 1 ? ` · ${items.length} moves` : ""}
        </span>
      </div>
      {tags.length > 0 && (
        <span className="text-[10px] font-extrabold tracking-wider" style={{ color: ELITE.faint }}>
          {tags.join(" · ")}
        </span>
      )}
      {items.map((i, n) => (
        <div key={n} className="flex flex-wrap gap-1.5">
          {i.added_player_name && <Chip added name={i.added_player_name} />}
          {i.dropped_player_name && <Chip name={i.dropped_player_name} />}
        </div>
      ))}
    </EliteCard>
  );
}

function TradeCard({ item, ownerByTeam }: { item: LeagueActivityTradeItem; ownerByTeam: Record<number, number> }) {
  const sides = [
    { id: item.proposing_owner_id, name: item.proposing_owner_name },
    { id: item.receiving_owner_id, name: item.receiving_owner_name },
  ];
  const known = item.assets.every((a) => ownerByTeam[a.to_team_id] !== undefined);
  return (
    <EliteCard
      className="flex flex-col gap-2 rounded-[18px] px-3.5 py-3"
      style={{ borderColor: "rgba(255,122,26,.5)", background: "linear-gradient(180deg, rgba(255,122,26,.10), transparent 70%), #141a22" }}
    >
      <div className="flex justify-between gap-2">
        <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
          TRADE
        </span>
        <span className="text-xs" style={{ color: ELITE.faint }}>
          {relativeTime(item.timestamp)}
        </span>
      </div>
      {known ? (
        <div className="grid grid-cols-2 gap-3">
          {sides.map((s) => (
            <div key={s.id} className="flex flex-col gap-1.5">
              <Link href={`/owners/${s.id}`} className="font-bold hover:underline">
                {s.name} gets
              </Link>
              <div className="flex flex-wrap gap-1.5">
                {item.assets
                  .filter((a) => ownerByTeam[a.to_team_id] === s.id)
                  .map((a) => (
                    <Chip key={a.player_name} added plain name={a.player_name} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <span className="font-bold">
            {item.proposing_owner_name} <span className="text-xs font-normal" style={{ color: ELITE.soft }}>traded with</span> {item.receiving_owner_name}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {item.assets.map((a) => (
              <Chip key={a.player_name} added plain name={a.player_name} />
            ))}
          </div>
        </>
      )}
    </EliteCard>
  );
}
