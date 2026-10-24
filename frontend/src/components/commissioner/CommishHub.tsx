"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GroupTitle, panelClass } from "@/components/commissioner/CommishBits";
import { trackTap } from "@/lib/analyticsEvents";
import { commishApi, TONES, type CommishSummary } from "@/lib/commishApi";
import { NAV_ACCENT } from "@/lib/navDestinations";
import { SwitchCard } from "@/components/commissioner/LeagueSwitch";

// The Commissioner hub (2026-10-23 overhaul, mockup 1): what needs the
// commissioner now, the league at a glance, and every tool in four
// groups, each showing its current setting. Same as the app's
// mobile/src/app/commissioner/index.tsx.

type Tool = { title: string; href: string; value: string; target: string; badge?: string };

const GROUPS: { title: string; color: string; tools: Tool[] }[] = [
  {
    title: "League setup",
    color: TONES.blue,
    tools: [
      { title: "League & format", href: "/commissioner/league", value: "league", target: "league" },
      { title: "Scoring", href: "/commissioner/scoring", value: "scoring", target: "scoring" },
      { title: "Roster & keepers", href: "/commissioner/roster", value: "roster", target: "roster" },
      { title: "Waivers & free agents", href: "/commissioner/waivers", value: "waivers", target: "waivers", badge: "NEW" },
    ],
  },
  {
    title: "People",
    color: TONES.purple,
    tools: [
      { title: "Members & teams", href: "/commissioner/members", value: "members", target: "members" },
      { title: "Chat filter", href: "/commissioner/chat-filter", value: "chat_filter", target: "chat_filter" },
    ],
  },
  {
    title: "Running the season",
    color: TONES.orange,
    tools: [
      { title: "Season calendar", href: "/commissioner/calendar", value: "calendar", target: "calendar", badge: "NEW" },
      { title: "Trades", href: "/commissioner/trades", value: "trades", target: "trades" },
      { title: "Fix a lineup", href: "/commissioner/lineup", value: "lineup", target: "lineup" },
      { title: "Draft", href: "/draft", value: "draft", target: "draft" },
    ],
  },
  {
    title: "League life",
    color: TONES.yellow,
    tools: [
      { title: "Commish Corner", href: "/commissioner/corner", value: "corner", target: "corner", badge: "NEW" },
      { title: "Polls", href: "/commissioner/polls", value: "polls", target: "polls" },
      { title: "Punishment Wheel", href: "/punishment-wheel", value: "wheel", target: "wheel" },
      { title: "Bring your league in", href: "/commissioner/espn", value: "espn", target: "espn" },
    ],
  },
];

export function CommishHub() {
  const [data, setData] = useState<CommishSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commishApi
      .summary()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your league."));
  }, []);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;

  const g = data.glance;
  const glance = [
    { label: "Teams", value: `${g.teams} · ${g.matchups}` },
    { label: "Scoring", value: g.scoring },
    { label: "Week", value: g.week ? `${g.week}${g.last_regular_week ? ` of ${g.last_regular_week}` : ""}` : "Preseason" },
    { label: "Playoffs", value: `${g.playoff_teams} teams · Wk ${g.playoff_start_week}+` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SwitchCard />
      <section className={`${panelClass} overflow-hidden`} style={{ borderColor: `color-mix(in srgb, ${NAV_ACCENT} 45%, transparent)` }}>
        <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
          <h2 className="text-xs font-extrabold tracking-widest uppercase" style={{ color: NAV_ACCENT }}>
            Needs you
          </h2>
          <span className="text-sm text-black/55 dark:text-white/55">
            {data.needs_you.length ? `${data.needs_you.length} thing${data.needs_you.length === 1 ? "" : "s"}` : "All caught up"}
          </span>
        </div>
        {data.needs_you.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-black/55 dark:text-white/55">
            Nothing&apos;s waiting on you. Trades to review, lineups that need fixing and deadlines show up here.
          </p>
        ) : (
          data.needs_you.map((n, i) => (
            <div key={`${n.kind}-${i}`} className="flex items-center gap-3 border-t border-black/5 px-4 py-3 dark:border-white/[0.08]">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: TONES[n.tone] }} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{n.title}</span>
                <span className="truncate text-sm text-black/55 dark:text-white/55">{n.at ? new Date(n.at).toLocaleString() : n.sub}</span>
              </div>
              <Link
                href={n.href}
                onClick={() => trackTap(`commish.needs_${n.kind}`)}
                className="rounded-full px-4 py-1.5 text-sm font-bold"
                style={{ backgroundColor: `color-mix(in srgb, ${NAV_ACCENT} 22%, transparent)` }}
              >
                {n.action}
              </Link>
            </div>
          ))
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {glance.map((t) => (
          <div key={t.label} className="flex flex-col gap-0.5 rounded-xl bg-black/[0.04] p-3 dark:bg-white/[0.05]">
            <span className="text-[11px] font-bold tracking-wider text-black/55 uppercase dark:text-white/55">{t.label}</span>
            <span className="truncate font-extrabold">{t.value}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <GroupTitle title={group.title} color={group.color} />
            <div className={`${panelClass} overflow-hidden`}>
              {group.tools.map((tool, i) => (
                <Link
                  key={tool.title}
                  href={tool.href}
                  onClick={() => trackTap(`commish.${tool.target}`)}
                  className={`flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 ${i > 0 ? "border-t border-black/5 dark:border-white/[0.08]" : ""}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {tool.title}
                      {tool.badge && (
                        <span className="rounded px-1.5 text-[10px] font-extrabold tracking-wider text-black" style={{ backgroundColor: NAV_ACCENT }}>
                          {tool.badge}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-black/55 dark:text-white/55">{data.tools[tool.value]}</span>
                  </span>
                  <span className="text-xl text-black/30 dark:text-white/30" aria-hidden>
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
