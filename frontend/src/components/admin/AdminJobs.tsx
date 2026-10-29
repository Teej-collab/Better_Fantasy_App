"use client";

import { useState } from "react";
import { getAdminSystemHealth, runAdminJob } from "@/lib/api";
import { relativeTime } from "@/lib/adminFormat";

// The Command Center's Jobs panel (2026-10-28, mockup D): the server
// jobs that used to be API-only, with when each last ran and a Run
// button. Live scores is left out on purpose: run outside a game it can
// misread 0-point starters as chugs (backend /admin/weekly-team-stats).
// Same list as the app's components/admin/AdminJobs.tsx.
const JOBS = [
  { key: "full_sync", label: "Sync ESPN", path: "/admin/sync", what: "Pulls League 1 from ESPN: teams, rosters, scores. Can take a minute or two." },
  { key: "weekly_compute", label: "Weekly scoring", path: "/admin/weekly-compute", what: "Recomputes this week's scores from real stats." },
  { key: "sleeper_player_sync", label: "Player database", path: "/admin/players/sync", what: "Refreshes every NFL player from Sleeper." },
  { key: "projected_points_sync", label: "Projections", path: "/admin/players/sync-projections", what: "Refreshes ESPN's projected points." },
] as const;

type Result = { key: string; ok: boolean; message: string };

export function AdminJobs({ initialJobs }: { initialJobs: Record<string, string> }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(job: (typeof JOBS)[number]) {
    if (!window.confirm(`Run ${job.label}?\n\n${job.what}`)) return;
    setRunning(job.key);
    setResult(null);
    try {
      await runAdminJob(job.path);
      setResult({ key: job.key, ok: true, message: `${job.label} finished.` });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setResult({
        key: job.key,
        ok: false,
        message: message === "Commissioner only" ? "Only League 1's commissioner can run jobs." : message,
      });
    } finally {
      setRunning(null);
      getAdminSystemHealth()
        .then((h) => setJobs(h.jobs))
        .catch(() => {});
    }
  }

  return (
    <ul className="flex flex-col">
      {JOBS.map((job) => {
        const last = jobs[job.key];
        return (
          <li key={job.key} className="flex min-h-12 items-center gap-3 border-t border-black/5 py-2 first:border-t-0 dark:border-white/5">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${last ? "bg-emerald-500" : "bg-black/20 dark:bg-white/25"}`}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{job.label}</span>
              <span className={`text-xs ${result?.key === job.key ? (result.ok ? "text-emerald-500" : "text-red-500") : "text-black/50 dark:text-white/50"}`}>
                {running === job.key
                  ? "Running…"
                  : result?.key === job.key
                    ? result.message
                    : last
                      ? `Last: ${relativeTime(last)}`
                      : "Not run since the server restarted"}
              </span>
            </span>
            <button
              onClick={() => run(job)}
              disabled={running !== null}
              className="min-h-8 rounded-full border border-[#bf5af2]/40 bg-[#bf5af2]/10 px-3 text-xs font-bold text-[#bf5af2] disabled:opacity-40 dark:text-[#e0b8f8]"
            >
              {running === job.key ? "Running" : "Run"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
