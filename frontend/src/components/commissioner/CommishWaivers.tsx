"use client";

import { useEffect, useState } from "react";
import { buttonClass, inputClass, panelClass } from "@/components/commissioner/CommishBits";
import { commishApi, formatWhen, type CommishWaivers as Data, type WaiverRules, type WaiverType } from "@/lib/commishApi";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Waivers & free agents (2026-10-23 overhaul, mockup 3): the league's
// own waiver rules. Same as the app's mobile/src/app/commissioner/waivers.tsx.

const TYPES: { value: WaiverType; label: string; help: string }[] = [
  { value: "reverse", label: "Worst first", help: "The worst record gets first claim, and the order resets every week. Whoever wins a claim drops to the back for the rest of that week." },
  { value: "rolling", label: "Rolling", help: "Whoever wins a claim goes to the back of the line and stays there week to week. The line starts in reverse standings." },
  { value: "faab", label: "FAAB bids", help: "Everyone bids from a season budget, without seeing the other bids. The highest bid wins; ties go to whoever is higher in the line." },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = [0, 3, 6, 9, 12, 18, 21];
const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="min-h-11 rounded-xl border px-3.5 text-sm font-semibold"
      style={on ? { borderColor: NAV_ACCENT, backgroundColor: `color-mix(in srgb, ${NAV_ACCENT} 15%, transparent)` } : { borderColor: "rgba(127,127,127,0.3)" }}
    >
      {children}
    </button>
  );
}

function Toggle({ title, sub, value, onChange }: { title: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
      <span className="flex flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-black/55 dark:text-white/55">{sub}</span>
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-5" style={{ accentColor: "#39ff14" }} />
    </label>
  );
}

export function CommishWaivers() {
  const [data, setData] = useState<Data | null>(null);
  const [rules, setRules] = useState<WaiverRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);

  async function load() {
    const d = await commishApi.waivers();
    setData(d);
    setRules((r) => r ?? d.settings);
  }

  useEffect(() => {
    commishApi
      .waivers()
      .then((d) => {
        setData(d);
        setRules(d.settings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your waiver rules."));
  }, []);

  if (!data || !rules) return error ? <p className="text-sm text-red-500">{error}</p> : <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;
  const set = <K extends keyof WaiverRules>(key: K, value: WaiverRules[K]) => setRules({ ...rules, [key]: value });
  const type = TYPES.find((t) => t.value === rules.waiver_type)!;

  async function save() {
    if (rules!.waiver_type === "faab" && (rules!.faab_budget < 1 || rules!.min_bid < 0 || rules!.min_bid > rules!.faab_budget)) {
      setError("The budget has to be at least $1, and the lowest bid between $0 and the budget.");
      return;
    }
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      await commishApi.saveWaivers(rules!);
      setMessage("Saved. New claims follow these rules.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your waiver rules.");
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    if (!window.confirm("Run waivers now? Every player on waivers clears right away, and every claim is decided now.")) return;
    setBusy("run");
    setError(null);
    try {
      const r = await commishApi.runWaivers();
      setMessage(`Done. ${r.players} player${r.players === 1 ? "" : "s"} cleared and ${r.claims_won} claim${r.claims_won === 1 ? "" : "s"} won.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run waivers.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={`${panelClass} flex items-center gap-3 p-4`} style={{ borderColor: `color-mix(in srgb, ${NAV_ACCENT} 45%, transparent)` }}>
        <div className="flex flex-1 flex-col">
          <span className="font-bold">
            {data.pending_claims} claim{data.pending_claims === 1 ? "" : "s"} waiting
          </span>
          <span className="text-sm text-black/55 dark:text-white/55">
            {data.players_on_waivers} player{data.players_on_waivers === 1 ? "" : "s"} on waivers
            {data.next_run_at ? ` · next clears ${formatWhen(data.next_run_at)}` : ""}
          </span>
        </div>
        <button type="button" onClick={runNow} disabled={!!busy || data.players_on_waivers === 0} className="rounded-full border px-4 py-1.5 text-sm font-bold disabled:opacity-50" style={{ borderColor: NAV_ACCENT, color: NAV_ACCENT }}>
          {busy === "run" ? "Running…" : "Run now"}
        </button>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-extrabold tracking-widest text-black/55 uppercase dark:text-white/55">How claims are decided</h2>
        <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/[0.06]">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={rules.waiver_type === t.value}
              onClick={() => set("waiver_type", t.value)}
              className="min-h-11 rounded-lg text-sm font-bold"
              style={rules.waiver_type === t.value ? { backgroundColor: NAV_ACCENT, color: "#0d1016" } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">{type.help}</p>
        {rules.waiver_type === "faab" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-black/60 dark:text-white/60">
              Season budget ($)
              <input type="number" min={1} value={rules.faab_budget} onChange={(e) => set("faab_budget", Number(e.target.value))} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-black/60 dark:text-white/60">
              Lowest bid ($)
              <input type="number" min={0} value={rules.min_bid} onChange={(e) => set("min_bid", Number(e.target.value))} className={inputClass} />
            </label>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-extrabold tracking-widest text-black/55 uppercase dark:text-white/55">When claims run (ET)</h2>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <Chip key={d} on={rules.clear_weekday === i} onClick={() => set("clear_weekday", i)}>
              {d}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {HOURS.map((h) => (
            <Chip key={h} on={rules.clear_hour === h} onClick={() => set("clear_hour", h)}>
              {hourLabel(h)}
            </Chip>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-extrabold tracking-widest text-black/55 uppercase dark:text-white/55">A dropped player waits</h2>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((d) => (
            <Chip key={d} on={rules.drop_days === d} onClick={() => set("drop_days", d)}>
              {d === 0 ? "No wait" : `${d} day${d === 1 ? "" : "s"}`}
            </Chip>
          ))}
        </div>
      </section>

      <div className={`${panelClass} divide-y divide-black/5 dark:divide-white/[0.08]`}>
        <Toggle title="Hold players once their game starts" sub="They stay on waivers until the next run, so nobody grabs a player mid-game." value={rules.hold_played} onChange={(v) => set("hold_played", v)} />
        <Toggle title="Post results in Commish Corner" sub="After each run, who claimed whom (and for how much)." value={rules.post_results} onChange={(v) => set("post_results", v)} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {message && <p className="text-sm text-emerald-500">{message}</p>}
      <button type="button" onClick={save} disabled={!!busy} className={buttonClass} style={{ backgroundColor: NAV_ACCENT }}>
        {busy === "save" ? "Saving…" : "Save waiver rules"}
      </button>
    </div>
  );
}
