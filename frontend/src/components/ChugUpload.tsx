"use client";

import { useRef, useState } from "react";
import { API_BASE_URL, getChugUploadTicket } from "@/lib/api";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { ANTON, ELITE, EliteCard } from "@/components/elite/Elite";

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
      // Short AI trash-talk take — null if generation failed or timed out.
      roast: string | null;
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
//
// POST /chug/upload streams a heartbeat (a lone space) every ~20s
// while the upload+analysis is still running server-side, then one
// final line — the real JSON result — once it's done (see that
// endpoint's own docstring for why: without this, a slow mobile
// upload or a longer analysis could sit with zero bytes flowing long
// enough for Railway's edge to kill the connection, which showed up
// here as a generic, unhelpful "Load failed" — 2026-09 reported).
// res.json() would choke on the heartbeat spaces, so this reads the
// whole body as text and parses just the last non-blank line.
async function parseStreamedResult(res: Response): Promise<UploadResult> {
  const text = await res.text();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) throw new Error("Upload failed — empty response");
  const data = JSON.parse(last);
  if (data.error) throw new Error(data.message ?? `Upload failed (${data.status})`);
  return data as UploadResult;
}
export function ChugUpload({
  variant = "panel",
  creditableOwners,
}: {
  // "elite": the Chug Board's Submit card (2026-10-31 elite pass).
  variant?: "panel" | "bare" | "elite";
  // Commissioner-only: owners a chug can be credited to instead of the
  // uploader (e.g. a video someone sent over because their own upload
  // failed). The backend re-checks commissioner status.
  creditableOwners?: { owner_id: number; owner_name: string }[];
}) {
  const [creditTo, setCreditTo] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The elite card's Record button: the same upload, but a phone browser
  // opens the camera straight away (`capture`).
  const recordRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("video", file);

    try {
      const ticket = await getChugUploadTicket();
      if (!ticket) throw new Error("Not signed in");

      const onBehalf = creditTo ? `&owner_id=${encodeURIComponent(creditTo)}` : "";
      const res = await fetch(`${API_BASE_URL}/chug/upload?ticket=${encodeURIComponent(ticket)}${onBehalf}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        // Only the pre-flight auth check can still fail with a real
        // HTTP error status now — every other failure (bad file type,
        // too large, analysis failed) is encoded inside the streamed
        // body instead, since a status code can't change after
        // streaming has already started (see parseStreamedResult).
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Upload failed (${res.status})`);
      }
      const data = await parseStreamedResult(res);
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      if (recordRef.current) recordRef.current.value = "";
    }
  }

  const content = (
    <>
      <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Submit a Chug
      </span>
      <p className="text-sm text-black/60 dark:text-white/60">
        Upload a video (.mp4, .mov, .m4v) and it&apos;ll be graded automatically — time, smoothness, and hype.
      </p>

      {creditableOwners && creditableOwners.length > 0 && (
        <label className="flex w-fit items-center gap-2 text-sm text-black/60 dark:text-white/60">
          Credit to
          <select
            value={creditTo}
            onChange={(e) => setCreditTo(e.target.value)}
            disabled={status === "uploading"}
            className="rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
          >
            <option value="">Me</option>
            {creditableOwners.map((o) => (
              <option key={o.owner_id} value={o.owner_id}>
                {o.owner_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
        aria-label="Upload a chug video"
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
          {result.roast && <p className="mt-1 text-sm leading-snug text-black/70 dark:text-white/70">{result.roast}</p>}
        </div>
      )}
    </>
  );

  if (variant === "elite") {
    const uploading = status === "uploading";
    return (
      <EliteCard tone="green" className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={`${ANTON} text-[22px] tracking-wide`}>SUBMIT A CHUG</span>
          {creditableOwners && creditableOwners.length > 0 && (
            <label className="flex items-center gap-1.5 text-[13px]" style={{ color: ELITE.soft }}>
              Credit to
              <select
                value={creditTo}
                onChange={(e) => setCreditTo(e.target.value)}
                disabled={uploading}
                className="rounded-md border border-white/15 bg-[#10151c] px-2 py-1 text-[13px] font-bold"
                style={{ color: ELITE.green }}
              >
                <option value="">Me</option>
                {creditableOwners.map((o) => (
                  <option key={o.owner_id} value={o.owner_id}>
                    {o.owner_name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["TIME", "Can to mouth", ELITE.green],
            ["SMOOTH", "Glass handling", ELITE.green],
            ["HYPE", "Roast yourself", ELITE.peach],
          ].map(([title, caption, color]) => (
            <div key={title} className="rounded-[14px] bg-[#0f141b] px-1 py-2.5">
              <div className={`${ANTON} text-lg`} style={{ color }}>
                {title}
              </div>
              <div className="text-[11px]" style={{ color: ELITE.soft }}>
                {caption}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs" style={{ color: ELITE.soft }}>
          Record or upload a video (.mp4, .mov, .m4v) and it&apos;s graded automatically. Hype is what you say and do, not how loud the room is:
          roast yourself for the player who put you here.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <input
          ref={recordRef}
          type="file"
          accept="video/*"
          capture="user"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={uploading}
            onClick={() => recordRef.current?.click()}
            className="flex min-h-[52px] flex-[1.3] items-center justify-center gap-2 rounded-2xl text-base font-extrabold text-[#1a0b00] shadow-[0_0_20px_rgba(255,122,26,.5)] disabled:opacity-50"
            style={{ background: ELITE.orange }}
          >
            <span className="size-3.5 rounded-full bg-[#1a0b00]" aria-hidden />
            Record
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl border border-white/20 text-[15px] font-bold disabled:opacity-50"
          >
            Choose video
          </button>
        </div>
        {uploading && (
          <p className="flex items-center gap-2 text-sm" style={{ color: ELITE.soft }}>
            <span className="live-dot" aria-hidden />
            Analyzing your chug…
          </p>
        )}
        {status === "error" && error && <p className="text-sm text-red-400">{error}</p>}
        {status === "done" && result && !result.can_to_mouth && (
          <p className="text-sm" style={{ color: ELITE.soft }}>
            {result.message}
          </p>
        )}
        {status === "done" && result && result.can_to_mouth && (
          <div className="flex flex-col gap-1.5 rounded-2xl border border-[rgba(57,255,20,.35)] bg-[#0f141b] p-3.5">
            <span className={`${ANTON} text-2xl`} style={{ color: ELITE.green }}>
              GRADED {result.final_score}/10
            </span>
            <span className="text-xs" style={{ color: ELITE.soft }}>
              {result.duration_seconds}s · smoothness {result.smoothness_score}/10 · hype {result.hype_score}/10
            </span>
            <span className="text-xs font-semibold" style={{ color: ELITE.peach }}>
              {result.chugs_owed_before > 0
                ? `Paid down a chug — ${result.chugs_owed_after} still owed.`
                : "Nothing owed — logged as a bonus chug for the lifetime count."}
            </span>
            {result.roast && <p className="mt-1 text-sm leading-snug text-[#f5f4ec]/85">{result.roast}</p>}
          </div>
        )}
      </EliteCard>
    );
  }

  if (variant === "bare") {
    return <div className="flex flex-col gap-2">{content}</div>;
  }

  return (
    <section
      className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]"
      style={panelGlowStyle(SECTION_COLORS.chug)}
    >
      {content}
    </section>
  );
}
