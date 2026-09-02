"use client";

export type EntryChoice = "signin" | "join" | "create";

// The step between "Enter Here" and the actual sign-in/sign-up form
// (OpeningExperience.tsx) — states intent up front instead of dropping
// every visitor into the same generic form. Same neon-signage language
// as Enter Here and WelcomeBackStage's own Join/Create buttons
// (.wl-enter-sign — a physical neon sign with an idle "electrical"
// glow), so this reads as one continuous front door, not a bolted-on
// extra screen.
export function EntryChoiceStage({
  onChoose,
  onBack,
}: {
  onChoose: (choice: EntryChoice) => void;
  onBack: () => void;
}) {
  return (
    <div className="wl-auth-enter relative z-10 flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold tracking-[0.25em] text-[color:var(--wl-text-secondary)] uppercase">
          Weekend League
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-[color:var(--wl-text)] uppercase sm:text-3xl">
          Get Started
        </h1>
      </div>
      <p className="wl-tagline max-w-[18rem] text-sm sm:max-w-sm">
        Already play? Sign in. New here? Join a league you&apos;re already in, or start one of your own.
      </p>

      <div className="flex w-full flex-col items-center gap-3">
        {/* .wl-enter-sign's own built-in reveal (1s delay, tuned for
            the single dramatic "Enter Here" button after the full
            intro build-up) would leave all three of these sitting at
            low opacity for way too long on a screen reached after a
            single click — a lightly staggered, much faster delay here
            instead keeps the same neon look without the dead pause. */}
        <button
          onClick={() => onChoose("signin")}
          style={{ animationDelay: "0.15s" }}
          className="wl-enter-sign w-full max-w-xs px-6 py-3.5 text-sm font-bold sm:py-3 sm:text-base"
        >
          Sign In
        </button>
        <button
          onClick={() => onChoose("join")}
          style={{ animationDelay: "0.25s" }}
          className="wl-enter-sign w-full max-w-xs px-6 py-3 text-xs font-bold sm:text-sm"
        >
          Join a League
        </button>
        <button
          onClick={() => onChoose("create")}
          style={{ animationDelay: "0.35s" }}
          className="wl-enter-sign w-full max-w-xs px-6 py-3 text-xs font-bold sm:text-sm"
        >
          Create a League
        </button>
      </div>

      <button onClick={onBack} className="wl-skip-intro text-xs">
        ← Back
      </button>
    </div>
  );
}
