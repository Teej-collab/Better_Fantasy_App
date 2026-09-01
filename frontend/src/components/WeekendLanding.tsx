"use client";

import { Lobster, Satisfy } from "next/font/google";
import Link from "next/link";
import { DESTINATIONS, DESTINATION_HREF } from "@/lib/navDestinations";

// Lobster instead of a thin script — thick, bold strokes read as an
// actual lit marquee sign rather than elegant invitation lettering.
const lobster = Lobster({ weight: "400", subsets: ["latin"] });
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
 * per the project owner's spec. Background photo lives at
 * public/images/weekend-room.jpg (see globals.css's .weekend-room-bg
 * for the scrim overlay that keeps text legible over it).
 *
 * No audio here — this page used to reach for a pour sound + looping
 * ambient jazz, but the two files it pointed at
 * (public/audio/pour.mp3, public/audio/lofi-jazz.mp3) never actually
 * existed, so every visit silently 404'd trying to load them (found in
 * the 2026-09-02 re-audit). Removed outright rather than sourced,
 * per the owner's own call: real audio in this app belongs only to
 * the boot/logo splash (useIntroSound.ts's light-switch/can-opening/
 * pour cues, played once per browser as OpeningExperience.tsx/
 * HomeWelcomeBackEntry.tsx/AppEntry.tsx reveal the app) — nowhere else
 * in the app should ever play sound on its own.
 */
export function WeekendLanding({
  matchupsHref,
  awardsHref,
}: {
  matchupsHref: string;
  awardsHref: string;
}) {
  // Six hand-picked destinations, one per idle animation this page
  // knows how to do — a curated highlight reel, not an attempt at
  // matching League's sub-nav 1:1 (that's what Discover on Home does).
  // Labels/hrefs still come from lib/navDestinations.ts's shared maps
  // rather than being retyped here, so a label change or route move
  // elsewhere can't leave this page showing something stale.
  const signs: Sign[] = [
    { label: DESTINATIONS.standings.label, href: DESTINATION_HREF.standings!, animation: "blue", tilt: -2 },
    { label: DESTINATIONS.matchups.label, href: matchupsHref, animation: "pink", tilt: 1.5 },
    { label: DESTINATIONS.awards.label, href: awardsHref, animation: "gold", tilt: -1.5 },
    { label: DESTINATIONS.rivalries.label, href: DESTINATION_HREF.rivalries!, animation: "orange", tilt: 2 },
    { label: DESTINATIONS.playerCards.label, href: DESTINATION_HREF.playerCards!, animation: "cyan", tilt: -2 },
    { label: DESTINATIONS.rules.label, href: DESTINATION_HREF.rules!, animation: "purple", tilt: 1.5 },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="weekend-room-bg" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-between gap-10 px-4 py-10 text-center sm:py-16">
        <div className="flex flex-col items-center gap-3">
          <h1
            className={`${lobster.className} weekend-hero-title text-6xl leading-none text-transparent sm:text-8xl`}
            style={{
              backgroundImage: "linear-gradient(90deg, #fbbf24, #ec4899, #38bdf8)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              // A bright stroke around the gradient fill — real neon
              // glass reads as near-white hot at the tube itself with
              // color glowing out from it; a flat gradient fill alone
              // looks more like colored paint than lit glass. Thicker
              // than before since Lobster's strokes are heavier.
              WebkitTextStroke: "2.5px rgba(255,255,255,0.9)",
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
            <Link
              key={sign.label}
              href={sign.href}
              style={{ transform: `rotate(${sign.tilt}deg)` }}
              className="block transition-transform hover:scale-105"
            >
              <span
                className={`neon-sign neon-sign--${sign.animation} ${satisfy.className} block px-4 py-2.5 text-base sm:px-5 sm:py-3 sm:text-lg`}
                style={{ ["--sign-delay" as string]: `${i * 0.75}s` } as React.CSSProperties}
              >
                {sign.animation === "cyan" && <span className="neon-sign__ripple" aria-hidden />}
                <span className="relative z-10">{sign.label}</span>
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
