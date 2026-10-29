"use client";

import { useState } from "react";
import { getAdminAiUsage, type AdminAiUsage } from "@/lib/api";
import { AdminSection, BarRow, EmptyNote, StatTile, WindowPicker } from "@/components/admin/AdminUi";

// Admin > AI Costs on the web (2026-10-28), the app's admin/ai-costs.tsx:
// what the AI write-ups, roasts, hype grades and bet slip reads cost, by
// feature and by league, and what that projects to at 100 leagues.

const FEATURE_LABELS: Record<string, string> = {
  matchup_preview: "Matchup previews",
  matchup_recap: "Matchup recaps",
  weekly_recap: "Weekly recaps",
  weekly_preview: "Weekly previews",
  draft_writeup: "Draft write-ups",
  rivalry_name: "Rivalry names",
  chug_roast: "Chug roasts",
  chug_hype: "Chug hype grades",
  bet_slip: "Bet slip reads",
  untagged: "Other",
};

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `${(n * 100).toFixed(2)}¢`;
  return `$${n.toFixed(n < 10 ? 2 : 0)}`;
}

export function AdminAiCosts({ initial }: { initial: AdminAiUsage }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  function pick(days: number) {
    setLoading(true);
    setFailed(false);
    getAdminAiUsage(days)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  const topFeature = Math.max(0.0001, ...data.by_feature.map((f) => f.cost));
  const topLeague = Math.max(0.0001, ...data.by_league.map((l) => l.cost));
  const perWeek = data.per_league_per_week;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          Real cost of every AI call (Claude Sonnet 5, $2 per million tokens in, $10 out).
          {data.since ? ` Tracking began ${new Date(data.since).toLocaleDateString()}.` : ""}
        </p>
        <WindowPicker value={data.days} onChange={pick} disabled={loading} />
      </div>
      {failed && <p className="text-sm text-red-500">Couldn&apos;t load that window.</p>}
      {data.calls === 0 ? (
        <AdminSection title="AI Costs">
          <EmptyNote>Nothing recorded yet. Costs show up here as write-ups, roasts and bet slips run.</EmptyNote>
        </AdminSection>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={`Last ${data.days} days`} value={money(data.total_cost)} hint={`${data.calls} calls`} />
            <StatTile label="Per league, per week" value={money(perWeek)} />
            <StatTile label="At 100 leagues" value={perWeek === null ? "—" : `${money(perWeek * 100)}/wk`} hint="same usage per league" />
            <StatTile label="100 leagues, a season" value={perWeek === null ? "—" : money(perWeek * 100 * 17)} hint="17 weeks" />
          </div>
          <AdminSection title="By feature" hint="What each kind of write-up costs.">
            {data.by_feature.map((f) => (
              <BarRow
                key={f.feature}
                label={FEATURE_LABELS[f.feature] ?? f.feature}
                value={f.cost}
                max={topFeature}
                right={`${money(f.cost)} · ${f.calls}× · ${money(f.calls ? f.cost / f.calls : 0)} each`}
              />
            ))}
          </AdminSection>
          <AdminSection title="By league">
            {data.by_league.map((l) => (
              <BarRow key={l.league_id ?? "none"} label={l.name} value={l.cost} max={topLeague} right={`${money(l.cost)} · ${l.calls}×`} />
            ))}
          </AdminSection>
        </>
      )}
    </div>
  );
}
