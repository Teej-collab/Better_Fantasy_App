"use client";

import { useState } from "react";
import {
  DRAFT_TYPES,
  isAvailable,
  LEAGUE_TYPES,
  MATCHUP_TYPES,
  ROSTER_PRESETS,
  TYPE_SETTINGS,
  type FormatOptions,
  type LeagueFormat,
} from "@/lib/leagueFormat";
import { updateLeagueFormat, type League } from "@/lib/leaguesApi";

/**
 * The league's format (2026-10): type, roster, matchups, draft style
 * and the type's own settings — what the Create a League flow picked.
 * Type, roster and draft style lock once the draft is set up (the
 * backend says so with a 409); head-to-head vs total points never locks.
 */
export function LeagueFormatSection({
  league,
  formats,
  onSaved,
}: {
  league: League;
  formats: FormatOptions | null;
  onSaved: (league: League) => void;
}) {
  const initial: LeagueFormat = {
    league_type: league.league_type ?? "redraft",
    matchup_type: league.matchup_type ?? "h2h",
    draft_type: league.draft_type ?? "snake",
    roster_preset: league.roster_preset ?? "standard",
    type_settings: league.type_settings ?? {},
  };
  const [draft, setDraft] = useState<LeagueFormat>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateLeagueFormat(league.id, draft);
      onSaved(updated);
      setMessage({ ok: true, text: "Saved" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Couldn't save the format." });
    } finally {
      setBusy(false);
    }
  }

  const pick = <K extends keyof LeagueFormat>(key: K, value: LeagueFormat[K]) => {
    setDraft((d) => ({ ...d, [key]: value, ...(key === "league_type" ? { type_settings: {} } : {}) }));
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-black/5 pt-3 dark:border-white/5">
      <span className="text-sm font-medium">League format</span>
      <Choice
        label="Type"
        options={LEAGUE_TYPES.map((t) => ({ key: t.key, label: t.name, available: isAvailable(formats, "league_type", t.key) || t.key === initial.league_type }))}
        value={draft.league_type}
        onChange={(v) => pick("league_type", v)}
      />
      <Choice
        label="Roster"
        options={ROSTER_PRESETS.map((r) => ({ key: r.key, label: r.label, available: isAvailable(formats, "roster_preset", r.key) || r.key === initial.roster_preset }))}
        value={draft.roster_preset}
        onChange={(v) => pick("roster_preset", v)}
      />
      {draft.league_type !== "guillotine" && (
        <Choice
          label="Matchups"
          options={MATCHUP_TYPES.map((m) => ({ key: m.key, label: m.label, available: true }))}
          value={draft.matchup_type}
          onChange={(v) => pick("matchup_type", v)}
        />
      )}
      <Choice
        label="Draft"
        options={DRAFT_TYPES.map((d) => ({ key: d.key, label: d.label, available: isAvailable(formats, "draft_type", d.key) || d.key === initial.draft_type }))}
        value={draft.draft_type}
        onChange={(v) => pick("draft_type", v)}
      />
      {TYPE_SETTINGS[draft.league_type].map((t) => {
        const limits = formats?.type_settings[draft.league_type]?.[t.key];
        return (
          <label key={t.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-black/50 dark:text-white/50">{t.title}</span>
            <input
              type="number"
              min={limits?.min}
              max={limits?.max}
              step={t.step ?? 1}
              value={draft.type_settings[t.key] ?? limits?.default ?? ""}
              onChange={(e) => pick("type_settings", { ...draft.type_settings, [t.key]: Number(e.target.value) })}
              className="w-24 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-white/10"
            />
          </label>
        );
      })}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save format"}
        </button>
        {message && <span className={`text-xs ${message.ok ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{message.text}</span>}
      </div>
      <p className="text-xs text-black/50 dark:text-white/50">
        Type, roster and draft style can change until the draft is set up. Head-to-head or total points can change any time.
      </p>
    </div>
  );
}

function Choice<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: K; label: string; available: boolean }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm text-black/50 dark:text-white/50">{label}</span>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          disabled={!o.available}
          onClick={() => onChange(o.key)}
          className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40 ${
            value === o.key
              ? "border-[var(--wl-accent)] bg-[color:color-mix(in_srgb,var(--wl-accent)_14%,transparent)] text-[color:var(--wl-accent)]"
              : "border-black/10 dark:border-white/10"
          }`}
          title={o.available ? undefined : "Coming soon"}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
