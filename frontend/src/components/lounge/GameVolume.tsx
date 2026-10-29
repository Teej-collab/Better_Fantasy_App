"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { GAME_NORMAL, GAME_STEPS, gameLabel, setGameStep, useLoungeVolume } from "@/lib/loungeVolume";

// The game's volume as ten steps you can tap, drag across or arrow
// through (lib/loungeVolume.ts has why it isn't a slider anymore). The
// same setting everywhere: the pill on the TV and the Volume panel.
export function GameVolume({ accent, className = "" }: { accent: string; className?: string }) {
  const { game } = useLoungeVolume();
  // Unmute goes back to where it was.
  const lastOn = useRef(game > 0 ? game : GAME_NORMAL);
  useEffect(() => {
    if (game > 0) lastOn.current = game;
  }, [game]);
  const bars = useRef<HTMLDivElement | null>(null);

  function fromPointer(e: PointerEvent<HTMLDivElement>) {
    const r = bars.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setGameStep(Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * GAME_STEPS)));
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowRight: game + 1, ArrowUp: game + 1, ArrowLeft: game - 1, ArrowDown: game - 1, Home: 0, End: GAME_STEPS }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setGameStep(next);
  }

  return (
    <div className={`flex items-center gap-2.5 rounded-full bg-black/65 py-1.5 pr-3 pl-2 backdrop-blur ${className}`}>
      <button
        onClick={() => setGameStep(game > 0 ? 0 : lastOn.current)}
        aria-label={game > 0 ? "Mute the game for you" : "Unmute the game for you"}
        className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          {game > 0 ? <path d="M15.5 8.5a5 5 0 010 7" /> : <path d="M22 9l-6 6M16 9l6 6" />}
        </svg>
      </button>
      <div
        ref={bars}
        role="slider"
        tabIndex={0}
        aria-label="Game volume, only for you"
        aria-valuemin={0}
        aria-valuemax={GAME_STEPS}
        aria-valuenow={game}
        aria-valuetext={`${game} of ${GAME_STEPS}, ${gameLabel(game)}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) fromPointer(e);
        }}
        className="flex h-6 cursor-pointer touch-none items-end gap-[3px] rounded outline-offset-4"
      >
        {Array.from({ length: GAME_STEPS }, (_, i) => (
          <span
            key={i}
            className="w-[5px] rounded-sm transition-colors"
            style={{ height: `${8 + i * 1.8}px`, background: i < game ? accent : "rgba(255,255,255,0.22)" }}
          />
        ))}
      </div>
      <span className="w-[70px] text-xs font-semibold text-white/80">{gameLabel(game)}</span>
    </div>
  );
}
