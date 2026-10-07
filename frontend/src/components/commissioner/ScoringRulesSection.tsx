"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getScoringCatalog,
  previewScoring,
  requestScoringStat,
  updateScoringRules,
  type CatalogStat,
  type PreviewPlayer,
  type ScoringCatalog,
} from "@/lib/leaguesApi";

// The scoring editor (2026-10, the approved "League Types & Scoring"
// mockups): every rule the league scores, tabbed the way you'd think
// about them, every value editable, changed values in gold with a live
// preview of what real players would have scored. New rules come from
// the catalog of every stat the app tracks (GET /league/scoring-catalog);
// anything it doesn't track yet can be requested.

const PRESETS: { key: string; label: string; rec: number }[] = [
  { key: "ppr", label: "PPR", rec: 1 },
  { key: "half", label: "Half PPR", rec: 0.5 },
  { key: "standard", label: "Standard", rec: 0 },
];

type Panel = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function ScoringRulesSection() {
  const [catalog, setCatalog] = useState<ScoringCatalog | null>(null);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [tab, setTab] = useState("passing");
  const [panel, setPanel] = useState<Panel>({ status: "idle" });
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<{ week: number | null; players: PreviewPlayer[] } | null>(null);

  useEffect(() => {
    getScoringCatalog()
      .then((c) => {
        const scored = Object.fromEntries(c.stats.filter((s) => s.value !== null).map((s) => [s.key, s.value as number]));
        setCatalog(c);
        setSaved(scored);
        setValues(scored);
      })
      .catch((err) => setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't load scoring rules." }));
  }, []);

  const changed = useMemo(() => Object.keys(values).filter((k) => values[k] !== saved[k]), [values, saved]);

  // Rescore real players as values change (debounced).
  useEffect(() => {
    if (!catalog) return;
    const id = setTimeout(() => {
      previewScoring(values)
        .then(setPreview)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [catalog, values]);

  async function save() {
    if (!catalog) return;
    setPanel({ status: "saving" });
    try {
      await updateScoringRules(catalog.season, Object.fromEntries(changed.map((k) => [k, values[k]])));
      setSaved(values);
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: err instanceof Error ? err.message : "Couldn't save scoring rules." });
    }
  }

  if (!catalog) {
    return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;
  }

  const showIdp = catalog.idp || catalog.stats.some((s) => s.idp && values[s.key] !== undefined);
  const groups = catalog.groups.filter((g) => g.key !== "defenders" || showIdp);
  const rows = catalog.stats.filter((s) => s.group === tab && values[s.key] !== undefined);
  const preset = PRESETS.find((p) => values.rec === p.rec)?.key ?? null;

  function set(key: string, value: number) {
    setValues((v) => ({ ...v, [key]: value }));
    setPanel({ status: "idle" });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Scoring</h2>
          <p className="text-sm text-black/50 dark:text-white/50">
            {catalog.season} season. Changes count from the current week on; past weeks keep their scores.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {panel.status === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
          {panel.status === "error" && <span className="text-sm text-red-500">{panel.message}</span>}
          <button
            onClick={save}
            disabled={panel.status === "saving" || changed.length === 0}
            className="rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {panel.status === "saving" ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Saved"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Start from</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Pill key={p.key} on={preset === p.key} onClick={() => set("rec", p.rec)}>
              {p.label}
            </Pill>
          ))}
          <Pill on={preset === null} onClick={() => {}} disabled>
            Custom
          </Pill>
        </div>
        <p className="text-xs text-black/45 dark:text-white/45">PPR, Half PPR and Standard differ only in points per catch.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">
            {groups.map((g) => (
              <button
                key={g.key}
                role="tab"
                aria-selected={tab === g.key}
                onClick={() => setTab(g.key)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  tab === g.key
                    ? "border-[var(--wl-accent)] bg-[var(--wl-accent)] text-black"
                    : "border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {rows.length === 0 && <p className="py-3 text-sm text-black/50 dark:text-white/50">Nothing here is scored yet. Add a rule below.</p>}
            {rows.map((s) => (
              <RuleRow key={s.key} stat={s} value={values[s.key]} changed={values[s.key] !== saved[s.key]} onChange={(v) => set(s.key, v)} />
            ))}
          </div>

          <button
            onClick={() => setAdding(true)}
            className="w-fit rounded-full border border-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-[color:var(--wl-accent)]"
          >
            + Add a scoring rule
          </button>
        </div>

        <Preview preview={preview} />
      </div>

      {adding && (
        <AddRuleDialog
          stats={catalog.stats.filter((s) => values[s.key] === undefined && (!s.idp || showIdp))}
          onAdd={(s) => {
            set(s.key, 1);
            setTab(s.group);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function RuleRow({ stat, value, changed, onChange }: { stat: CatalogStat; value: number; changed: boolean; onChange: (v: number) => void }) {
  // The text being typed ("0." mid-entry), resynced when the value
  // changes from outside (a preset).
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">
          {stat.label}
          {!stat.tracked && (
            <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-500 uppercase">Not tracked yet</span>
          )}
        </span>
        <span className="text-xs text-black/45 dark:text-white/45">{stat.hint}</span>
      </span>
      <input
        type="number"
        step="0.01"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && !Number.isNaN(n)) onChange(n);
        }}
        className={`w-24 rounded-lg border bg-transparent px-2 py-1.5 text-center font-mono text-sm tabular-nums ${
          changed ? "border-amber-400 text-amber-500" : value < 0 ? "border-black/10 text-red-500 dark:border-white/10" : "border-black/10 dark:border-white/10"
        }`}
      />
    </label>
  );
}

function Preview({ preview }: { preview: { week: number | null; players: PreviewPlayer[] } | null }) {
  return (
    <aside className="flex h-fit flex-col gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/[0.05] p-3.5">
      <div className="flex items-baseline justify-between text-xs text-black/55 dark:text-white/55">
        <span className="font-semibold">Live preview{preview?.week ? ` · Week ${preview.week}` : ""}</span>
        <span>real players</span>
      </div>
      {!preview?.players.length && <p className="text-sm text-black/50 dark:text-white/50">Scores show here once a week has been played.</p>}
      {preview?.players.map((p) => {
        const delta = Math.round((p.after - p.before) * 100) / 100;
        return (
          <div key={p.sleeper_player_id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{p.name}</span>
              <span className="text-xs text-black/45 dark:text-white/45">
                {p.position}
                {p.pro_team ? ` · ${p.pro_team}` : ""}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono text-base font-bold tabular-nums">{p.after.toFixed(1)}</span>
              {delta !== 0 && (
                <span className="font-mono text-xs font-bold text-amber-500 tabular-nums">
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function AddRuleDialog({ stats, onAdd, onClose }: { stats: CatalogStat[]; onAdd: (s: CatalogStat) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");
  const [customSent, setCustomSent] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = stats.filter((s) => !q || s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q) || s.group.includes(q));
  const tracked = matches.filter((s) => s.tracked);
  const untracked = matches.filter((s) => !s.tracked);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Add a scoring rule"
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-t-2xl bg-white p-4 sm:rounded-2xl dark:bg-[#151a21]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">Add a scoring rule</span>
          <button onClick={onClose} className="text-sm text-black/50 dark:text-white/50">
            Done
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stats, e.g. tackle"
          className="rounded-xl border border-[var(--wl-accent)] bg-transparent px-3 py-2.5 text-sm outline-none"
        />
        <div className="flex flex-col gap-2 overflow-y-auto">
          {tracked.length > 0 && <span className="text-[11px] font-semibold tracking-widest text-black/45 uppercase dark:text-white/45">Tracked · adds right away</span>}
          {tracked.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 rounded-xl border border-black/5 p-3 dark:border-white/5">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="text-xs text-black/45 dark:text-white/45">{s.hint}</span>
              </div>
              <button
                disabled={added.has(s.key)}
                onClick={() => {
                  onAdd(s);
                  setAdded((a) => new Set(a).add(s.key));
                }}
                className="shrink-0 rounded-full border border-[var(--wl-accent)] px-3 py-1 text-xs font-bold text-[color:var(--wl-accent)] disabled:opacity-60"
              >
                {added.has(s.key) ? "Added ✓" : "Add"}
              </button>
            </div>
          ))}
          {untracked.length > 0 && <span className="pt-1 text-[11px] font-semibold tracking-widest text-black/45 uppercase dark:text-white/45">Not tracked yet</span>}
          {untracked.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 rounded-xl border border-black/5 p-3 opacity-80 dark:border-white/5">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="text-xs text-black/45 dark:text-white/45">We don&apos;t record this one yet</span>
              </div>
              <button
                disabled={requested.has(s.key)}
                onClick={() =>
                  requestScoringStat(s.label).then(() => setRequested((r) => new Set(r).add(s.key)))
                }
                className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs font-semibold dark:border-white/15"
              >
                {requested.has(s.key) ? "Requested" : "Request"}
              </button>
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t border-black/5 pt-3 dark:border-white/5">
            <span className="text-sm font-semibold">Don&apos;t see it?</span>
            <div className="flex gap-2">
              <input
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setCustomSent(false);
                }}
                placeholder="e.g. first downs, punt return yards"
                className="min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              />
              <button
                disabled={!custom.trim() || customSent}
                onClick={() => requestScoringStat(custom.trim()).then(() => setCustomSent(true))}
                className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs font-semibold disabled:opacity-50 dark:border-white/15"
              >
                {customSent ? "Requested" : "Request"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`min-w-20 rounded-lg border px-3 py-2 text-sm font-semibold ${
        on
          ? "border-[var(--wl-accent)] bg-[color:color-mix(in_srgb,var(--wl-accent)_12%,transparent)] text-[color:var(--wl-accent)]"
          : "border-black/10 dark:border-white/10"
      } disabled:cursor-default`}
    >
      {children}
    </button>
  );
}
