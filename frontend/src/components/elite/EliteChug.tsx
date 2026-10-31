"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getChugVideoUrl, type ChugFeedEntry } from "@/lib/api";
import { ANTON, ELITE, EliteCard, EliteLabel, Hex, SATISFY } from "@/components/elite/Elite";
import { ReadMore } from "@/components/elite/ReadMore";

// The Chug Board's live parts (elite pass, 2026-10-31): what you owe as
// a lit cell with the countdown to Monday Night kickoff, and the recent
// chugs as cards — score in a hex, the quote, the hype grade, the roast.

export function ChugOwe({ deadline, isPast, mine }: { deadline: string | null; isPast: boolean; mine: { outstanding_owed: number; fined_owed: number; fine_amount: number } }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Ticks every second, so it reads as a live countdown.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const owes = mine.outstanding_owed > 0;
  if (!owes && mine.fined_owed === 0) {
    return (
      <EliteCard tone="green" className="flex items-center gap-4 p-4">
        <Hex size={56} color={ELITE.green} glow>
          <span className={`${ANTON} text-2xl`} style={{ color: ELITE.green }}>
            0
          </span>
        </Hex>
        <div>
          <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.green }}>
            PAID UP
          </span>
          <p className="text-xs" style={{ color: ELITE.soft }}>
            Nothing owed right now. Keep it that way.
          </p>
        </div>
      </EliteCard>
    );
  }
  const left = deadline && !isPast ? Math.max(0, new Date(deadline).getTime() - now) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dd = left !== null ? Math.floor(left / 86_400_000) : 0;
  const hh = left !== null ? Math.floor((left % 86_400_000) / 3_600_000) : 0;
  const mm = left !== null ? Math.floor((left % 3_600_000) / 60_000) : 0;
  const ss = left !== null ? Math.floor((left % 60_000) / 1000) : 0;
  return (
    <EliteCard tone="deep" className="flex items-center gap-4 p-4">
      <Hex size={74} color={ELITE.peach} fill={ELITE.orange} glow>
        <span className={`${ANTON} text-[32px] text-[#2a1102]`}>{mine.outstanding_owed}</span>
        <span className="mt-0.5 text-[9px] font-extrabold tracking-wide text-[#2a1102]">YOU OWE</span>
      </Hex>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.soft }}>
          {owes ? (left !== null ? "DOUBLES AT MNF KICKOFF" : "DUE BY MNF KICKOFF") : "FINE OWED"}
        </span>
        {owes && left !== null && (
          <span
            className={`${ANTON} text-3xl tracking-[2px] tabular-nums`}
            style={{ color: ELITE.peach, textShadow: "0 0 10px rgba(255,122,26,.8)" }}
            aria-label={`${dd} days ${hh} hours ${mm} minutes until it doubles`}
          >
            {dd > 0 ? `${pad(dd)} : ` : ""}
            {pad(hh)} : {pad(mm)} : {pad(ss)}
          </span>
        )}
        {mine.fined_owed > 0 && (
          <span className="text-[13px] font-bold text-red-400">
            ${mine.fine_amount} fine · {mine.fined_owed} chug{mine.fined_owed === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </EliteCard>
  );
}

function HypeBars({ detail }: { detail: { self_roast: number; comedy: number; commitment: number } }) {
  const bars = [
    { label: "Self-roast", value: detail.self_roast, max: 4 },
    { label: "Comedy", value: detail.comedy, max: 3 },
    { label: "Commitment", value: detail.commitment, max: 3 },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {bars.map((b) => (
        <div key={b.label} aria-label={`${b.label} ${b.value} of ${b.max}`}>
          <div className="mb-1 text-[11px]" style={{ color: ELITE.soft }}>
            {b.label} {b.value}/{b.max}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.12]">
            <i className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, b.value / b.max)) * 100}%`, background: ELITE.orange }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChugCard({ chug, lit }: { chug: ChugFeedEntry; lit: boolean }) {
  const [open, setOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    if (!chug.has_video) return;
    const next = !open;
    setOpen(next);
    if (next && !videoUrl && status !== "loading") {
      setStatus("loading");
      try {
        const { url } = await getChugVideoUrl(chug.id);
        setVideoUrl(url);
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    }
  }

  const color = lit ? ELITE.green : "rgba(245,244,236,.4)";
  return (
    <li>
      <EliteCard tone={lit ? "green" : "plain"} className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <Hex size={58} color={color} fill={lit ? "#0f1a12" : ELITE.cell} glow={lit}>
            <span className={`${ANTON} text-xl`} style={{ color: lit ? ELITE.green : ELITE.cream }}>
              {chug.final_score}
            </span>
          </Hex>
          <div className="min-w-0 flex-1">
            <Link href={`/owners/${chug.owner_id}`} className="font-extrabold hover:underline">
              {chug.owner_name}
            </Link>
            <p className="text-xs" style={{ color: ELITE.soft }}>
              {[chug.week !== null ? `Week ${chug.week}` : null, chug.has_video ? null : "no video"].filter(Boolean).join(" · ")}
            </p>
          </div>
          {chug.has_video && (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Play"} ${chug.owner_name}'s chug`}
              className="flex size-[46px] items-center justify-center rounded-full border bg-[#0f141b]"
              style={{ borderColor: lit ? "rgba(57,255,20,.5)" : "rgba(255,255,255,.2)", color: lit ? ELITE.green : ELITE.cream }}
            >
              {open ? "■" : "▶"}
            </button>
          )}
        </div>
        {open &&
          (videoUrl ? (
            <video src={videoUrl} controls playsInline autoPlay className="max-h-80 w-full rounded-xl bg-black" />
          ) : status === "error" ? (
            <span className="text-xs text-red-400">Couldn&apos;t load the video — try again.</span>
          ) : (
            <span className="text-xs" style={{ color: ELITE.soft }}>
              Loading…
            </span>
          ))}
        {chug.hype_detail?.quote && (
          <p className={`${SATISFY} text-xl leading-snug`} style={{ color: "#ffd0a0" }}>
            “{chug.hype_detail.quote}”
          </p>
        )}
        {chug.hype_detail && <HypeBars detail={chug.hype_detail} />}
        {chug.roast && <ReadMore text={chug.roast} more="Read the whole roast" className="text-sm leading-relaxed text-[#f5f4ec]/85" />}
      </EliteCard>
    </li>
  );
}

const SHOWN = 4;

export function EliteChugFeed({ chugs }: { chugs: ChugFeedEntry[] }) {
  const [all, setAll] = useState(false);
  if (chugs.length === 0) return null;
  const shown = all ? chugs : chugs.slice(0, SHOWN);
  const best = Math.max(...chugs.map((c) => c.final_score));
  return (
    <section className="flex flex-col gap-3">
      <EliteLabel>Recent Chugs</EliteLabel>
      <ol className="flex flex-col gap-3">
        {shown.map((c) => (
          <ChugCard key={c.id} chug={c} lit={c.final_score === best} />
        ))}
      </ol>
      {chugs.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="flex min-h-11 items-center justify-center self-center rounded-full border border-white/15 px-4 text-sm font-semibold text-white/75 hover:bg-white/10"
        >
          {all ? "Show fewer" : `Show ${chugs.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
}
