"use client";

import Image from "next/image";
import { useId } from "react";
import { Anton, Satisfy } from "next/font/google";
import { seasonalEmblem } from "@/lib/seasonal";

// The Lounge's banners (2026-10-29 "Lounge Camera Ring" mockups): the
// brand green with a white honeycomb, "Presented by" over "The WEEKEND"
// in the logo's own fonts (orange, dark outline so it reads on green),
// the logo, and where to ask about sponsoring. They fill whatever space
// the cameras haven't taken yet, so each size lays the same pieces out
// for its shape. One light sweep crosses each now and then; nothing else
// moves, so a room full of them stays smooth.

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

export const SPONSOR_EMAIL = "theweekend.admin@gmail.com";

export type BannerShape = "tall" | "mid" | "small" | "wide" | "strip";

export function LoungeBanner({ shape, delay = 0, className = "", style }: { shape: BannerShape; delay?: number; className?: string; style?: React.CSSProperties }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div
      className={`lounge-banner relative min-h-0 overflow-hidden rounded-[14px] ${className}`}
      style={style}
      role="img"
      aria-label={`Presented by The Weekend. Sponsorship inquiries: ${SPONSOR_EMAIL}`}
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern id={`hx${id}`} width="20.78" height="36" patternUnits="userSpaceOnUse">
            <path d="M10.39 0L20.78 6V18L10.39 24L0 18V6Z M10.39 24V36" fill="none" stroke="rgba(255,255,255,.62)" strokeWidth="1.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#hx${id})`} />
      </svg>
      <i className="lounge-banner-sweep" style={{ animationDelay: `${delay}s` }} aria-hidden="true" />
      <div aria-hidden="true" className="relative h-full">
        {shape === "tall" && (
          <div className="flex h-full flex-col items-center justify-between px-2.5 py-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <Pill>Presented by:</Pill>
              <Name the={36} weekend={36} stacked />
            </div>
            <Logo size={104} />
            <div className="flex flex-col items-center gap-1.5">
              <Pill tight>
                Sponsorship
                <br />
                inquiries
              </Pill>
              <Pill tight>
                theweekend.admin
                <br />
                @gmail.com
              </Pill>
            </div>
          </div>
        )}
        {shape === "mid" && (
          <div className="flex h-full flex-col items-center justify-between px-2 py-2.5 text-center">
            <Pill>Presented by:</Pill>
            <Name the={20} weekend={23} />
            <Logo size={58} />
            <Pill tight small>
              theweekend.admin
              <br />
              @gmail.com
            </Pill>
          </div>
        )}
        {shape === "small" && (
          <div className="flex h-full items-center justify-center gap-2 p-2">
            <Logo size={48} />
            <Name the={17} weekend={18} stacked />
          </div>
        )}
        {(shape === "wide" || shape === "strip") && (
          <div className="flex h-full items-center justify-center gap-3 px-3.5 py-2">
            <Logo size={shape === "strip" ? 52 : 62} />
            <div className="flex min-w-0 flex-col items-start gap-1">
              <Pill>Presented by:</Pill>
              <Name the={shape === "strip" ? 20 : 22} weekend={shape === "strip" ? 22 : 25} />
              {shape === "wide" && (
                <Pill tight small>
                  Sponsorship inquiries
                  <br />
                  {SPONSOR_EMAIL}
                </Pill>
              )}
            </div>
            {shape === "strip" && (
              <span className="ml-auto hidden sm:block">
                <Pill tight small>
                  Sponsorship inquiries
                  <br />
                  {SPONSOR_EMAIL}
                </Pill>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ children, tight = false, small = false }: { children: React.ReactNode; tight?: boolean; small?: boolean }) {
  return (
    <span
      className={`font-mono font-bold whitespace-nowrap text-[#ff7a2f] ${tight ? "rounded-lg px-2 py-1 leading-[1.4]" : "rounded-full px-2 py-[3px] tracking-[1.8px] uppercase"}`}
      style={{ background: "#0a1707", fontSize: small ? 8.5 : 9.5 }}
    >
      {children}
    </span>
  );
}

function Name({ the, weekend, stacked = false }: { the: number; weekend: number; stacked?: boolean }) {
  return (
    <span className={`lounge-banner-name flex items-baseline ${stacked ? "flex-col items-center" : "gap-1"}`}>
      <span className={satisfy.className} style={{ fontSize: the, lineHeight: 0.95 }}>
        The
      </span>
      <span className={anton.className} style={{ fontSize: weekend, lineHeight: 0.95, letterSpacing: "1.5px" }}>
        WEEKEND
      </span>
    </span>
  );
}

function Logo({ size }: { size: number }) {
  return <Image src={seasonalEmblem()} alt="" width={size} height={size} className="shrink-0" style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,.45))" }} />;
}
