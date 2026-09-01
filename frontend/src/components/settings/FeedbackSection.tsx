"use client";

import { useEffect, useState } from "react";
import { getFeedback, submitFeedback, type FeedbackItem } from "@/lib/api";

/**
 * The owner's own request (2026-09-02) — "just like any app would
 * have." Deliberately simple: a message goes straight into a new
 * `feedback` table (no email, no webhook — real follow-ups if this
 * ever needs them, not built speculatively now), and a commissioner
 * sees what's come in right in the same section, one tap away from
 * where they'd submit it themselves. `window.location.pathname` is
 * captured automatically as free context — whoever reads it later
 * knows what screen the report was actually about without having to
 * ask.
 */
export function FeedbackSection({ isCommissioner }: { isCommissioner: boolean }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Bumped on every successful submit — passed to RecentFeedback as a
  // dependency so a commissioner submitting their own report sees it
  // show up immediately below, instead of only after a manual reload.
  const [refreshCount, setRefreshCount] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus("saving");
    setError(null);
    try {
      await submitFeedback(trimmed, window.location.pathname);
      setMessage("");
      setStatus("sent");
      setRefreshCount((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send — try again.");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Feedback</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          Found a bug, or have an idea for the league? Send it straight through.
        </p>
      </div>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label htmlFor="feedback-message" className="sr-only">
            Your feedback
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            rows={4}
            maxLength={2000}
            placeholder="What's on your mind?"
            className="min-w-0 resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={status === "saving" || !message.trim()}
              className="w-fit rounded-full bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {status === "saving" ? "Sending…" : "Send feedback"}
            </button>
            {status === "sent" && <p className="text-xs text-emerald-600 dark:text-emerald-400">Sent — thanks!</p>}
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-500">
              {error}
            </p>
          )}
        </form>
      </section>

      {isCommissioner && <RecentFeedback refreshCount={refreshCount} />}
    </div>
  );
}

function RecentFeedback({ refreshCount }: { refreshCount: number }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // setTimeout(0) — same lint-satisfying pattern used across this
    // app's other mount-fetch effects (a direct async call in the
    // effect body trips react-hooks/set-state-in-effect). Re-runs
    // whenever refreshCount changes (a successful submit just above),
    // not just on mount.
    const id = setTimeout(() => {
      getFeedback()
        .then((res) => setItems(res.items))
        .catch(() => setError("Couldn't load feedback."));
    }, 0);
    return () => clearTimeout(id);
  }, [refreshCount]);

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
      <h2 className="text-sm font-semibold tracking-wide uppercase">Recent Feedback</h2>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!items && !error && <p className="text-xs text-black/50 dark:text-white/50">Loading…</p>}
      {items && items.length === 0 && (
        <p className="text-xs text-black/50 dark:text-white/50">Nothing submitted yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <p className="text-sm whitespace-pre-wrap">{item.message}</p>
              <p className="text-xs text-black/40 dark:text-white/40">
                {item.submitted_by} · {new Date(item.created_at).toLocaleString()}
                {item.page_url && ` · ${item.page_url}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
