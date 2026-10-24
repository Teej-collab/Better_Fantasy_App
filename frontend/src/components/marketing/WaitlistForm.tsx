"use client";

import { useState } from "react";

// The 2027 waitlist signup (backend app/routers/waitlist.py), on the
// public /waitlist page. No account needed.

type Platform = "espn" | "sleeper" | "yahoo" | "nfl" | "other" | "none";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "espn", label: "ESPN" },
  { value: "sleeper", label: "Sleeper" },
  { value: "yahoo", label: "Yahoo" },
  { value: "nfl", label: "NFL.com" },
  { value: "other", label: "Something else" },
  { value: "none", label: "Starting a new league" },
];

const field =
  "min-h-11 w-full rounded-lg border px-3 text-[15px] outline-none focus:border-[color:var(--wl-accent)]";
const fieldStyle = { background: "var(--wl-surface)", borderColor: "var(--wl-border)", color: "var(--wl-text)" };

export function WaitlistForm({ refSource }: { refSource: string | null }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"commissioner" | "player">("commissioner");
  const [size, setSize] = useState("12");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/backend/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || null,
          role,
          league_size: role === "commissioner" && size ? Number(size) : null,
          platform: platform || null,
          note: note.trim() || null,
          ref: refSource,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.detail === "string" ? data.detail : "That didn't go through. Try again?");
      }
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Try again?");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="neon-panel flex flex-col gap-2 rounded-2xl p-6" style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}>
        <p className="font-display text-2xl font-bold">You&apos;re on the list.</p>
        <p className="text-[color:var(--wl-text-secondary)]">
          We&apos;ll reach out before draft season with everything you need to bring your league over. Want to get
          started sooner? You can set up a league today.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="neon-panel flex flex-col gap-4 rounded-2xl p-5 sm:p-6"
      style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">I&apos;m…</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["commissioner", "The commissioner"],
              ["player", "In a league"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-semibold"
              style={role === value ? { borderColor: "var(--wl-accent)", color: "var(--wl-accent)" } : { borderColor: "var(--wl-border)" }}
            >
              <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} style={fieldStyle} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        First name (optional)
        <input autoComplete="given-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} style={fieldStyle} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        {role === "commissioner" && (
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Teams in your league
            <select value={size} onChange={(e) => setSize(e.target.value)} className={field} style={fieldStyle}>
              {[6, 8, 10, 12, 14, 16, 18, 20].map((n) => (
                <option key={n} value={n}>
                  {n} teams
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Where you play now
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform | "")} className={field} style={fieldStyle}>
            <option value="">Pick one</option>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Anything your league can&apos;t live without? (optional)
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${field} py-2`} style={fieldStyle} />
      </label>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={status === "sending"}
        className="min-h-12 rounded-xl px-5 text-base font-extrabold text-black disabled:opacity-60"
        style={{ background: "var(--wl-accent)" }}
      >
        {status === "sending" ? "Saving your spot…" : "Save my league a spot"}
      </button>
      <p className="text-xs text-[color:var(--wl-text-secondary)]">We only use your email to tell you when your league can come over. No spam.</p>
    </form>
  );
}
