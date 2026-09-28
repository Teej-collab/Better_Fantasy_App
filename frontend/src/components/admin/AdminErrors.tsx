"use client";

import { useEffect, useState } from "react";
import {
  getAdminErrorDetail,
  getAdminErrors,
  type AdminErrorDetail,
  type AdminErrorGroup,
  type AdminErrors as AdminErrorsData,
} from "@/lib/api";
import {
  AdminSection,
  BarRow,
  EmptyNote,
  Pill,
  StatTile,
  WindowPicker,
  dayLabel,
  formatWhen,
  timeAgo,
} from "@/components/admin/AdminUi";

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

function isNew(group: AdminErrorGroup): boolean {
  const first = group.first_ever ?? group.first_seen;
  return Date.now() - new Date(first).getTime() < NEW_WINDOW_MS;
}

// Admin > Errors — JavaScript errors from users' devices (lib/
// errorReporter.ts) and backend errors (app/monitoring.py), grouped so
// each bug is one row. Tapping a row (or an error push alert, which
// links here with ?fp=) opens every recent occurrence with its stack.
export function AdminErrors({
  initial,
  initialFingerprint,
}: {
  initial: AdminErrorsData;
  initialFingerprint: string | null;
}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialFingerprint);
  // Keyed by fingerprint, so switching errors never shows the previous
  // one's details while the next loads.
  const [loaded, setLoaded] = useState<AdminErrorDetail | null>(null);
  const [failedFp, setFailedFp] = useState<string | null>(null);
  const detail = loaded && loaded.fingerprint === selected ? loaded : null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getAdminErrorDetail(selected)
      .then((d) => !cancelled && setLoaded(d))
      .catch(() => !cancelled && setFailedFp(selected));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function select(fp: string | null) {
    setSelected(fp);
    const url = fp ? `/admin/errors?fp=${fp}` : "/admin/errors";
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  }

  function changeWindow(days: number) {
    setLoading(true);
    getAdminErrors(days)
      .then(setData)
      .finally(() => setLoading(false));
  }

  if (selected) {
    return (
      <ErrorDetail fingerprint={selected} detail={detail} failed={failedFp === selected} onBack={() => select(null)} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          New errors send you a push alert (at most once every 6 hours per error).
        </p>
        <WindowPicker value={data.window_days} onChange={changeWindow} disabled={loading} options={[1, 7, 30]} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Distinct errors" value={data.kinds} tone={data.kinds ? "warn" : "good"} />
        <StatTile label="Occurrences" value={data.occurrences} />
        <StatTile label="In the app" value={data.client} hint="users' devices" />
        <StatTile label="On the server" value={data.server} tone={data.server ? "bad" : "default"} />
      </div>

      <AdminSection title="Errors" hint="Most recent first. Tap one for every occurrence and its stack trace.">
        {data.groups.length === 0 ? (
          <EmptyNote>No errors in this window. 🎉</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.groups.map((g) => (
              <li key={g.fingerprint}>
                <button
                  onClick={() => select(g.fingerprint)}
                  className="flex w-full flex-col gap-1 py-2.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={g.source === "server" ? "bad" : "warn"}>{g.source === "server" ? "server" : "app"}</Pill>
                    {isNew(g) && <Pill tone="bad">new</Pill>}
                    <span className="min-w-0 flex-1 font-mono text-xs break-all">{g.message}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-black/50 dark:text-white/50">
                    {g.route && <span className="font-mono break-all">{g.route}</span>}
                    <span>
                      {g.occurrences}× · {g.affected} {g.affected === 1 ? "person" : "people"}
                    </span>
                    <span>last {timeAgo(g.last_seen)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}

function ErrorDetail({
  fingerprint,
  detail,
  failed,
  onBack,
}: {
  fingerprint: string;
  detail: AdminErrorDetail | null;
  failed: boolean;
  onBack: () => void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  const latest = detail?.occurrences[0];
  const dailyMax = Math.max(1, ...(detail?.daily.map((d) => d.occurrences) ?? [0]));

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="self-start text-sm text-[var(--admin-accent)] hover:underline">
        ← All errors
      </button>

      {failed ? (
        <EmptyNote>Couldn&apos;t load this error — it may be older than what&apos;s kept.</EmptyNote>
      ) : !detail || !latest ? (
        <EmptyNote>Loading…</EmptyNote>
      ) : (
        <>
          <AdminSection title={latest.source === "server" ? "Server error" : "App error"}>
            <p className="font-mono text-sm break-all">{latest.message}</p>
            <p className="text-xs text-black/50 dark:text-white/50">
              {detail.occurrences.length}
              {detail.occurrences.length === 50 ? "+" : ""} recent occurrences · id {fingerprint}
            </p>
          </AdminSection>

          {detail.daily.length > 1 && (
            <AdminSection title="Last 30 Days">
              <div className="flex flex-col gap-1.5">
                {detail.daily.map((d) => (
                  <BarRow key={d.day} label={dayLabel(d.day)} value={d.occurrences} max={dailyMax} color="#ef4444" />
                ))}
              </div>
            </AdminSection>
          )}

          <AdminSection title="Occurrences" hint="Newest first. Tap one to see its stack trace.">
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {detail.occurrences.map((o, i) => (
                <li key={`${o.created_at}-${i}`} className="py-2">
                  <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full flex-col gap-0.5 text-left">
                    <span className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 font-medium wrap-break-word">{o.who ?? "Signed-out visitor"}</span>
                      <span className="shrink-0 text-xs text-black/50 dark:text-white/50">{formatWhen(o.created_at)}</span>
                    </span>
                    <span className="text-xs break-all text-black/50 dark:text-white/50">
                      {[o.method, o.route, o.status_code, o.os, o.screen].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </button>
                  {open === i && (
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-black/5 p-2 text-[11px] leading-snug whitespace-pre-wrap dark:bg-black/40">
                      {o.stack || "No stack trace was captured for this one."}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </AdminSection>
        </>
      )}
    </div>
  );
}
