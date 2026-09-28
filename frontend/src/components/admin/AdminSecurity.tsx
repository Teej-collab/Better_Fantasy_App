"use client";

import { useState } from "react";
import { getAdminSecurity, type AdminSecurity as AdminSecurityData } from "@/lib/api";
import { AdminSection, EmptyNote, Pill, StatTile, WindowPicker, formatWhen, timeAgo } from "@/components/admin/AdminUi";

const KIND_LABELS: Record<string, string> = {
  login_failed: "Failed sign-in",
  forbidden: "Blocked request",
  rate_limited: "Rate limited",
  invalid_token: "Bad sign-in link",
};

const KIND_TONES: Record<string, "bad" | "warn" | "default"> = {
  login_failed: "bad",
  forbidden: "warn",
  rate_limited: "warn",
  invalid_token: "bad",
};

// Admin > Security — failed sign-ins, blocked (403) and rate-limited
// (429) requests, and bad or reused sign-in links (app/monitoring.py).
// A burst of failed sign-ins also sends a push alert.
export function AdminSecurity({ initial }: { initial: AdminSecurityData }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  function changeWindow(days: number) {
    setLoading(true);
    getAdminSecurity(days)
      .then(setData)
      .finally(() => setLoading(false));
  }

  const count = (kind: string) => data.by_kind.find((k) => k.kind === kind)?.events ?? 0;
  const failed = count("login_failed");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-black/50 dark:text-white/50">
          10 failed sign-ins from one IP (or 5 on one account) in 15 minutes sends you a push alert.
        </p>
        <WindowPicker value={data.window_days} onChange={changeWindow} disabled={loading} options={[1, 7, 30]} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Failed sign-ins" value={failed} tone={failed >= 10 ? "bad" : failed ? "warn" : "good"} />
        <StatTile label="Blocked requests" value={count("forbidden")} hint="403 — not allowed" />
        <StatTile label="Rate limited" value={count("rate_limited")} hint="429 — too many tries" />
        <StatTile label="Bad sign-in links" value={count("invalid_token")} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminSection title="Accounts Targeted" hint="Emails with failed sign-ins — normal for a mistyped password, suspicious from many IPs.">
          {data.targeted_accounts.length === 0 ? (
            <EmptyNote>No failed sign-ins.</EmptyNote>
          ) : (
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {data.targeted_accounts.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block break-all">{a.email}</span>
                    <span className="text-xs text-black/50 dark:text-white/50">
                      {a.real_account ? "real account" : "no such account"} · last {timeAgo(a.last_seen)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
                    {a.failed_logins} fails
                    <span className="block">
                      {a.ips} IP{a.ips === 1 ? "" : "s"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection title="Busiest IPs" hint="Where security events come from.">
          {data.top_ips.length === 0 ? (
            <EmptyNote>Nothing recorded.</EmptyNote>
          ) : (
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {data.top_ips.map((ip) => (
                <li key={ip.ip} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs break-all">{ip.ip}</span>
                    <span className="text-xs text-black/50 dark:text-white/50">last {timeAgo(ip.last_seen)}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
                    {ip.events} events
                    {ip.failed_logins > 0 && (
                      <span className="block text-red-500">
                        {ip.failed_logins} failed · {ip.emails_tried} email{ip.emails_tried === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </div>

      <AdminSection title="Blocked Pages" hint="Which endpoints turned requests away, and why.">
        {data.top_paths.length === 0 ? (
          <EmptyNote>Nothing blocked.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.top_paths.map((p) => (
              <li key={`${p.path}-${p.kind}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Pill tone={KIND_TONES[p.kind] ?? "default"}>{KIND_LABELS[p.kind] ?? p.kind}</Pill>
                  <span className="min-w-0 font-mono text-xs break-all">{p.path}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-black/50 dark:text-white/50">{p.events}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Recent Events">
        {data.recent.length === 0 ? (
          <EmptyNote>Nothing recorded in this window.</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {data.recent.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone={KIND_TONES[e.kind] ?? "default"}>{KIND_LABELS[e.kind] ?? e.kind}</Pill>
                    <span className="min-w-0 break-all">{e.email ?? e.who ?? "Signed-out visitor"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-black/50 dark:text-white/50">{formatWhen(e.created_at)}</span>
                </span>
                <span className="font-mono text-[11px] break-all text-black/45 dark:text-white/45">
                  {[e.ip, e.method && e.path ? `${e.method} ${e.path}` : e.path].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}
