"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Punishment Wheel (2026-10) — the web twin of the app's
// mobile/src/app/punishment-wheel.tsx. It turns slowly, game-show style,
// until a commissioner spins it; the server picks where it lands
// (backend/app/routers/punishment_wheel.py), and anyone opening it after
// the spin watches the same spin once before the result is revealed.

type Wheel = {
  season: number;
  items: { id: number; text: string }[];
  result: { text: string; landed_index: number; items: string[]; spun_at: string; spun_by: string | null } | null;
  can_edit: boolean;
  can_spin: boolean;
  is_commissioner: boolean;
};

const COLORS = ["#1f9e0b", "#6d28d9", "#ea580c", "#0e7490", "#be123c", "#ca8a04", "#4338ca", "#15803d", "#9d174d", "#0369a1", "#7c2d12", "#155e75"];
const SPIN_MS = 5200;
const IDLE_DEG_PER_SECOND = 8;

function landing(from: number, index: number, count: number): number {
  const seg = 360 / count;
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const center = index * seg + seg / 2 + jitter;
  const base = Math.ceil((from + 5 * 360) / 360) * 360;
  return base + ((360 - (center % 360)) % 360);
}

function restingAngle(index: number, count: number): number {
  const seg = 360 / count;
  return (360 - ((index * seg + seg / 2) % 360)) % 360;
}

async function call(path: string, init?: RequestInit): Promise<Wheel> {
  const res = await fetch(`/api/backend/punishment-wheel${path}`, {
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Not JSON.
    }
    throw new Error(detail);
  }
  return res.json();
}

export function PunishmentWheel({ leagueId }: { leagueId: number }) {
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<"idle" | "spinning" | "replaying" | "done">("idle");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const rotationRef = useRef(0);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    call("").then(setWheel).catch((e) => setError(e.message));
  }, []);

  // Game-show idle: a slow turn until there's a result.
  useEffect(() => {
    if (!wheel || wheel.result || phase !== "idle") return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      rotationRef.current += ((now - last) / 1000) * IDLE_DEG_PER_SECOND;
      last = now;
      setRotation(rotationRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [wheel, phase]);

  const spinTo = useCallback((index: number, count: number, key: string, delay: number) => {
    window.setTimeout(() => {
      rotationRef.current = landing(rotationRef.current, index, count);
      setRotation(rotationRef.current);
      window.setTimeout(() => {
        setPhase("done");
        try {
          localStorage.setItem(key, "1");
        } catch {
          // Private mode: it'll just replay again next time.
        }
      }, SPIN_MS + 100);
    }, delay);
  }, []);

  // A result: play the spin once (live for the commissioner, a replay for
  // anyone opening it after), otherwise just show where it landed.
  useEffect(() => {
    const result = wheel?.result;
    if (!wheel || !result) return;
    const key = `wl:wheel-seen:${leagueId}:${wheel.season}:${result.spun_at}`;
    if (handled.current === key) return;
    handled.current = key;
    let seen = false;
    try {
      seen = localStorage.getItem(key) !== null;
    } catch {
      seen = false;
    }
    if (seen) {
      rotationRef.current = restingAngle(result.landed_index, result.items.length);
      setRotation(rotationRef.current);
      setPhase("done");
      return;
    }
    const live = phase === "spinning";
    if (!live) setPhase("replaying");
    spinTo(result.landed_index, result.items.length, key, live ? 30 : 900);
    // Once per result; `phase` is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheel, leagueId, spinTo]);

  async function run(action: () => Promise<Wheel>) {
    setBusy(true);
    setError(null);
    try {
      setWheel(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function spin() {
    setPhase("spinning");
    setError(null);
    try {
      setWheel(await call("/spin", { method: "POST" }));
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Couldn't spin the wheel");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    await run(() => call("/items", { method: "POST", body: JSON.stringify({ text }) }));
    setDraft("");
  }

  if (error && !wheel) return <p className="py-12 text-center text-sm text-red-400">{error}</p>;
  if (!wheel) return <p className="py-12 text-center text-sm text-white/50">Loading the wheel…</p>;

  const result = wheel.result;
  const items = result ? result.items : wheel.items.map((i) => i.text);
  const n = Math.max(items.length, 1);
  const seg = 360 / n;
  const gradient = items.length
    ? `conic-gradient(from 0deg, ${items.map((_, i) => `${COLORS[i % COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(", ")})`
    : "#191d23";
  const spinning = phase === "spinning" || phase === "replaying";
  const transition = spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.62, 0.08, 1)` : "none";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-12 text-[#eceef1]">
      <div>
        <p className="text-[11px] font-bold tracking-[0.14em] text-white/50">{wheel.season} SEASON</p>
        <h1 className="font-[Oswald,sans-serif] text-3xl font-bold tracking-wide">PUNISHMENT WHEEL</h1>
      </div>

      <div className="relative flex h-[340px] items-center justify-center [perspective:900px]">
        <div className="absolute top-1 z-10 h-0 w-0 border-x-[14px] border-t-[26px] border-x-transparent border-t-[#39ff14] drop-shadow-[0_0_8px_rgba(57,255,20,0.8)]" />
        <div className="relative h-[300px] w-[300px] [transform:rotateX(24deg)] [transform-style:preserve-3d]">
          <div className="absolute inset-0 translate-y-4 rounded-full bg-[#05070a] shadow-[0_30px_60px_rgba(0,0,0,0.7)]" />
          <div
            className="absolute inset-0 overflow-hidden rounded-full border-[6px] border-[#39ff14] shadow-[0_0_24px_rgba(57,255,20,0.45),inset_0_0_30px_rgba(0,0,0,0.55)]"
            style={{ background: gradient, transform: `rotate(${rotation}deg)`, transition }}
          >
            {items.map((text, i) => (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 -mt-2 w-[118px] origin-[0_50%] overflow-hidden text-ellipsis whitespace-nowrap text-right text-[10px] font-extrabold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]"
                style={{ transform: `rotate(${i * seg + seg / 2 - 90}deg) translateX(26px)` }}
              >
                {text}
              </span>
            ))}
          </div>
          <div className="absolute left-1/2 top-1/2 -ml-8 -mt-8 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-[#39ff14] bg-[#0b0d12] text-center font-[Oswald,sans-serif] text-[9px] leading-[1.1] tracking-wider text-[#39ff14] shadow-[0_0_16px_rgba(57,255,20,0.6)]">
            THE
            <br />
            WEEKEND
          </div>
        </div>
      </div>

      {phase === "replaying" && (
        <p className="rounded-xl border border-[#a855f7] bg-[#1b1230] p-3 text-center text-sm font-semibold text-[#e9d5ff]">
          You missed the spin — here&apos;s how it went…
        </p>
      )}

      {result && phase === "done" && (
        <section aria-live="polite" className="flex flex-col gap-1.5 rounded-2xl border border-[#39ff14]/50 bg-[#13201a] p-4">
          <span className="text-[11px] font-extrabold tracking-[0.14em] text-[#39ff14]">THE WHEEL HAS SPOKEN · {wheel.season} PUNISHMENT</span>
          <span className="font-[Oswald,sans-serif] text-xl font-bold">{result.text}</span>
          <span className="text-xs text-white/50">
            Locked for the {wheel.season} season{result.spun_by ? ` · spun by ${result.spun_by}` : ""} · the league loser owes it
          </span>
        </section>
      )}

      {!result && wheel.is_commissioner && (
        <button
          type="button"
          onClick={() => void spin()}
          disabled={!wheel.can_spin || phase === "spinning"}
          className="h-14 rounded-2xl border-2 border-[#39ff14] bg-[#39ff14] font-[Oswald,sans-serif] text-lg font-bold tracking-[0.15em] text-[#06110a] shadow-[0_0_24px_rgba(57,255,20,0.45)] disabled:bg-transparent disabled:text-[#39ff14] disabled:opacity-60 disabled:shadow-none"
        >
          {phase === "spinning" ? "SPINNING…" : items.length < 2 ? "ADD AT LEAST 2" : `SPIN FOR ${wheel.season}`}
        </button>
      )}
      {!result && !wheel.is_commissioner && (
        <p className="rounded-xl border border-dashed border-white/15 p-3.5 text-center text-sm font-semibold text-white/50">
          Only the commissioner can spin the wheel.
        </p>
      )}
      {error && <p className="text-center text-sm text-red-400">{error}</p>}

      <div className="mt-2 flex items-baseline justify-between">
        <h2 className="font-[Oswald,sans-serif] text-sm tracking-[0.15em] text-white/50">ON THE WHEEL ({items.length})</h2>
        <span className="text-[11px] text-white/40">
          {result ? `Locked for ${wheel.season}` : wheel.can_edit ? "Commissioners and admins can edit" : "Set by the commissioner"}
        </span>
      </div>
      {wheel.can_edit && (
        <form onSubmit={(e) => void add(e)} className="flex gap-2">
          <label className="sr-only" htmlFor="new-punishment">New punishment</label>
          <input
            id="new-punishment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={80}
            placeholder="Add a punishment…"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-[#12161c] px-3 text-sm outline-none placeholder:text-white/40"
          />
          <button type="submit" disabled={!draft.trim() || busy} className="h-11 rounded-xl bg-[#39ff14] px-4 text-sm font-bold text-[#06110a] disabled:opacity-50">
            Add
          </button>
        </form>
      )}
      <ul className="overflow-hidden rounded-xl border border-white/10 bg-[#12161c]">
        {(result ? result.items.map((text, i) => ({ id: i, text })) : wheel.items).map((item, i) => (
          <li key={item.id} className="flex min-h-11 items-center gap-2.5 border-t border-white/5 px-3 first:border-t-0">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
            {wheel.can_edit && (
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                onClick={() => void run(() => call(`/items/${item.id}`, { method: "DELETE" }))}
                className="h-8 w-8 rounded-lg text-lg text-white/50 hover:bg-white/5"
              >
                ×
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="p-3.5 text-sm text-white/50">Nothing on the wheel yet.</li>}
      </ul>
    </div>
  );
}
