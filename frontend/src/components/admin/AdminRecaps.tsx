import type { AdminRecaps as AdminRecapsData } from "@/lib/api";
import { AdminSection, BarRow, EmptyNote, Pill, StatTile, formatWhen } from "@/components/admin/AdminUi";

const SOURCE_LABELS: Record<string, string> = { push: "from the push", home: "on Home", page: "on its page" };

// Admin > Recaps — each week's recap: when it went live at the Tuesday
// flip, how many owners got the "LIVE NOW" push, and who actually read
// it (opened its page or expanded it on Home), plus who hasn't.
export function AdminRecaps({ data }: { data: AdminRecapsData }) {
  const latest = data.weeks[0];
  const readRate = latest && latest.member_count > 0 ? Math.round((latest.readers.length / latest.member_count) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-black/50 dark:text-white/50">
        {data.league_name ?? "League"} · {data.season}. A recap goes live at the Tuesday flip with a push to everyone who has
        League notifications on. A read is opening its page or expanding it on Home.
      </p>

      {!latest ? (
        <AdminSection title="Recaps">
          <EmptyNote>No recap has gone live yet this season. The next one will show up here after the Tuesday flip.</EmptyNote>
        </AdminSection>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={`Week ${latest.week} readers`} value={`${latest.readers.length}/${latest.member_count}`} />
            <StatTile label="Read rate" value={readRate === null ? "—" : `${readRate}%`} tone={readRate === null ? "default" : readRate >= 60 ? "good" : readRate >= 30 ? "warn" : "bad"} />
            <StatTile label="Pushed" value={latest.notified} hint="got LIVE NOW" />
            <StatTile label="Via the push" value={latest.readers.filter((r) => r.source === "push").length} hint="opened from it" />
          </div>

          {data.weeks.map((w) => (
            <AdminSection
              key={w.week}
              title={`Week ${w.week} Recap`}
              hint={w.released_at ? `Went live ${formatWhen(w.released_at)} · pushed to ${w.notified}` : "Read before release tracking began"}
            >
              <BarRow label="Read it" value={w.readers.length} max={Math.max(1, w.member_count)} right={`${w.readers.length} of ${w.member_count}`} />
              {w.readers.length > 0 && (
                <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
                  {w.readers.map((r) => (
                    <li key={r.owner_id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 font-medium wrap-break-word">{r.display_name}</span>
                        {r.source === "push" && <Pill tone="good">push</Pill>}
                      </span>
                      <span className="shrink-0 text-right text-xs text-black/50 dark:text-white/50">
                        {formatWhen(r.first_opened_at)} {r.source ? SOURCE_LABELS[r.source] ?? "" : ""}
                        {r.opens > 1 ? ` · ${r.opens} opens` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {w.not_read.length > 0 && (
                <p className="text-xs text-black/50 dark:text-white/50">
                  Hasn&apos;t read it: {w.not_read.map((m) => m.display_name).join(", ")}
                </p>
              )}
            </AdminSection>
          ))}
        </>
      )}
    </div>
  );
}
