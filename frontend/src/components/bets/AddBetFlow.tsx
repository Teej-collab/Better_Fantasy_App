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
import { ToggleRow } from "@/components/settings/ToggleRow";

// Add a bet: upload a bet-slip screenshot (read by Claude on the server,
// then thrown away) or type it in. Every bet on the screenshot gets a
// "Does this look right?" card: a clean read saves with one click, and
// anything the reader wasn't sure of opens in the editor with those legs
// marked. Nothing is saved until the user confirms.

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

// One bet read off a screenshot, on the "Does this look right?" list.
type Slip = { draft: DraftBet; ready: boolean; saved: boolean };

function cleanLegs(draft: DraftBet): DraftBet {
  return {
    ...draft,
    legs: draft.legs.map((l) => ({
      ...l,
      description: l.description.trim() || describe(l),
      player_name: l.player_name?.trim() || null,
      team_abbr: l.team_abbr?.trim().toUpperCase() || null,
    })),
  };
}

// onSaved runs for each bet saved (a screenshot can hold several);
// onDone once they're all in.
export function AddBetFlow({ onSaved, onDone, onCancel }: { onSaved: (bet: Bet) => void; onDone: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<DraftBet | null>(null);
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [source, setSource] = useState<"screenshot" | "manual">("manual");
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // New bets go to league chat unless you switch it off; the wager and
  // payout never do.
  const [share, setShare] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readScreenshot(file: File) {
    setError(null);
    setBusy("reading");
    try {
      const { base64, mediaType } = await imageFileToBase64(file);
      const parsed = await parseSlip(base64, mediaType);
      setSource("screenshot");
      const read = (parsed.bets ?? [parsed]).map((b) => ({
        draft: { ...b, legs: b.legs.map((l) => ({ ...EMPTY_LEG, ...l })) },
        ready: b.ready ?? false,
        saved: false,
      }));
      setSlips(read);
      // One bet that needs fixing goes straight to the editor.
      if (read.length === 1 && !read[0].ready) {
        setEditing(0);
        setDraft(read[0].draft);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that slip.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Saves the given slips (by index) as they are; the rest stay on the list.
  async function saveSlips(indexes: number[]) {
    if (!slips) return;
    setError(null);
    setBusy("saving");
    const next = [...slips];
    try {
      for (const i of indexes) {
        onSaved(await createBet({ ...cleanLegs(next[i].draft), source: "screenshot", share }));
        next[i] = { ...next[i], saved: true };
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that bet.");
    } finally {
      setSlips(next);
      setBusy(null);
    }
    if (next.every((x) => x.saved)) onDone();
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setBusy("saving");
    try {
      onSaved(await createBet({ ...cleanLegs(draft), source, share }));
      if (slips && editing !== null) {
        const next = slips.map((x, i) => (i === editing ? { ...x, draft, saved: true } : x));
        setSlips(next);
        setEditing(null);
        setDraft(null);
        if (next.every((x) => x.saved)) onDone();
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that bet.");
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setDraft(null);
    setEditing(null);
    setSlips(null);
    setError(null);
  }

  function updateLeg(i: number, patch: Partial<DraftLeg>) {
    setDraft((d) =>
      d ? { ...d, legs: d.legs.map((l, j) => (j === i ? { ...l, ...patch, matched: undefined, needs_check: undefined } : l)) } : d
    );
  }

  if (!draft && slips) {
    const readyToSave = slips.map((x, i) => (x.ready && !x.saved ? i : -1)).filter((i) => i >= 0);
    return (
      <div className="wl-card flex flex-col gap-4 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Does this look right?</h2>
          <button type="button" onClick={onCancel} className="text-sm text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80">
            {slips.some((x) => x.saved) ? "Done" : "Cancel"}
          </button>
        </div>
        <p className="text-xs text-black/50 dark:text-white/50">
          {slips.length === 1 ? "Here’s what your slip says." : `Found ${slips.length} bets on your slip.`}
        </p>
        {slips.map((slip, i) => (
          <SlipCard
            key={i}
            slip={slip}
            busy={busy !== null}
            onConfirm={() => void saveSlips([i])}
            onFix={() => {
              setEditing(i);
              setDraft(slip.draft);
            }}
          />
        ))}
        <ToggleRow
          label="Share with my league"
          description={share ? "Posts the picks to league chat. Your wager and payout stay private." : "Only you will see this bet."}
          checked={share}
          onChange={setShare}
        />
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={startOver} className="rounded-full px-4 py-2 text-sm text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10">
            Start over
          </button>
          {readyToSave.length > 1 && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveSlips(readyToSave)}
              className="rounded-full bg-[var(--wl-accent)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
            >
              {busy === "saving" ? "Saving…" : `✓ Save All ${readyToSave.length}`}
            </button>
          )}
        </div>
      </div>
    );
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
            Any sportsbook, one bet or several. The screenshot is read and then thrown away — only the bets you confirm are saved.
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
                {leg.matched === false ? (
                  <span className="ml-2 normal-case text-amber-500">· game not found this week</span>
                ) : leg.needs_check ? (
                  <span className="ml-2 normal-case text-amber-500">· check this leg</span>
                ) : null}
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

      <ToggleRow
        label="Share with my league"
        description={share ? "Posts the picks to league chat. Your wager and payout stay private." : "Only you will see this bet."}
        checked={share}
        onChange={setShare}
      />
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            if (slips && slips.length > 1) {
              setDraft(null);
              setEditing(null);
            } else startOver();
          }}
          className="rounded-full px-4 py-2 text-sm text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
        >
          {slips && slips.length > 1 ? "Back to your slip" : "Back"}
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

function SlipCard({ slip, busy, onConfirm, onFix }: { slip: Slip; busy: boolean; onConfirm: () => void; onFix: () => void }) {
  const d = slip.draft;
  const odds = d.odds_american === null ? null : d.odds_american > 0 ? `+${d.odds_american}` : String(d.odds_american);
  const head = [d.sportsbook, d.stake !== null ? `$${d.stake}` : "Wager?", odds ?? (d.payout !== null ? `pays $${d.payout}` : "Odds?")]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10 ${slip.saved ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          {d.legs.length > 1 ? `${d.legs.length}-leg parlay` : "Straight bet"}
        </span>
        {slip.saved && <span className="text-xs font-semibold text-[var(--wl-accent-dim)]">Saved ✓</span>}
      </div>
      <p className="font-semibold">{head}</p>
      <ul className="flex flex-col gap-0.5 text-sm">
        {d.legs.map((l, j) => (
          <li key={j}>
            {l.needs_check || l.matched === false ? "⚠️ " : "• "}
            {l.description.trim() || describe(l)}
          </li>
        ))}
      </ul>
      {!slip.saved &&
        (slip.ready ? (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onConfirm} className="flex-1 rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
              ✓ Looks Right
            </button>
            <button type="button" disabled={busy} onClick={onFix} className="flex-1 rounded-full border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/15">
              ✗ Fix It
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-amber-500">Some of this needs a quick look before it&apos;s saved.</p>
            <button type="button" disabled={busy} onClick={onFix} className="rounded-full border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/15">
              Check It
            </button>
          </>
        ))}
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
