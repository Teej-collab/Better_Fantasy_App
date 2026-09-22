"use client";

import { useEffect, useState } from "react";
import { joinLoungeRoom, type LoungeJoinResult } from "@/lib/api";
import { LoungeVideoRoom } from "@/components/lounge/LoungeVideoRoom";

type Stage = "form" | "connecting" | "in-call" | "error";

/**
 * Public join form for a Lounge room (frontend/src/app/lounge/[slug]/
 * page.tsx). Works whether or not the visitor is signed in — a display
 * name is only asked for when they aren't (see AppEntry.tsx's own
 * fetch("/auth/me") for the same "is anyone actually signed in" check).
 * The password is always typed here, never carried in the URL.
 */
export function LoungeJoinRoom({ slug, roomName }: { slug: string; roomName: string }) {
  const [stage, setStage] = useState<Stage>("form");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LoungeJoinResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (!cancelled) setSignedIn(Boolean(me));
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn && !displayName.trim()) {
      setError("Enter your name to join.");
      return;
    }
    if (!password) {
      setError("Enter the room's password.");
      return;
    }

    setStage("connecting");
    setError(null);
    try {
      const joined = await joinLoungeRoom(slug, {
        password,
        display_name: signedIn ? undefined : displayName.trim(),
      });
      setResult(joined);
      setStage("in-call");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join this lounge.");
      setStage("error");
    }
  }

  if (stage === "in-call" && result) {
    return (
      <LoungeVideoRoom
        roomName={roomName}
        token={result.token}
        url={result.url}
        shareUrl={typeof window !== "undefined" ? `${window.location.origin}/lounge/${slug}` : undefined}
        onLeave={() => {
          setResult(null);
          setStage("form");
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-6 py-16">
      <h1 className="font-display text-2xl font-bold">{roomName}</h1>
      <p className="text-sm text-white/60">Enter the password to join this video lounge.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {signedIn === false && (
          <input
            type="text"
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
        )}
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={stage === "connecting" || signedIn === null}
          className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {stage === "connecting" ? "Joining…" : "Join"}
        </button>
      </form>
    </div>
  );
}
