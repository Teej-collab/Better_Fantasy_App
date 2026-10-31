import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Anton, Satisfy } from "next/font/google";

// The elite pass's shared kit (2026-10-31, canvas "Elite League Pages"),
// the web side of mobile/src/components/elite/Elite.tsx: the Hive Mark's
// look — dark glass, green neon cells, one cell lit orange — for Chug,
// Awards, the League pages and the matchup page. Fixed brand colors like
// the Punishment Wheel, not the theme accent.
const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

export const ANTON = anton.className;
export const SATISFY = satisfy.className;

export const ELITE = {
  green: "#39ff14",
  mint: "#9dff86",
  orange: "#ff7a1a",
  peach: "#ffb27a",
  cream: "#f5f4ec",
  blue: "#7dd3fc",
  card: "#141a22",
  cell: "#10151c",
  deep: "#07090c",
  line: "rgba(255,255,255,0.07)",
  soft: "rgba(245,244,236,0.65)",
  faint: "rgba(245,244,236,0.5)",
  grey: "rgba(245,244,236,0.4)",
} as const;

export const HEX_CLIP = "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** One honeycomb cell, content centered: `color` is the rim, `fill` the
 *  glass, `glow` a halo of the rim's color. `image` (an owner's profile
 *  picture) fills the cell instead of its content, and `badge` (a rank
 *  or seed) sits on its bottom edge. */
export function Hex({
  size,
  color,
  fill = ELITE.cell,
  glow = false,
  rim = 3,
  image,
  badge,
  className = "",
  style,
  children,
}: {
  size: number;
  color: string;
  fill?: string;
  glow?: boolean;
  rim?: number;
  image?: string | null;
  badge?: string | number | null;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const h = size * 1.1547;
  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ filter: glow ? `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color}66)` : undefined, ...style }}
    >
      <span className="flex items-center justify-center" style={{ width: size, height: h, clipPath: HEX_CLIP, background: color }}>
        <span
          className="flex flex-col items-center justify-center bg-cover bg-center leading-none"
          style={{
            width: size - rim * 2,
            height: h - rim * 2.3,
            clipPath: HEX_CLIP,
            backgroundColor: fill,
            backgroundImage: image ? `url("${image}")` : undefined,
          }}
        >
          {image ? null : children}
        </span>
      </span>
      {badge !== undefined && badge !== null && (
        <span
          className={`${ANTON} absolute -bottom-1 left-1/2 min-w-[22px] -translate-x-1/2 rounded-lg border px-1.5 text-center text-[11px] leading-[15px]`}
          style={{ background: ELITE.deep, borderColor: color, color: color === ELITE.grey ? ELITE.cream : color }}
        >
          {badge}
        </span>
      )}
    </span>
  );
}

/** The pages' heading: an orange script kicker over a green neon title. */
export function EliteTitle({ kicker, title, subtitle }: { kicker?: string | null; title: string; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      {kicker && (
        <span className={`${SATISFY} text-2xl leading-none`} style={{ color: ELITE.peach, textShadow: "0 0 10px rgba(255,122,26,.7)" }}>
          {kicker}
        </span>
      )}
      <h1
        className={`${ANTON} text-4xl leading-tight tracking-wide uppercase sm:text-5xl`}
        style={{ color: ELITE.green, textShadow: "0 0 8px rgba(57,255,20,.8), 0 0 22px rgba(57,255,20,.4)" }}
      >
        {title}
      </h1>
      {subtitle && <p className="mt-1 max-w-xl text-sm text-black/60 dark:text-white/60">{subtitle}</p>}
    </div>
  );
}

/** A section label in Anton. */
export function EliteLabel({ children, color, className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <h2 className={`${ANTON} text-[22px] leading-tight tracking-wide uppercase ${className}`} style={color ? { color } : undefined}>
      {children}
    </h2>
  );
}

const TONES: Record<"plain" | "green" | "orange" | "deep", CSSProperties> = {
  plain: { background: ELITE.card, border: `1px solid ${ELITE.line}` },
  green: { background: ELITE.card, border: "1px solid rgba(57,255,20,.4)", boxShadow: "0 0 26px rgba(57,255,20,.12)" },
  orange: {
    background: "linear-gradient(180deg, rgba(255,122,26,.14), rgba(13,16,22,.2)), #121820",
    border: `2px solid ${ELITE.orange}`,
    boxShadow: "0 0 34px rgba(255,122,26,.28)",
  },
  deep: { background: ELITE.deep, border: "1px solid rgba(255,122,26,.45)", boxShadow: "0 0 24px rgba(255,122,26,.15)" },
};

/** A glass card: plain, `green` (lit), `orange` (the hero) or `deep`
 *  (the black LED plates). Always dark, whatever the theme. */
export function EliteCard({
  tone = "plain",
  className = "",
  style,
  children,
}: {
  tone?: "plain" | "green" | "orange" | "deep";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-[22px] text-[#f5f4ec] ${className}`} style={{ ...TONES[tone], ...style }}>
      {children}
    </div>
  );
}

/** A small stat tile: a big Anton value over a caption. */
export function StatTile({ value, caption, color = ELITE.cream, borderColor }: { value: string; caption: string; color?: string; borderColor?: string }) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center rounded-[14px] px-1 py-2.5 text-center"
      style={{ background: ELITE.card, border: `1px solid ${borderColor ?? ELITE.line}` }}
    >
      <span className={`${ANTON} max-w-full truncate text-[22px] leading-tight`} style={{ color }}>
        {value}
      </span>
      <span className="text-[11px]" style={{ color: ELITE.soft }}>
        {caption}
      </span>
    </div>
  );
}

const CHIP = "flex min-h-9 items-center rounded-xl border px-3.5 text-[13px] font-bold whitespace-nowrap transition-colors";
const CHIP_OFF = `${CHIP} border-[rgba(57,255,20,.28)] bg-[#10151c] text-[#f5f4ec]/80 hover:border-[rgba(57,255,20,.6)]`;
const CHIP_ON = `${CHIP} border-[#39ff14] bg-[#39ff14] text-[#06110a] shadow-[0_0_14px_rgba(57,255,20,.5)]`;

/** The season chips (SeasonTabs' props), newest first, green when picked. */
export function EliteSeasonChips({
  seasons,
  activeSeason,
  hrefFor,
  extraTab,
  className = "",
}: {
  seasons: number[];
  activeSeason: number | string | null;
  hrefFor: (season: number) => string;
  extraTab?: { label: string; href: string; active: boolean };
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap justify-center gap-2 ${className}`}>
      {[...seasons]
        .sort((a, b) => b - a)
        .map((s) => {
          const on = String(s) === String(activeSeason) && !extraTab?.active;
          return (
            <Link key={s} href={hrefFor(s)} className={on ? CHIP_ON : CHIP_OFF} aria-current={on ? "page" : undefined}>
              {s}
            </Link>
          );
        })}
      {extraTab && (
        <Link href={extraTab.href} className={extraTab.active ? CHIP_ON : CHIP_OFF} aria-current={extraTab.active ? "page" : undefined}>
          {extraTab.label}
        </Link>
      )}
    </div>
  );
}

/** A chip, for client-side filters (buttons rather than links). */
export function eliteChipClass(on: boolean): string {
  return on ? CHIP_ON : CHIP_OFF;
}

const SEG = "flex min-h-10 flex-1 items-center justify-center rounded-xl px-2 text-[13px] font-bold transition-colors";
export const SEG_WRAP = "flex gap-1 rounded-2xl border border-white/[0.07] bg-[#141a22] p-1";
export const SEG_OFF = `${SEG} text-[#f5f4ec]/65 hover:text-[#f5f4ec]`;
export const SEG_ON = `${SEG} border border-[rgba(57,255,20,.6)] bg-[#0f1a12] text-[#39ff14] shadow-[0_0_12px_rgba(57,255,20,.25)]`;

/** The segmented control as links (URL-driven views). */
export function EliteSegLinks<T extends string>({ tabs, active }: { tabs: { key: T; label: string; href: string }[]; active: T }) {
  return (
    <nav className={SEG_WRAP}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === active ? SEG_ON : SEG_OFF} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A tug-of-war bar for two win chances (0–100), with a hex marker
 *  where they meet. */
export function EliteWinBar({
  left,
  right,
  leftColor,
  rightColor,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftColor: string;
  rightColor: string;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const total = left + right || 1;
  const pct = Math.max(2, Math.min(98, (left / total) * 100));
  return (
    <div role="img" aria-label={`Win chance ${Math.round(left)} percent to ${Math.round(right)} percent`}>
      <div className="relative mt-2 flex h-2.5 rounded-full">
        <span className="h-full rounded-l-full" style={{ width: `${pct}%`, background: leftColor }} />
        <span className="h-full flex-1 rounded-r-full opacity-35" style={{ background: rightColor }} />
        <span
          className="absolute -top-[5px] h-[20px] w-4 -translate-x-1/2"
          style={{ left: `${pct}%`, clipPath: HEX_CLIP, background: ELITE.cream, boxShadow: "0 0 10px #fff" }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs font-extrabold tracking-wide">
        <span style={{ color: left >= right ? leftColor : ELITE.soft }}>{leftLabel ?? `${Math.round(left)}%`}</span>
        <span style={{ color: right > left ? rightColor : ELITE.soft }}>{rightLabel ?? `${Math.round(right)}%`}</span>
      </div>
    </div>
  );
}

export type PodiumEntry = { key: string; name: string; value: string; context?: string; href?: string };

const PODIUM = [
  { place: 1, size: 50, fill: "#c9d1d9", color: "#e5e7eb" },
  { place: 0, size: 64, fill: ELITE.orange, color: ELITE.peach },
  { place: 2, size: 50, fill: "#b9875a", color: "#d6a77a" },
] as const;

/** A leaderboard as a podium: silver, gold (raised, lit) and bronze
 *  cells, then the rest as a short list. */
export function PodiumBoard({ title, description, entries, emptyMessage }: { title: string; description?: string; entries: PodiumEntry[]; emptyMessage?: string }) {
  const spots = PODIUM.filter((p) => entries[p.place]);
  const nameEl = (e: PodiumEntry, className: string) =>
    e.href ? (
      <Link href={e.href} className={`${className} hover:underline`}>
        {e.name}
      </Link>
    ) : (
      <span className={className}>{e.name}</span>
    );
  return (
    <EliteCard className="flex flex-col gap-3 p-4">
      <div>
        <EliteLabel>{title}</EliteLabel>
        {description && (
          <p className="text-xs" style={{ color: ELITE.soft }}>
            {description}
          </p>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs" style={{ color: ELITE.soft }}>
          {emptyMessage ?? "No data yet."}
        </p>
      ) : (
        <ol className="grid grid-cols-3 items-end gap-2 text-center">
          {spots.map((p) => {
            const e = entries[p.place];
            return (
              <li key={e.key} className="flex flex-col items-center gap-1">
                <Hex size={p.size} color={p.color} fill={p.fill} glow={p.place === 0}>
                  <span className={`${ANTON} text-[#10151c]`} style={{ fontSize: p.place === 0 ? 26 : 20 }}>
                    {p.place + 1}
                  </span>
                </Hex>
                {nameEl(e, "mt-1 text-[13px] font-bold")}
                <span className="text-xs" style={{ color: ELITE.soft }}>
                  {e.value}
                </span>
                {e.context && (
                  <span className="text-[10.5px] leading-snug" style={{ color: ELITE.faint }}>
                    {e.context}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {entries.length > 3 && (
        <ol className="flex flex-col">
          {entries.slice(3).map((e, i) => (
            <li key={e.key} className="flex justify-between gap-2 border-t border-white/[0.08] pt-1.5 text-xs" style={{ color: ELITE.soft }}>
              <span>
                {i + 4}. {nameEl(e, "")}
              </span>
              <span>{e.value}</span>
            </li>
          ))}
        </ol>
      )}
    </EliteCard>
  );
}

/** The glowing playoff line / dashed toilet-bowl cut between table rows. */
export function CutLine({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <li aria-hidden className="relative flex h-[34px] items-center justify-center">
      <span
        className="absolute inset-x-0 top-1/2 -translate-y-1/2"
        style={
          dashed
            ? { height: 2, background: `repeating-linear-gradient(90deg, ${color} 0 10px, transparent 10px 16px)`, boxShadow: `0 0 8px ${color}80` }
            : { height: 2, background: color, boxShadow: `0 0 10px ${color}, 0 0 20px ${color}80` }
        }
      />
      <span
        className="relative rounded-[10px] border px-3 py-1 text-[11px] font-extrabold tracking-[2px]"
        style={{ background: ELITE.deep, borderColor: color, color: dashed ? ELITE.peach : color }}
      >
        {label}
      </span>
    </li>
  );
}

/** The LED week plate between two hex arrows (the Scoreboard and the
 *  matchup page). */
export function WeekPlate({
  label,
  status,
  live,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: {
  label: string;
  status: string;
  live: boolean;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}) {
  const arrow = (dir: "‹" | "›", onClick: () => void, disabled: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "‹" ? "Previous week" : "Next week"}
      className="transition-transform hover:scale-105 disabled:pointer-events-none disabled:opacity-25"
    >
      <Hex size={42} color="rgba(57,255,20,.45)">
        <span className="text-xl font-bold" style={{ color: ELITE.green }}>
          {dir}
        </span>
      </Hex>
    </button>
  );
  return (
    <div className="flex items-center justify-center gap-4">
      {arrow("‹", onPrev, prevDisabled)}
      <EliteCard tone="deep" className="rounded-[14px] px-5 py-2 text-center">
        <div className={`${ANTON} text-[26px] leading-tight tracking-[3px]`} style={{ color: ELITE.peach, textShadow: "0 0 10px rgba(255,122,26,.8)" }}>
          {label}
        </div>
        {status && (
          <div className="text-[11px] font-extrabold tracking-[1.5px]" style={{ color: live ? ELITE.green : ELITE.faint }}>
            {status}
          </div>
        )}
      </EliteCard>
      {arrow("›", onNext, nextDisabled)}
    </div>
  );
}
