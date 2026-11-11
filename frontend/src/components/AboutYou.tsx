"use client";

import { useEffect, useRef, useState } from "react";
import { ANTON, SATISFY } from "@/components/elite/Elite";
import { clearSession } from "@/lib/logout";

type Gender = "male" | "female" | null;
type Choice = "male" | "female" | "none";

const OPTIONS: { key: Choice; label: string }[] = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "none", label: "Prefer not to say" },
];

async function saveAboutYou(body: { birthdate?: string; gender: Gender }): Promise<void> {
  const res = await fetch("/api/backend/auth/about-you", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail, () => null);
    throw new Error(typeof detail === "string" ? detail : "Couldn't save that. Try again.");
  }
}

function ChoiceRow({ value, onChange, disabled }: { value: Choice | null; onChange: (c: Choice) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="You are" className="grid grid-cols-3 gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`min-h-11 rounded-xl border px-2 text-sm font-bold transition-colors disabled:opacity-50 ${
            value === o.key
              ? "border-[#39ff14] bg-[#0f1a12] text-[#39ff14] shadow-[0_0_12px_rgba(57,255,20,.25)]"
              : "border-white/10 bg-[#10151c] text-[#f5f4ec]/80 hover:border-[#39ff14]/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The one-time About you step (2026-11-10), over every page once signed
 * in until it's answered: a birthday that keeps under-13s out (only the
 * year is kept) and the gender the recaps write with. A birthday under
 * 13 locks the account for good (backend app/routers/auth.py), and
 * every later visit shows the locked screen. The app's twin is
 * mobile/src/components/AboutYou.tsx.
 */
export function AboutYouGate() {
  const [state, setState] = useState<"hidden" | "ask" | "locked">("hidden");

  useEffect(() => {
    let live = true;
    fetch("/api/backend/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 403) {
          const body = await res.json().catch(() => null);
          if (body?.detail === "under_13") setState("locked");
          return;
        }
        if (!res.ok) return;
        const me = await res.json();
        if (me?.about_you_needed) setState("ask");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (state === "hidden") return null;
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#07090c]/95 px-4 py-10 backdrop-blur-sm">
      <div className="mx-auto max-w-md rounded-[22px] border border-[#39ff14]/40 bg-[#141a22] p-6 text-[#f5f4ec] shadow-[0_0_34px_rgba(57,255,20,.15)]">
        {state === "locked" ? <Locked /> : <Ask onDone={() => setState("hidden")} onLocked={() => setState("locked")} />}
      </div>
    </div>
  );
}

function Locked() {
  return (
    <div className="flex flex-col gap-4 text-center">
      <h2 className={`${ANTON} text-3xl uppercase tracking-wide text-[#39ff14]`}>You need to be 13 or older</h2>
      <p className="text-sm text-[#f5f4ec]/70">Sorry, you have to be at least 13 to use The Weekend.</p>
      <button
        type="button"
        // A full load after signing out, so nothing of the session stays in memory.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        onClick={() => void clearSession().then(() => window.location.assign("/"))}
        className="min-h-11 rounded-xl border border-white/15 px-4 font-bold hover:bg-white/5"
      >
        Sign out
      </button>
    </div>
  );
}

function Ask({ onDone, onLocked }: { onDone: () => void; onLocked: () => void }) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const m = Number(month);
    const d = Number(day);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && year.length === 4)) {
      setError("Enter your birthday as month, day and year.");
      return;
    }
    if (choice === null) {
      setError("Pick one. Prefer not to say is fine.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const birthdate = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      await saveAboutYou({ birthdate, gender: choice === "none" ? null : choice });
      onDone();
    } catch (err) {
      if (err instanceof Error && err.message === "under_13") onLocked();
      else setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
      setBusy(false);
    }
  }

  const field =
    "min-h-12 w-full rounded-xl border border-white/10 bg-[#10151c] text-center text-lg tabular-nums text-[#f5f4ec] placeholder:text-[#f5f4ec]/35 focus:border-[#39ff14] focus:outline-none";

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col items-center text-center">
        <span className={`${SATISFY} text-2xl text-[#ffb27a]`} style={{ textShadow: "0 0 10px rgba(255,122,26,.7)" }}>
          One quick thing
        </span>
        <h2 className={`${ANTON} text-4xl uppercase tracking-wide text-[#39ff14]`} style={{ textShadow: "0 0 8px rgba(57,255,20,.8)" }}>
          About you
        </h2>
        <p className="mt-1 text-sm text-[#f5f4ec]/65">We ask once. Everyone here has to be 13 or older.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-[#f5f4ec]/75">Your birthday</legend>
        <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-2">
          <input
            id="about-month"
            aria-label="Birth month"
            inputMode="numeric"
            placeholder="MM"
            value={month}
            maxLength={2}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 2);
              setMonth(v);
              if (v.length === 2) dayRef.current?.focus();
            }}
            className={field}
          />
          <input
            id="about-day"
            ref={dayRef}
            aria-label="Birth day"
            inputMode="numeric"
            placeholder="DD"
            value={day}
            maxLength={2}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 2);
              setDay(v);
              if (v.length === 2) yearRef.current?.focus();
            }}
            className={field}
          />
          <input
            id="about-year"
            ref={yearRef}
            aria-label="Birth year"
            inputMode="numeric"
            placeholder="YYYY"
            value={year}
            maxLength={4}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className={field}
          />
        </div>
        <p className="text-xs text-[#f5f4ec]/50">We only keep the year.</p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-[#f5f4ec]/75">You are</span>
        <ChoiceRow value={choice} onChange={setChoice} />
        <p className="text-xs text-[#f5f4ec]/50">The weekly recaps use this so they get you right. If you&apos;d rather not say, they&apos;ll use your name.</p>
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className={`${ANTON} min-h-12 rounded-xl bg-[#39ff14] text-lg uppercase tracking-wide text-[#06110a] shadow-[0_0_14px_rgba(57,255,20,.5)] disabled:opacity-60`}
      >
        {busy ? "Saving…" : "Done"}
      </button>
    </form>
  );
}

/** Settings > Profile: change the answer later (hidden until the step is answered). */
export function GenderSection() {
  const [value, setValue] = useState<Choice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/backend/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => me && !me.about_you_needed && setValue(me.gender ?? "none"))
      .catch(() => {});
  }, []);

  if (value === null) return null;

  async function pick(next: Choice) {
    if (next === value || value === null) return;
    const before = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      await saveAboutYou({ gender: next === "none" ? null : next });
    } catch (e) {
      setValue(before);
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
      <h2 className="text-lg font-semibold">You are</h2>
      <p className="text-sm text-black/60 dark:text-white/60">The weekly recaps use this so they get you right. Prefer not to say and they use your name.</p>
      <ChoiceRow value={value} onChange={(c) => void pick(c)} disabled={saving} />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </section>
  );
}
