"use client";

import { useRef, useState } from "react";
import { API_BASE_URL, getChugUploadTicket } from "@/lib/api";

type UploadResult =
  | { can_to_mouth: false; message: string }
  | {
      can_to_mouth: true;
      id: number;
      duration_seconds: number;
      time_score: number;
      smoothness_score: number;
      hype_score: number;
      final_score: number;
      created_at: string;
      chugs_owed_before: number;
      chugs_owed_after: number;
    };

// Still fetches the backend directly (not through the /api/backend
// proxy AuthStatus/MyTeamApp/etc. use) — forwarding a real video file
// through a Vercel serverless function would count against its
// request-body size limit, which this direct-to-backend upload never
// hits. Auth works the same way regardless: a short-lived ticket
// (getChugUploadTicket, minted via the frontend's own first-party
// cookie — never touched by Safari's ITP) carried as a query param,
// instead of relying on the backend's cookie reaching this
// cross-site fetch at all.
export function ChugUpload() {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("video", file);

    try {
      const ticket = await getChugUploadTicket();
      if (!ticket) throw new Error("Not signed in");

      const res = await fetch(`${API_BASE_URL}/chug/upload?ticket=${encodeURIComponent(ticket)}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Upload failed (${res.status})`);
      }
      const data: UploadResult = await res.json();
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
      <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Submit a Chug
      </span>
      <p className="text-sm text-black/60 dark:text-white/60">
        Upload a video (.mp4, .mov, .m4v) and it&apos;ll be graded automatically — time, smoothness, and hype.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
        disabled={status === "uploading"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
        className="w-fit text-sm file:mr-3 file:rounded-full file:border-0 file:bg-amber-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-amber-700 disabled:opacity-50"
      />

      {status === "uploading" && (
        <p className="flex items-center gap-2 text-sm text-black/60 dark:text-white/60">
          <span className="live-dot" aria-hidden />
          Analyzing your chug…
        </p>
      )}

      {status === "error" && error && <p className="text-sm text-red-500">{error}</p>}

      {status === "done" && result && !result.can_to_mouth && (
        <p className="text-sm text-black/60 dark:text-white/60">{result.message}</p>
      )}

      {status === "done" && result && result.can_to_mouth && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
          <span className="text-lg font-semibold">🍺 Grade: {result.final_score}/10</span>
          <span className="text-xs text-black/60 dark:text-white/60">
            {result.duration_seconds}s · smoothness {result.smoothness_score}/10 · hype {result.hype_score}/10
          </span>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {result.chugs_owed_before > 0
              ? `Paid down a chug — ${result.chugs_owed_after} still owed.`
              : "Nothing owed — logged as a bonus chug for the lifetime count."}
          </span>
        </div>
      )}
    </section>
  );
}
