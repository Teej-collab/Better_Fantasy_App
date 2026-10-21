import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// The Living Home's card pieces (the website's copy of the app's
// mobile/src/components/living/LivingCards.tsx basics). Every card sits
// in the same dark panel; `tint` colors its border and glow (the day's
// color, a warning), and `href` makes the whole card a link.

export const UP = "#39ff14";
export const DOWN = "#ff8a3d";

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function Panel({
  children,
  tint,
  href,
  label,
  className = "",
  style,
}: {
  children: ReactNode;
  tint?: string;
  href?: string;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const panelStyle: CSSProperties = {
    borderColor: tint ? withAlpha(tint, 0.45) : undefined,
    boxShadow: tint ? `0 0 24px ${withAlpha(tint, 0.08)}` : undefined,
    ...style,
  };
  const classes = `flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-[var(--wl-surface)] p-4 text-[#eceef1] ${className}`;
  if (href) {
    return (
      <Link href={href} aria-label={label} className={`${classes} transition-colors hover:border-white/25`} style={panelStyle}>
        {children}
      </Link>
    );
  }
  return (
    <section className={classes} style={panelStyle}>
      {children}
    </section>
  );
}

export function Kicker({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="text-[11px] font-bold tracking-[0.12em] uppercase" style={{ color: color ?? "#8790a0" }}>
      {children}
    </span>
  );
}

export function Row({ left, right, first }: { left: ReactNode; right: ReactNode; first?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2 text-sm ${first ? "" : "border-t border-white/10"}`}>
      <div className="min-w-0 flex-1">{left}</div>
      {typeof right === "string" ? <span className="shrink text-right font-semibold">{right}</span> : right}
    </div>
  );
}

export function Chip({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap" style={{ backgroundColor: withAlpha(color, 0.16), color }}>
      {children}
    </span>
  );
}

export function LinkText({ children, color, href }: { children: ReactNode; color: string; href: string }) {
  return (
    <Link href={href} className="self-start py-1 text-sm font-bold hover:underline" style={{ color }}>
      {children}
    </Link>
  );
}

export function Big({ children, color, className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`font-display text-[40px] leading-none font-semibold tabular-nums ${className}`} style={{ color: color ?? "#eceef1" }}>
      {children}
    </span>
  );
}

export function Small({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-xs text-[#8790a0] ${className}`}>{children}</span>;
}
