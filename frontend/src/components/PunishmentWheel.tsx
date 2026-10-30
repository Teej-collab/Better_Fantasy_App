"use client";

import Image from "next/image";
import { Anton, Satisfy } from "next/font/google";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { seasonalEmblem } from "@/lib/seasonal";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

// The Punishment Wheel (2026-10) — the web twin of the app's
// mobile/src/app/punishment-wheel.tsx. It turns slowly, game-show style,
// until a commissioner spins it; the server picks where it lands
// (backend/app/routers/punishment_wheel.py), and anyone opening it after
// the spin watches the same spin once before the result is revealed.
//
// The look is the "Neon Hive" (2026-10-30 elite pass, mockup board B):
// dark glass slices edged in neon green around the Hive Mark; when it
// lands, the winning slice lights orange like the logo's lit cell, the
// rest dim, hex confetti bursts off the pointer (.pw-confetti in
// globals.css) and the verdict card glows orange.

type Wheel = {
  season: number;
  items: { id: number; text: string; can_remove: boolean }[];
  result: { text: string; landed_index: number; items: string[]; spun_at: string; spun_by: string | null } | null;
  can_edit: boolean;
  can_spin: boolean;
  is_commissioner: boolean;
};

const GREEN = "#39ff14";
const ORANGE = "#ff7a1a";
const GLASS = ["#11161d", "#0b0f14"];
const CONFETTI: [number, number, string][] = [
  [-120, -30, GREEN],
  [110, -50, ORANGE],
  [-70, 90, GREEN],
  [140, 40, "#ffd0a0"],
  [-150, 40, ORANGE],
  [60, -100, GREEN],
  [-30, -110, "#ffd0a0"],
  [90, 110, ORANGE],
];
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

// Labels run from the hub out to the rim, wrapped onto a few lines and
// sized by slice count (same rules as the app's wheel).
const R = 150;
const HUB_CLEAR = 42;
const RIM_CLEAR = 14;

function labelStyle(n: number): { fontSize: number; maxLines: number } {
  const fontSize = n <= 4 ? 14 : n <= 6 ? 13 : n <= 9 ? 12 : 11;
  const chord = 2 * (HUB_CLEAR + 8) * Math.sin(Math.PI / Math.max(n, 2));
  const maxLines = Math.max(1, Math.min(4, Math.floor(chord / (fontSize * 1.15))));
  return { fontSize, maxLines };
}

function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const clipped = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
  if (lines.length > maxLines) {
    // Cut at a word break and drop trailing punctuation before the ellipsis.
    let last = clipped[maxLines - 1].replace(/…$/, "").slice(0, maxChars - 1);
    if (last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
    clipped[maxLines - 1] = `${last.replace(/[\s.,;:!?-]+$/, "")}…`;
  }
  return clipped;
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
  const [burst, setBurst] = useState(0);
  // "Watch it again" replays without the "you missed it" note.
  const [again, setAgain] = useState(false);
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
        setBurst((b) => b + 1);
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
  const label = labelStyle(n);
  const band = R - HUB_CLEAR - RIM_CLEAR;
  const maxChars = Math.max(6, Math.floor(band / (label.fontSize * 0.6)));
  const landed = result && phase === "done" ? result.landed_index : null;
  const sliceColor = (i: number) => (landed === i ? ORANGE : landed === null ? GLASS[i % 2] : i % 2 ? "#080b0f" : "#0c1015");
  const gradient = items.length
    ? `conic-gradient(from 0deg, ${items.map((_, i) => `${landed === i || landed === i - 1 || (landed === n - 1 && i === 0) ? "#ffd0a0" : "rgba(57,255,20,0.75)"} ${i * seg}deg ${i * seg + 0.8}deg, ${sliceColor(i)} ${i * seg + 0.8}deg ${(i + 1) * seg}deg`).join(", ")})`
    : GLASS[0];
  const spinning = phase === "spinning" || phase === "replaying";

  // Watch it again: the same spin, from where it rests now.
  function replay() {
    if (!result) return;
    setAgain(true);
    setPhase("replaying");
    spinTo(result.landed_index, result.items.length, `wl:wheel-seen:${leagueId}:${wheel!.season}:${result.spun_at}`, 30);
  }
  const transition = spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.62, 0.08, 1)` : "none";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-12 text-[#eceef1]">
      <div className="text-center">
        <p className={`${satisfy.className} text-[28px] leading-none text-[#ffb27a] [text-shadow:0_0_10px_rgba(255,122,26,0.7)]`}>The {wheel.season}</p>
        <h1 className={`${anton.className} text-4xl tracking-wide text-[#39ff14] [text-shadow:0_0_8px_rgba(57,255,20,0.8),0_0_22px_rgba(57,255,20,0.4)]`}>
          PUNISHMENT WHEEL
        </h1>
      </div>

      <div className="relative flex h-[340px] items-center justify-center">
        <div className="absolute h-[316px] w-[316px] rounded-full border border-[#39ff14]/20" />
        <svg width="44" height="50" className="absolute top-0 z-10" aria-hidden="true">
          <polygon points="22,46 7,18 7,6 37,6 37,18" fill="none" stroke={landed !== null ? ORANGE : GREEN} strokeWidth="10" strokeOpacity=".18" strokeLinejoin="round" />
          <polygon points="22,46 7,18 7,6 37,6 37,18" fill="#0d1016" stroke={landed !== null ? ORANGE : GREEN} strokeWidth="3" strokeLinejoin="round" />
        </svg>
        {burst > 0 &&
          CONFETTI.map(([x, y, c], i) => (
            <i key={`${burst}-${i}`} className="pw-confetti" style={{ "--x": `${x}px`, "--y": `${y}px`, background: c } as CSSProperties} />
          ))}
        <div className="relative h-[300px] w-[300px]">
          <div
            className={`absolute inset-0 overflow-hidden rounded-full border-[3px] transition-[border-color,box-shadow] duration-500 ${
              landed !== null
                ? "border-[#ff7a1a] shadow-[0_0_8px_#ff7a1a,0_0_28px_rgba(255,122,26,0.5),inset_0_0_30px_rgba(0,0,0,0.55)]"
                : "border-[#39ff14] shadow-[0_0_8px_#39ff14,0_0_28px_rgba(57,255,20,0.45),inset_0_0_30px_rgba(0,0,0,0.55)]"
            }`}
            style={{ background: gradient, transform: `rotate(${rotation}deg)`, transition }}
          >
            {items.map((text, i) => (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 flex flex-col items-center font-extrabold leading-[1.15] [text-shadow:0_0_3px_rgba(0,0,0,0.8),0_1px_2px_rgba(0,0,0,0.6)]"
                style={{
                  width: band,
                  fontSize: label.fontSize,
                  color: landed === i ? "#fff" : "#eaffdf",
                  opacity: landed === null || landed === i ? 1 : 0.45,
                  transformOrigin: "0 0",
                  transform: `rotate(${i * seg + seg / 2 - 90}deg) translateX(${HUB_CLEAR}px) translateY(-50%)`,
                }}
              >
                {wrapLabel(text, maxChars, label.maxLines).map((line, k) => (
                  <span key={k} className="whitespace-nowrap">{line}</span>
                ))}
              </span>
            ))}
          </div>
          <div className="absolute left-1/2 top-1/2 -ml-[46px] -mt-[46px] flex h-[92px] w-[92px] items-center justify-center rounded-full border-2 border-[#39ff14]/60 bg-[#07090c] shadow-[0_0_18px_rgba(57,255,20,0.4)]">
            <Image src={seasonalEmblem()} alt="The Weekend" width={82} height={82} />
          </div>
        </div>
      </div>

      {phase === "replaying" && !again && (
        <p className="rounded-xl border border-[#a855f7] bg-[#1b1230] p-3 text-center text-sm font-semibold text-[#e9d5ff]">
          You missed the spin — here&apos;s how it went…
        </p>
      )}

      {result && phase === "done" && (
        <div className="pw-verdict flex flex-col gap-2">
          <section
            aria-live="polite"
            className="flex flex-col items-center gap-2 rounded-[22px] border-2 border-[#ff7a1a] bg-[linear-gradient(180deg,rgba(255,122,26,0.16),rgba(13,16,22,0.2)),#121820] px-4 py-[18px] text-center shadow-[0_0_0_1px_rgba(255,122,26,0.3),0_0_34px_rgba(255,122,26,0.35)]"
          >
            <span className={`${anton.className} flex gap-[7px] text-[15px] tracking-[3px] text-[#ffb27a]`}>
              {["THE", "WHEEL", "HAS", "SPOKEN"].map((w, i) => (
                <span key={w} className="pw-word" style={{ animationDelay: `${150 + i * 120}ms` }}>
                  {w}
                </span>
              ))}
            </span>
            <span className={`${anton.className} text-[32px] leading-tight text-white [text-shadow:0_0_14px_rgba(255,122,26,0.7)]`}>{result.text.toUpperCase()}</span>
            <span className="text-[13px] text-white/75">
              Locked for {wheel.season}
              {result.spun_by ? ` · spun by ${result.spun_by}` : ""} · last place owes it
            </span>
          </section>
          <button type="button" onClick={replay} className="h-[46px] rounded-2xl border border-white/20 text-[15px] font-bold hover:bg-white/5">
            Watch it again
          </button>
        </div>
      )}

      {!result && wheel.is_commissioner && (
        <button
          type="button"
          onClick={() => {
            // Spinning is final for the season, so it asks first.
            if (window.confirm(`Spin for ${wheel.season}?\n\nWherever it lands is locked in as this season's punishment. You can't re-spin or change the wheel after.`)) {
              void spin();
            }
          }}
          disabled={!wheel.can_spin || phase === "spinning"}
          className={`${anton.className} h-14 rounded-2xl border-2 border-[#39ff14] bg-[#39ff14] text-[22px] tracking-[0.1em] text-[#06110a] shadow-[0_0_24px_rgba(57,255,20,0.45)] disabled:bg-transparent disabled:text-[#39ff14] disabled:opacity-60 disabled:shadow-none`}
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
          {result ? `Locked for ${wheel.season}` : "Anyone in the league can add one"}
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
        {(result ? result.items.map((text, i) => ({ id: i, text, can_remove: false })) : wheel.items).map((item, i) => (
          <li key={item.id} className="flex min-h-11 items-center gap-2.5 border-t border-white/5 px-3 first:border-t-0">
            <svg width="12" height="14" className="shrink-0" aria-hidden="true">
              <polygon points="6,1 11,4 11,10 6,13 1,10 1,4" fill={landed === i ? ORANGE : "none"} stroke={landed === i ? ORANGE : GREEN} strokeWidth="1.5" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
            {item.can_remove && (
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
