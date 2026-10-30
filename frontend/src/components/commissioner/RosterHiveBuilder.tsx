"use client";

import { Anton } from "next/font/google";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getKeeperRules, lockKeeperRules, setKeeperRules, unlockKeeperRules, type KeeperRules } from "@/lib/api";
import { getPositionMax, getRosterSlots, setPositionMax, setRosterSlots } from "@/lib/draftApi";

const anton = Anton({ weight: "400", subsets: ["latin"] });

// /commissioner/roster as the "Hive Builder" (2026-10-30 elite pass,
// mockup board B; the app's twin is mobile/src/app/commissioner/
// roster.tsx): every roster slot is a honeycomb cell — click one to
// change its count and, for a real position, the most any team can
// roster — and the keeper rules are the Keeper Vault: lit cells for how
// many each team keeps, a track for how many years in a row, an LED
// countdown to the deadline and the lock as a switch. Dark in both
// themes, like the rest of the elite screens.

const GREEN = "#39ff14";
const ORANGE = "#ff7a1a";

type Panel = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// ---- One honeycomb cell ------------------------------------------------

function HexCell({
  w,
  color,
  fill = "#121821",
  selected,
  dim,
  onClick,
  label,
  children,
}: {
  w: number;
  color: string;
  fill?: string;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  label: string;
  children: ReactNode;
}) {
  const h = w * 1.1547;
  const points = `${w / 2},2 ${w - 2},${h / 4 + 1} ${w - 2},${(3 * h) / 4 - 1} ${w / 2},${h - 2} 2,${(3 * h) / 4 - 1} 2,${h / 4 + 1}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className="relative shrink-0 transition-transform active:scale-95"
      style={{ width: w, height: h, opacity: dim ? 0.55 : 1, filter: selected ? `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 18px ${color}80)` : undefined }}
    >
      <svg width={w} height={h} className="absolute inset-0" aria-hidden="true">
        <polygon points={points} fill={selected ? "#14261a" : fill} stroke={color} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
        {selected && <polygon points={points} fill="none" stroke="rgba(255,255,255,.75)" strokeWidth=".8" strokeLinejoin="round" />}
      </svg>
      <span className="relative flex h-full flex-col items-center justify-center gap-px px-1.5">{children}</span>
    </button>
  );
}

// Rows of 4 and 3, the 3s tucked into the 4s' gaps.
function Honeycomb({ w, children }: { w: number; children: ReactNode[] }) {
  const h = w * 1.1547;
  const rows: ReactNode[][] = [];
  let i = 0;
  while (i < children.length) {
    const n = rows.length % 2 === 0 ? 4 : 3;
    rows.push(children.slice(i, i + n));
    i += n;
  }
  return (
    <div className="flex flex-col items-center py-1.5">
      {rows.map((row, r) => (
        <div key={r} className="flex justify-center gap-1.5" style={r > 0 ? { marginTop: -h / 4 + 4 } : undefined}>
          {row}
        </div>
      ))}
    </div>
  );
}

// ---- Roster slots + position caps -------------------------------------

const DEFAULT_ROSTER_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, "RB/WR/TE": 1, "D/ST": 1, K: 1, BE: 7, IR: 1 };
const SLOT_LABELS: Record<string, string> = {
  QB: "Quarterbacks",
  RB: "Running backs",
  WR: "Wide receivers",
  TE: "Tight ends",
  "RB/WR/TE": "Flex (RB/WR/TE)",
  "QB/RB/WR/TE": "Superflex (QB/RB/WR/TE)",
  "D/ST": "Defense / special teams",
  K: "Kickers",
  DL: "Defensive linemen",
  LB: "Linebackers",
  DB: "Defensive backs",
  IDP: "IDP flex (DL/LB/DB)",
  BE: "Bench",
  IR: "Injured reserve",
  TAXI: "Taxi squad",
};
const SHORT: Record<string, string> = { "RB/WR/TE": "FLEX", "QB/RB/WR/TE": "SFLEX", BE: "BENCH", TAXI: "TAXI" };
const SUB: Record<string, string> = { "RB/WR/TE": "RB·WR·TE", "QB/RB/WR/TE": "+ QB", IDP: "DL·LB·DB" };
const SLOT_COLORS: Record<string, string> = {
  QB: "#ff5d73",
  RB: "#38d9a9",
  WR: "#4dabf7",
  TE: "#ffa94d",
  "RB/WR/TE": "#b197fc",
  "QB/RB/WR/TE": "#b197fc",
  "D/ST": "#94a3b8",
  K: "#ffd43b",
  DL: "#f783ac",
  LB: "#63e6be",
  DB: "#74c0fc",
  IDP: "#da77f2",
  BE: "rgba(245,244,236,.55)",
  IR: "#ff8a9a",
  TAXI: "#e9c46a",
};
// The standard shape plus Superflex, and the IDP/taxi rows only in a
// league that uses them (league formats, 2026-10) or once added here.
const OPTIONAL_ROWS = ["DL", "LB", "DB", "IDP", "TAXI"];
function slotRows(values: Record<string, number>, added: string[]): string[] {
  const base = ["QB", "RB", "WR", "TE", "RB/WR/TE", "QB/RB/WR/TE", "D/ST", "K"];
  const uses = (k: string) => Number(values[k] ?? 0) > 0 || added.includes(k);
  const extra = OPTIONAL_ROWS.filter((k) => k !== "TAXI" && uses(k));
  return [...base, ...extra, "BE", "IR", ...(uses("TAXI") ? ["TAXI"] : [])];
}
// Only real positions get a cap (the slot label → players.position;
// see backend/app/domain/draft_autopick.py).
const SLOT_TO_POSITION: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", "D/ST": "DEF", K: "K" };
const HELD = new Set(["BE", "IR", "TAXI"]);
const MAX_SLOT = 20;
const MAX_CAP = 20;

export function RosterHiveBuilder() {
  const [saved, setSaved] = useState<{ slots: Record<string, number>; caps: Record<string, number> } | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [caps, setCaps] = useState<Record<string, number | null>>({});
  const [editable, setEditable] = useState(true);
  const [added, setAdded] = useState<string[]>([]);
  const [selected, setSelected] = useState("RB");
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<Panel>({ status: "idle" });

  useEffect(() => {
    Promise.all([getRosterSlots(), getPositionMax()])
      .then(([slotsRes, maxRes]) => {
        const slots = slotsRes.roster_slots ?? DEFAULT_ROSTER_SLOTS;
        setSaved({ slots, caps: maxRes.position_max ?? {} });
        setValues({ ...slots });
        setCaps({ ...(maxRes.position_max ?? {}) });
        setEditable(slotsRes.editable);
      })
      .catch((err) => setPanel({ status: "error", message: message(err, "Couldn't load roster settings.") }));
  }, []);

  const rows = slotRows(values, added);
  const changes = useMemo(() => {
    if (!saved) return 0;
    const keys = new Set([...Object.keys(values), ...Object.keys(saved.slots)]);
    const capKeys = new Set([...Object.keys(caps), ...Object.keys(saved.caps)]);
    return (
      [...keys].filter((k) => Number(values[k] ?? 0) !== Number(saved.slots[k] ?? 0)).length +
      [...capKeys].filter((k) => (caps[k] ?? null) !== (saved.caps[k] ?? null)).length
    );
  }, [values, caps, saved]);

  if (!saved) return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;

  const total = rows.filter((k) => k !== "IR" && k !== "TAXI").reduce((n, k) => n + Number(values[k] ?? 0), 0);
  const position = SLOT_TO_POSITION[selected];
  const count = Number(values[selected] ?? 0);
  const cap = position ? (caps[position] ?? null) : null;
  const unused = OPTIONAL_ROWS.filter((k) => !rows.includes(k));
  const cell = 84;

  function setCount(next: number) {
    setValues((v) => ({ ...v, [selected]: Math.max(0, Math.min(MAX_SLOT, next)) }));
    setPanel({ status: "idle" });
  }
  // Below the starting count a cap means nothing, so stepping down past
  // it goes to "no limit".
  function setCap(next: number | null) {
    if (!position) return;
    setCaps((c) => ({ ...c, [position]: next === null || next < Math.max(1, count) ? null : Math.min(MAX_CAP, next) }));
    setPanel({ status: "idle" });
  }

  async function save() {
    setPanel({ status: "saving" });
    try {
      const slots = Object.fromEntries(rows.map((k) => [k, Number(values[k] ?? 0)]));
      const max = Object.fromEntries(Object.entries(caps).filter((e): e is [string, number] => e[1] !== null));
      // Slot counts only save while no draft exists; caps always save.
      await Promise.all([editable ? setRosterSlots(slots) : Promise.resolve(null), setPositionMax(max)]);
      setSaved({ slots: editable ? slots : saved!.slots, caps: max });
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: message(err, "Couldn't save roster settings.") });
    }
  }

  const cells = rows.map((key) => {
    const color = SLOT_COLORS[key] ?? GREEN;
    const n = Number(values[key] ?? 0);
    const p = SLOT_TO_POSITION[key];
    const sub = p ? (caps[p] != null ? `max ${caps[p]}` : "no limit") : SUB[key];
    const on = selected === key && !adding;
    return (
      <HexCell
        key={key}
        w={cell}
        color={on ? GREEN : color}
        selected={on}
        dim={n === 0 && !on}
        label={`${SLOT_LABELS[key] ?? key}: ${n}`}
        onClick={() => {
          setSelected(key);
          setAdding(false);
        }}
      >
        <span className="text-[10px] font-extrabold tracking-[1.3px]" style={{ color: on ? GREEN : color }}>
          {SHORT[key] ?? key}
        </span>
        <span className={`${anton.className} text-[28px] leading-8 text-[#f5f4ec]`}>{n}</span>
        {sub && <span className="text-[9.5px] text-[#f5f4ec]/55">{sub}</span>}
      </HexCell>
    );
  });
  if (unused.length > 0) {
    cells.push(
      <HexCell key="+add" w={cell} color="rgba(245,244,236,.25)" fill="#0f141b" selected={adding} label="Add IDP or taxi slots" onClick={() => setAdding((a) => !a)}>
        <span className="text-[10px] font-extrabold tracking-[1.3px] text-[#f5f4ec]/75">+ ADD</span>
        <span className="text-[9.5px] text-[#f5f4ec]/55">IDP · taxi</span>
      </HexCell>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="text-center">
        <h2 className={`${anton.className} text-[32px] tracking-wide text-[#f5f4ec]`}>BUILD THE ROSTER</h2>
        <p className="text-sm text-[#f5f4ec]/70">
          Click a cell to change it. <b className="text-[#f5f4ec]">{total} players</b> per team
          {Number(values.IR ?? 0) > 0 ? `, plus ${values.IR} IR` : ""}.
        </p>
      </div>

      {!editable && (
        <p className="rounded-xl border border-yellow-400/30 bg-yellow-400/[0.08] px-3 py-2 text-xs text-[#f5f4ec]/70">
          A draft already exists for this season, so slot counts are locked. Reset the draft on the Draft page to change them. The
          most-per-roster caps can still change anytime.
        </p>
      )}

      <Honeycomb w={cell}>{cells}</Honeycomb>

      {adding ? (
        <div className="flex flex-col gap-3 rounded-[22px] border border-[#39ff14]/40 bg-[#141b23] p-4">
          <span className={`${anton.className} text-xl text-[#39ff14]`}>ADD A SLOT</span>
          <div className="flex flex-wrap gap-2">
            {unused.map((k) => (
              <button
                key={k}
                onClick={() => {
                  setAdded((a) => [...a, k]);
                  setValues((v) => ({ ...v, [k]: Math.max(1, Number(v[k] ?? 0)) }));
                  setSelected(k);
                  setAdding(false);
                }}
                className="min-h-10 rounded-full border border-[#39ff14]/50 px-3.5 text-sm font-bold text-[#39ff14]"
              >
                {SLOT_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#39ff14]/40 bg-[#141b23] p-4 shadow-[0_0_26px_rgba(57,255,20,.15)]">
          <div className="flex items-center justify-between gap-2">
            <span className={`${anton.className} truncate text-[21px] text-[#39ff14]`}>{(SLOT_LABELS[selected] ?? selected).toUpperCase()}</span>
            {changes > 0 && <span className="shrink-0 text-xs text-[#f5f4ec]/60">{`${changes} change${changes === 1 ? "" : "s"} waiting`}</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stepper
              title={HELD.has(selected) ? "Spots" : "Starting spots"}
              value={String(count)}
              disabled={!editable}
              onMinus={() => setCount(count - 1)}
              onPlus={() => setCount(count + 1)}
            />
            {position ? (
              <Stepper
                title="Most on a roster"
                value={cap === null ? "∞" : String(cap)}
                onMinus={() => setCap(cap === null ? null : cap - 1)}
                onPlus={() => setCap(cap === null ? Math.max(1, count) + 1 : cap + 1)}
              />
            ) : (
              <div className="flex items-center rounded-2xl bg-[#0f141b] px-3.5 text-xs text-[#f5f4ec]/60">
                {HELD.has(selected) ? "Held, not started." : "Not one position, so no cap."}
              </div>
            )}
          </div>
          <button
            onClick={save}
            disabled={panel.status === "saving" || changes === 0}
            className="min-h-[50px] rounded-2xl bg-[#39ff14] text-[15px] font-extrabold text-[#06110a] shadow-[0_0_18px_rgba(57,255,20,.45)] disabled:opacity-45 disabled:shadow-none"
          >
            {panel.status === "saving" ? "Saving…" : changes === 0 && panel.status === "saved" ? "Saved ✓" : "Save roster"}
          </button>
          {panel.status === "error" && <p className="text-sm text-red-400">{panel.message}</p>}
        </div>
      )}
    </section>
  );
}

function Stepper({ title, value, onMinus, onPlus, disabled }: { title: string; value: string; onMinus: () => void; onPlus: () => void; disabled?: boolean }) {
  const button = "flex size-12 items-center justify-center rounded-[15px] border border-white/15 bg-[#0d1016] text-2xl text-[#f5f4ec] disabled:cursor-not-allowed";
  return (
    <div className={`flex flex-col items-center gap-2 rounded-2xl bg-[#0f141b] px-1.5 py-3 ${disabled ? "opacity-45" : ""}`}>
      <span className="text-xs text-[#f5f4ec]/60">{title}</span>
      <div className="flex items-center gap-2">
        <button disabled={disabled} onClick={onMinus} aria-label={`${title}: one fewer`} className={button}>
          −
        </button>
        <span className={`${anton.className} min-w-[30px] text-center text-[34px] text-[#f5f4ec]`}>{value}</span>
        <button disabled={disabled} onClick={onPlus} aria-label={`${title}: one more`} className={button}>
          +
        </button>
      </div>
    </div>
  );
}

// ---- The Keeper Vault --------------------------------------------------

const YEAR_STOPS: (number | null)[] = [1, 2, 3, 4, null];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function KeeperVault() {
  const [rules, setRules] = useState<KeeperRules | null>(null);
  const [maxKeepers, setMaxKeepers] = useState(0);
  const [years, setYears] = useState<number | null>(null);
  const [deadline, setDeadline] = useState("");
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [panel, setPanel] = useState<Panel>({ status: "idle" });
  const [lockBusy, setLockBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  function apply(r: KeeperRules) {
    setRules(r);
    setMaxKeepers(r.max_keepers);
    setYears(r.max_consecutive_years);
    setDeadline(toLocalInput(r.keeper_deadline));
  }
  useEffect(() => {
    getKeeperRules()
      .then(apply)
      .catch((err) => setPanel({ status: "error", message: message(err, "Couldn't load keeper rules.") }));
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!rules) return panel.status === "error" ? <p className="text-sm text-red-500">{panel.message}</p> : null;

  const cellCount = Math.max(6, maxKeepers + 1);
  const stops = years === null || YEAR_STOPS.includes(years) ? YEAR_STOPS : [...YEAR_STOPS.slice(0, -1), years, null];
  const dirty = maxKeepers !== rules.max_keepers || years !== rules.max_consecutive_years || deadline !== toLocalInput(rules.keeper_deadline);
  const locked = !!rules.locked_at;
  const due = deadline ? new Date(deadline) : null;
  const left = due ? due.getTime() - now : 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  const led = !due ? "NO DEADLINE" : left <= 0 ? "PASSED" : `${pad(Math.floor(left / 86_400_000))} : ${pad(Math.floor((left / 3_600_000) % 24))} : ${pad(Math.floor((left / 60_000) % 60))}`;
  const dueLabel = due
    ? `PICKS DUE · ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()} · ${due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : "PICKS DUE · NOT SET";

  async function save() {
    if (!rules) return;
    setPanel({ status: "saving" });
    try {
      apply(
        await setKeeperRules({
          season: rules.season,
          max_keepers: maxKeepers,
          max_consecutive_years: years,
          keeper_deadline: deadline ? new Date(deadline).toISOString() : null,
        })
      );
      setEditingDeadline(false);
      setPanel({ status: "saved" });
    } catch (err) {
      setPanel({ status: "error", message: message(err, "Couldn't save keeper rules.") });
    }
  }

  async function toggleLock() {
    if (!rules) return;
    setLockBusy(true);
    try {
      const updated = locked ? await unlockKeeperRules(rules.season) : await lockKeeperRules(rules.season);
      // The lock shouldn't throw away edits still waiting to save.
      setRules(updated);
    } catch (err) {
      setPanel({ status: "error", message: message(err, "Couldn't change the lock.") });
    } finally {
      setLockBusy(false);
    }
  }

  const yearIndex = Math.max(0, stops.indexOf(years));
  return (
    <section className="flex flex-col gap-4">
      <div className="h-px bg-gradient-to-r from-transparent via-[#ff7a1a]/60 to-transparent" />
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-[11px] font-extrabold tracking-[2.5px] text-[#ff9a4a]">THE KEEPER VAULT · {rules.season}</span>
        <div className="mt-2 flex gap-1.5">
          {Array.from({ length: cellCount }, (_, i) => i + 1).map((n) => {
            const on = n <= maxKeepers;
            return (
              <HexCell
                key={n}
                w={52}
                color={on ? ORANGE : "rgba(245,244,236,.14)"}
                fill={on ? "#ff8a2a" : "rgba(245,244,236,.05)"}
                label={`${n} keeper${n === 1 ? "" : "s"} per team`}
                onClick={() => {
                  // Clicking the top lit cell again turns it off.
                  setMaxKeepers(n === maxKeepers ? n - 1 : n);
                  setPanel({ status: "idle" });
                }}
              >
                <span className={`${anton.className} text-[19px]`} style={{ color: on ? "#2a1102" : "rgba(245,244,236,.35)" }}>
                  {n}
                </span>
              </HexCell>
            );
          })}
        </div>
        <p className="text-sm text-[#f5f4ec]/75">
          {maxKeepers === 0 ? (
            "No keepers this season. Click a cell to allow some."
          ) : (
            <>
              Each team keeps up to <b className="text-[#ffb27a]">{maxKeepers}</b>. Click a cell to set it.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-[18px] border border-white/[0.07] bg-[#141a22] p-4">
        <span className="text-sm font-bold text-[#f5f4ec]">How long one player can stay</span>
        <div className="relative flex justify-between">
          <div className="absolute top-[13px] right-[22px] left-[22px] h-1 rounded bg-[#f5f4ec]/15">
            <div className="h-1 rounded bg-[#ff7a1a]" style={{ width: `${(yearIndex / (stops.length - 1)) * 100}%` }} />
          </div>
          {stops.map((stop, i) => {
            const current = stop === years;
            return (
              <button
                key={String(stop)}
                onClick={() => {
                  setYears(stop);
                  setPanel({ status: "idle" });
                }}
                aria-pressed={current}
                aria-label={stop === null ? "No cap on years in a row" : `${stop} year${stop === 1 ? "" : "s"} in a row`}
                className="relative flex min-w-11 flex-col items-center gap-1.5"
              >
                <span
                  className={`size-[22px] rounded-full ${yearIndex >= i ? "bg-[#ff7a1a]" : "bg-[#2a313b]"} ${current ? "shadow-[0_0_0_4px_rgba(255,122,26,.3),0_0_14px_#ff7a1a]" : ""}`}
                />
                <span className={`text-[11px] ${current ? "font-bold text-[#ffb27a]" : "text-[#f5f4ec]/60"}`}>
                  {stop === null ? "Forever" : stop === 1 ? "1 yr" : `${stop} yrs`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5 rounded-[18px] border border-[#ff7a1a]/35 bg-[#07090c] p-4 text-center">
        <span className="text-[11px] font-extrabold tracking-[1.8px] text-[#f5f4ec]/60">{dueLabel}</span>
        <span className={`${anton.className} text-[30px] tracking-[2px] text-[#ffb27a] [text-shadow:0_0_10px_rgba(255,122,26,.8)]`}>{led}</span>
        {due && left > 0 && <span className="text-[10.5px] tracking-wider text-[#f5f4ec]/45">days · hours · minutes</span>}
        {editingDeadline ? (
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              setPanel({ status: "idle" });
            }}
            aria-label="Keeper deadline"
            className="mt-1 rounded-xl border border-[#39ff14] bg-transparent px-3 py-2 text-[#f5f4ec] [color-scheme:dark]"
          />
        ) : (
          <button onClick={() => setEditingDeadline(true)} className="text-sm font-semibold text-[#39ff14]">
            {due ? "Change the deadline" : "Set a deadline"}
          </button>
        )}
      </div>

      {(dirty || panel.status === "saving") && (
        <button
          onClick={save}
          disabled={panel.status === "saving"}
          className="min-h-[50px] rounded-2xl bg-[#ff7a1a] text-[15px] font-extrabold text-[#1a0b00] disabled:opacity-60"
        >
          {panel.status === "saving" ? "Saving…" : "Save keeper rules"}
        </button>
      )}
      {panel.status === "saved" && !dirty && <p className="text-center text-sm text-[#39ff14]">Saved ✓</p>}
      {panel.status === "error" && <p className="text-sm text-red-400">{panel.message}</p>}

      <div className="flex items-center gap-3.5 rounded-[18px] border border-white/[0.07] bg-[#141a22] p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[#f5f4ec]">{locked ? "Vault is locked" : "Vault is open"}</div>
          <div className="text-xs text-[#f5f4ec]/60">
            {locked ? `Locked ${new Date(rules.locked_at as string).toLocaleString()}` : "Owners can still change their keepers"}
          </div>
        </div>
        <button
          role="switch"
          aria-checked={locked}
          aria-label="Lock keeper picks"
          disabled={lockBusy}
          onClick={toggleLock}
          className={`relative h-[34px] w-[58px] shrink-0 rounded-full transition-colors ${locked ? "bg-[#ff7a1a]" : "bg-[#2a313b]"} disabled:opacity-60`}
        >
          <span className={`absolute top-[3px] size-7 rounded-full bg-[#f5f4ec] transition-[left] ${locked ? "left-[27px]" : "left-[3px]"}`} />
        </button>
      </div>
    </section>
  );
}
