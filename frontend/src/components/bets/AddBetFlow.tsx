"use client";

import { useRef, useState } from "react";
import {
  BET_STATS,
  createBet,
  imageFileToBase64,
  parseSlip,
  type Bet,
  type BetDirection,
  type BetMarket,
  type DraftBet,
  type DraftLeg,
} from "@/lib/betsApi";

// Add a bet: upload a bet-slip screenshot (read by Claude on the server,
// then thrown away) or type it in, check every leg, save. Nothing is
// saved until the user confirms.

const EMPTY_LEG: DraftLeg = {
  description: "",
  market: "player_prop",
  player_name: "",
  team_abbr: "",
  stat_key: "rush_yd",
  line: null,
  direction: "over",
  odds_american: null,
};

const MARKETS: { key: BetMarket; label: string }[] = [
  { key: "player_prop", label: "Player prop" },
  { key: "spread", label: "Spread" },
  { key: "moneyline", label: "Moneyline" },
  { key: "total", label: "Game total" },
  { key: "other", label: "Other" },
];

export function AddBetFlow({ onSaved, onCancel }: { onSaved: (bet: Bet) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<DraftBet | null>(null);
  const [source, setSource] = useState<"screenshot" | "manual">("manual");
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readScreenshot(file: File) {
    setError(null);
    setBusy("reading");
    try {
      const { base64, mediaType } = await imageFileToBase64(file);
      const parsed = await parseSlip(base64, mediaType);
      setSource("screenshot");
      setDraft({ ...parsed, legs: parsed.legs.map((l) => ({ ...EMPTY_LEG, ...l })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that slip.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setBusy("saving");
    try {
      const legs = draft.legs.map((l) => ({
        ...l,
        description: l.description.trim() || describe(l),
        player_name: l.player_name?.trim() || null,
        team_abbr: l.team_abbr?.trim().toUpperCase() || null,
      }));
      onSaved(await createBet({ ...draft, legs, source }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that bet.");
    } finally {
      setBusy(null);
    }
  }

  function updateLeg(i: number, patch: Partial<DraftLeg>) {
    setDraft((d) => (d ? { ...d, legs: d.legs.map((l, j) => (j === i ? { ...l, ...patch, matched: undefined } : l)) } : d));
  }

  if (!draft) {
    return (
      <div className="wl-card flex flex-col gap-4 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a bet</h2>
          <button type="button" onClick={onCancel} className="text-sm text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80">
            Cancel
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && readScreenshot(e.target.files[0])}
        />
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-black/15 px-4 py-8 text-center hover:border-[var(--wl-accent-dim)] disabled:opacity-60 dark:border-white/15"
        >
          <span className="text-2xl" aria-hidden>
            🧾
          </span>
          <span className="font-semibold">{busy === "reading" ? "Reading your slip…" : "Upload a bet-slip screenshot"}</span>
          <span className="text-xs text-black/50 dark:text-white/50">
            Any sportsbook. The screenshot is read and then thrown away — only the legs you confirm are saved.
          </span>
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setSource("manual");
            setDraft({ sportsbook: null, stake: null, odds_american: null, payout: null, legs: [{ ...EMPTY_LEG }] });
          }}
          className="text-sm font-medium text-[var(--wl-accent-dim)] hover:underline"
        >
          Or enter it by hand
        </button>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="wl-card flex flex-col gap-4 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{source === "screenshot" ? "Check your slip" : "Enter your bet"}</h2>
        <button type="button" onClick={onCancel} className="text-sm text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80">
          Cancel
        </button>
      </div>
      {source === "screenshot" && (
        <p className="text-xs text-black/50 dark:text-white/50">Make sure every leg matches your slip before saving.</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Sportsbook">
          <input value={draft.sportsbook ?? ""} onChange={(e) => setDraft({ ...draft, sportsbook: e.target.value })} className={inputClass} placeholder="DraftKings" />
        </Field>
        <Field label="Wager ($)">
          <input type="number" inputMode="decimal" min={0} value={draft.stake ?? ""} onChange={(e) => setDraft({ ...draft, stake: num(e.target.value) })} className={inputClass} />
        </Field>
        <Field label="Odds">
          <input type="number" inputMode="numeric" value={draft.odds_american ?? ""} onChange={(e) => setDraft({ ...draft, odds_american: num(e.target.value) })} className={inputClass} placeholder="+450" />
        </Field>
        <Field label="Payout ($)">
          <input type="number" inputMode="decimal" min={0} value={draft.payout ?? ""} onChange={(e) => setDraft({ ...draft, payout: num(e.target.value) })} className={inputClass} placeholder="Auto" />
        </Field>
      </div>

      <ol className="flex flex-col gap-3">
        {draft.legs.map((leg, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                Leg {i + 1}
                {leg.matched === false && <span className="ml-2 normal-case text-amber-500">· game not found this week</span>}
              </span>
              {draft.legs.length > 1 && (
                <button type="button" onClick={() => setDraft({ ...draft, legs: draft.legs.filter((_, j) => j !== i) })} className="text-xs text-red-500 hover:underline">
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Field label="Type" className="col-span-2 sm:col-span-2">
                <select value={leg.market} onChange={(e) => updateLeg(i, { market: e.target.value as BetMarket, direction: defaultDirection(e.target.value as BetMarket) })} className={inputClass}>
                  {MARKETS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              {leg.market === "player_prop" && (
                <>
                  <Field label="Player" className="col-span-2 sm:col-span-3">
                    <input value={leg.player_name ?? ""} onChange={(e) => updateLeg(i, { player_name: e.target.value })} className={inputClass} placeholder="Jahmyr Gibbs" />
                  </Field>
                  <Field label="Team">
                    <input value={leg.team_abbr ?? ""} onChange={(e) => updateLeg(i, { team_abbr: e.target.value })} className={inputClass} placeholder="DET" maxLength={4} />
                  </Field>
                  <Field label="Stat" className="col-span-2 sm:col-span-3">
                    <select value={leg.stat_key ?? ""} onChange={(e) => updateLeg(i, { stat_key: e.target.value, direction: e.target.value === "anytime_td" ? "yes" : leg.direction === "yes" ? "over" : leg.direction })} className={inputClass}>
                      {BET_STATS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {(leg.market === "spread" || leg.market === "moneyline") && (
                <Field label="Team" className="col-span-2 sm:col-span-2">
                  <input value={leg.team_abbr ?? ""} onChange={(e) => updateLeg(i, { team_abbr: e.target.value })} className={inputClass} placeholder="KC" maxLength={4} />
                </Field>
              )}
              {leg.market === "total" && (
                <Field label="Either team" className="col-span-2 sm:col-span-2">
                  <input value={leg.team_abbr ?? ""} onChange={(e) => updateLeg(i, { team_abbr: e.target.value })} className={inputClass} placeholder="KC" maxLength={4} />
                </Field>
              )}
              {(leg.market === "player_prop" || leg.market === "total") && (
                <Field label="Pick">
                  <select value={leg.direction ?? "over"} onChange={(e) => updateLeg(i, { direction: e.target.value as BetDirection })} className={inputClass}>
                    {leg.stat_key === "anytime_td" && leg.market === "player_prop" ? (
                      <>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </>
                    ) : (
                      <>
                        <option value="over">Over</option>
                        <option value="under">Under</option>
                      </>
                    )}
                  </select>
                </Field>
              )}
              {leg.market !== "moneyline" && leg.market !== "other" && (
                <Field label={leg.stat_key === "anytime_td" && leg.market === "player_prop" ? "TDs needed" : "Line"}>
                  <input type="number" inputMode="decimal" step="0.5" value={leg.line ?? ""} onChange={(e) => updateLeg(i, { line: num(e.target.value) })} className={inputClass} placeholder={leg.stat_key === "anytime_td" ? "1" : "79.5"} />
                </Field>
              )}
              {leg.market === "other" && (
                <Field label="What's the bet?" className="col-span-2 sm:col-span-4">
                  <input value={leg.description} onChange={(e) => updateLeg(i, { description: e.target.value })} className={inputClass} placeholder="First TD scorer: Amon-Ra St. Brown" />
                </Field>
              )}
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setDraft({ ...draft, legs: [...draft.legs, { ...EMPTY_LEG }] })}
        className="self-start text-sm font-medium text-[var(--wl-accent-dim)] hover:underline"
      >
        + Add a leg
      </button>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => setDraft(null)} className="rounded-full px-4 py-2 text-sm text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10">
          Back
        </button>
        <button
          type="button"
          disabled={busy !== null || draft.legs.length === 0}
          onClick={save}
          className="rounded-full bg-[var(--wl-accent)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
        >
          {busy === "saving" ? "Saving…" : "Save bet"}
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/15 dark:bg-white/[0.03]";

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-medium text-black/50 dark:text-white/50">{label}</span>
      {children}
    </label>
  );
}

function num(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function defaultDirection(market: BetMarket): BetDirection | null {
  return market === "player_prop" || market === "total" ? "over" : null;
}

function describe(leg: DraftLeg): string {
  const stat = BET_STATS.find((s) => s.key === leg.stat_key)?.label ?? "";
  if (leg.market === "player_prop") return `${leg.player_name ?? ""} ${leg.direction ?? ""} ${leg.line ?? ""} ${stat}`.trim();
  if (leg.market === "spread") return `${leg.team_abbr ?? ""} ${leg.line ?? ""}`.trim();
  if (leg.market === "moneyline") return `${leg.team_abbr ?? ""} moneyline`.trim();
  if (leg.market === "total") return `${leg.direction ?? ""} ${leg.line ?? ""} total points`.trim();
  return "Bet";
}
