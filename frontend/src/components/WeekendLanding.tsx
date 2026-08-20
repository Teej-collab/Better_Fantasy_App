"use client";

import { useEffect, useRef } from "react";
import { Great_Vibes, Satisfy } from "next/font/google";

const greatVibes = Great_Vibes({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

type SignAnimation = "blue" | "pink" | "gold" | "orange" | "cyan" | "purple";

type Sign = {
  label: string;
  href: string;
  animation: SignAnimation;
  tilt: number; // degrees, static — kept off the animated element so it
  // doesn't fight the fade-in/flicker keyframes' own transform
};

/**
 * "The Weekend" landing page — hero title, tagline, and six neon
 * "vacancy sign" nav links, each with its own distinct idle animation
 * per the project owner's spec. No background photo (none available —
 * see conversation) — the room is a stylized CSS gradient instead.
 *
 * Audio: a pour sound (once) + ambient jazz (looping), neither of
 * which exist as files in this repo yet — see the <audio> elements'
 * comment below for exactly what to drop in and where. Browsers block
 * audio-with-sound autoplay until the user has interacted with the
 * page at all, so this tries immediately (works if the browser already
 * trusts this origin) and also arms a one-time fallback on the user's
 * first click/tap/keypress anywhere on the page.
 */
export function WeekendLanding({
  matchupsHref,
  awardsHref,
}: {
  matchupsHref: string;
  awardsHref: string;
}) {
  const pourRef = useRef<HTMLAudioElement>(null);
  const jazzRef = useRef<HTMLAudioElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const startAudio = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      // Pour plays once, right as the tagline finishes fading in.
      window.setTimeout(() => {
        if (pourRef.current) {
          pourRef.current.volume = 0.7;
          pourRef.current.play().catch(() => {});
        }
      }, 500);
      if (jazzRef.current) {
        jazzRef.current.volume = 0.32;
        jazzRef.current.play().catch(() => {});
      }
    };

    startAudio(); // works if this origin already has autoplay trust
    const onFirstInteraction = () => startAudio();
    window.addEventListener("pointerdown", onFirstInteraction, { once: true });
    window.addEventListener("keydown", onFirstInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
    };
  }, []);

  const signs: Sign[] = [
    { label: "Standings", href: "/standings", animation: "blue", tilt: -2 },
    { label: "Matchups", href: matchupsHref, animation: "pink", tilt: 1.5 },
    { label: "Awards", href: awardsHref, animation: "gold", tilt: -1.5 },
    { label: "Rivalries", href: "/rivalries", animation: "orange", tilt: 2 },
    { label: "Player Cards", href: "/players", animation: "cyan", tilt: -2 },
    { label: "Rules", href: "/rules", animation: "purple", tilt: 1.5 },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="weekend-room-bg" aria-hidden />

      <audio ref={pourRef} src="/audio/pour.mp3" preload="auto" />
      <audio ref={jazzRef} src="/audio/lofi-jazz.mp3" preload="auto" loop />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-between gap-10 px-4 py-10 text-center sm:py-16">
        <div className="flex flex-col items-center gap-3">
          <h1
            className={`${greatVibes.className} weekend-hero-title text-6xl leading-none text-transparent sm:text-8xl`}
            style={{
              backgroundImage: "linear-gradient(90deg, #fbbf24, #ec4899, #38bdf8)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
            }}
          >
            The Weekend
          </h1>

          <p
            className={`${satisfy.className} weekend-tagline weekend-fade-in text-2xl text-sky-300 sm:text-3xl`}
            style={{ animationDelay: "0.5s" }}
          >
            Welcome to the Weekend
          </p>

          <p
            className="weekend-subtagline weekend-fade-in text-xs font-semibold tracking-[0.2em] text-amber-300 uppercase sm:text-sm"
            style={{ animationDelay: "0.9s" }}
          >
            Pour one out, kick back, and dive into the league
          </p>
        </div>

        <nav
          aria-label="Main"
          className="flex flex-wrap items-end justify-center gap-x-4 gap-y-8 sm:gap-x-6"
        >
          {signs.map((sign, i) => (
            <a
              key={sign.label}
              href={sign.href}
              style={{ transform: `rotate(${sign.tilt}deg)` }}
              className="block transition-transform hover:scale-105"
            >
              <span
                className={`neon-sign neon-sign--${sign.animation} ${satisfy.className} block px-4 py-2.5 text-base sm:px-5 sm:py-3 sm:text-lg`}
                style={{ ["--sign-delay" as string]: `${i * 0.25}s` } as React.CSSProperties}
              >
                {sign.animation === "cyan" && <span className="neon-sign__ripple" aria-hidden />}
                <span className="relative z-10">{sign.label}</span>
              </span>
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
