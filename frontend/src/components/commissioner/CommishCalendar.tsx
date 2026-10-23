"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass, inputClass, panelClass } from "@/components/commissioner/CommishBits";
import { commishApi, formatWhen, relative, TONES, type CalendarItem, type CommishCalendar as Data } from "@/lib/commishApi";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Season calendar (2026-10-23 overhaul, mockup 2): every league date on
// one timeline; the trade deadline changes right here with quick picks.
// Same as the app's mobile/src/app/commissioner/calendar.tsx.

const OPENS: Partial<Record<CalendarItem["key"], string>> = {
  keeper_deadline: "/commissioner/roster",
  next_keeper_deadline: "/commissioner/roster",
  waivers: "/commissioner/waivers",
  playoffs_start: "/commissioner/league",
  draft: "/draft",
};

// "2026-11-20T18:00" for a datetime-local input, in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function upcomingWeeks(data: Data): { week: number; at: string }[] {
  const now = Date.now();
  const lastRegular = data.items.find((i) => i.key === "regular_season_end")?.week ?? 14;
  return Object.entries(data.week_kickoffs)
    .map(([w, at]) => ({ week: Number(w), at }))
    .filter((k) => new Date(k.at).getTime() > now && k.week <= lastRegular)
    .slice(0, 6);
}

export function CommishCalendar() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    commishApi
      .calendar()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your calendar."));
  }, [version]);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col">
        {data.items.map((item, i) => {
          const highlight = item.key === "trade_deadline" && !item.past;
          const color = item.past ? "#5b6372" : highlight ? NAV_ACCENT : !item.at && item.editable ? TONES.yellow : "#8790a0";
          const when = item.repeats ?? (item.at ? formatWhen(item.at) : item.week ? `Week ${item.week}` : "Not set");
          const tag = item.past ? "Done" : item.repeats ? "Weekly" : item.at ? relative(item.at) : item.editable ? "Set" : "";
          const body = (
            <>
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{item.title}</span>
                <span className="text-sm text-black/55 dark:text-white/55">
                  {when}
                  {item.week && item.at && !item.repeats ? ` · Week ${item.week}` : ""}
                  {item.detail ? ` · ${item.detail}` : ""}
                </span>
              </span>
              <span className="text-xs font-bold" style={{ color }}>
                {tag}
              </span>
            </>
          );
          const boxClass = `${panelClass} my-1.5 flex flex-1 items-center gap-2 px-3 py-2.5 text-left ${item.past ? "opacity-60" : ""}`;
          return (
            <li key={item.key} className="flex gap-3.5">
              <div className="flex w-3.5 flex-col items-center">
                <span className="mt-6 size-3 rounded-full border-2" style={{ borderColor: color, backgroundColor: item.past ? color : "transparent" }} />
                {i < data.items.length - 1 && <span className="w-0.5 flex-1 bg-black/10 dark:bg-white/10" />}
              </div>
              {item.key === "trade_deadline" ? (
                <button type="button" onClick={() => setEditing(true)} className={boxClass} style={highlight ? { borderColor: `color-mix(in srgb, ${NAV_ACCENT} 45%, transparent)` } : undefined}>
                  {body}
                </button>
              ) : OPENS[item.key] ? (
                <Link href={OPENS[item.key]!} className={boxClass}>
                  {body}
                </Link>
              ) : (
                <div className={boxClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {editing && (
        <DeadlineEditor
          data={data}
          current={data.items.find((i) => i.key === "trade_deadline")?.at ?? null}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function DeadlineEditor({ data, current, onClose, onSaved }: { data: Data; current: string | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(toLocalInput(current));
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picks = upcomingWeeks(data);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const settings = await commishApi.tradeSettings();
      const deadline = value ? new Date(value).toISOString() : null;
      await commishApi.saveTradeDeadline(settings, deadline);
      if (tell) {
        await commishApi.post(
          deadline ? `Trade deadline: ${formatWhen(deadline)}` : "No trade deadline this season",
          deadline ? `Trades have to be proposed and accepted by ${formatWhen(deadline)}.` : "Trades are open all season.",
          true,
          null,
        );
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the deadline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${panelClass} flex flex-col gap-3 p-4`}>
      <div>
        <h2 className="text-lg font-extrabold">Trade deadline</h2>
        <p className="text-sm text-black/55 dark:text-white/55">No trades can be proposed or accepted after this.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {picks.map((k) => (
          <button
            key={k.week}
            type="button"
            onClick={() => setValue(toLocalInput(k.at))}
            className="min-h-11 rounded-xl border px-3.5 text-sm font-semibold"
            style={value === toLocalInput(k.at) ? { borderColor: NAV_ACCENT, backgroundColor: `color-mix(in srgb, ${NAV_ACCENT} 15%, transparent)` } : { borderColor: "rgba(127,127,127,0.3)" }}
          >
            Before Week {k.week}
          </button>
        ))}
        <button type="button" onClick={() => setValue("")} className="min-h-11 rounded-xl border px-3.5 text-sm font-semibold" style={!value ? { borderColor: NAV_ACCENT } : { borderColor: "rgba(127,127,127,0.3)" }}>
          No deadline
        </button>
      </div>
      <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} aria-label="Trade deadline" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} className="size-5" style={{ accentColor: "#39ff14" }} />
        Tell the league in Commish Corner
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-black/15 px-5 text-[15px] font-bold dark:border-white/15">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={busy} className={buttonClass} style={{ backgroundColor: NAV_ACCENT }}>
          {busy ? "Saving…" : "Save deadline"}
        </button>
      </div>
    </div>
  );
}
