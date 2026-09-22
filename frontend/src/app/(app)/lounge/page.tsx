"use client";

import { useEffect, useState } from "react";
import {
  closeLoungeRoom,
  createLoungeRoom,
  joinLoungeRoom,
  listMyLoungeRooms,
  type LoungeJoinResult,
  type LoungeRoom,
} from "@/lib/api";
import { LoungeVideoRoom } from "@/components/lounge/LoungeVideoRoom";

type SignedInState = "checking" | "in" | "out";

/**
 * Lounge splash — creating a room drops the creator straight into it as
 * host, with the invite link copyable from inside the call itself
 * rather than only from a separate management list. Every existing
 * room in "Your lounges" also gets a one-click "Join" — the backend's
 * join route never asks the room's own creator for the password (see
 * backend/app/routers/lounge.py), so rejoining an old room needs no
 * re-typing anything. Deliberately not gated by league membership,
 * unlike most of (app)/ — any signed-in account can use this, same as
 * email/password signup itself requires no league.
 */
export default function LoungePage() {
  const [signedIn, setSignedIn] = useState<SignedInState>("checking");
  const [rooms, setRooms] = useState<LoungeRoom[] | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedRoomId, setCopiedRoomId] = useState<number | null>(null);
  const [hosting, setHosting] = useState<{ slug: string; roomName: string; join: LoungeJoinResult } | null>(null);

  async function refresh() {
    setRooms(await listMyLoungeRooms());
  }

  useEffect(() => {
    fetch("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => setSignedIn(me ? "in" : "out"))
      .catch(() => setSignedIn("out"));
  }, []);

  useEffect(() => {
    if (signedIn !== "in") return;
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your lounges."));
  }, [signedIn]);

  function shareUrl(slug: string) {
    return `${window.location.origin}/lounge/${slug}`;
  }

  function copyLink(roomId: number, slug: string) {
    navigator.clipboard.writeText(shareUrl(slug)).then(() => {
      setCopiedRoomId(roomId);
      setTimeout(() => setCopiedRoomId((current) => (current === roomId ? null : current)), 2000);
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const room = await createLoungeRoom(name.trim(), password);
      const join = await joinLoungeRoom(room.slug, { display_name: displayName.trim() || undefined });
      setHosting({ slug: room.slug, roomName: room.name, join });
      setName("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the lounge.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRejoin(room: LoungeRoom) {
    setJoiningRoomId(room.id);
    setError(null);
    try {
      // No password needed — the backend recognizes this room's own
      // creator and never asks them for it.
      const join = await joinLoungeRoom(room.slug, { display_name: displayName.trim() || undefined });
      setHosting({ slug: room.slug, roomName: room.name, join });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rejoin the lounge.");
    } finally {
      setJoiningRoomId(null);
    }
  }

  async function handleClose(roomId: number) {
    try {
      await closeLoungeRoom(roomId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't close the lounge.");
    }
  }

  if (hosting) {
    return (
      <LoungeVideoRoom
        roomName={hosting.roomName}
        token={hosting.join.token}
        url={hosting.join.url}
        shareUrl={shareUrl(hosting.slug)}
        onLeave={() => {
          setHosting(null);
          refresh().catch(() => {});
        }}
        onRejoin={() => {
          const slug = hosting.slug;
          const roomName = hosting.roomName;
          setHosting(null);
          joinLoungeRoom(slug, { display_name: displayName.trim() || undefined })
            .then((join) => setHosting({ slug, roomName, join }))
            .catch((e) => setError(e instanceof Error ? e.message : "Couldn't rejoin the lounge."));
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-3xl font-bold">Lounge</h1>
        <p className="max-w-sm text-sm text-black/60 dark:text-white/60">
          Start a password-protected video room and share the link with anyone — no league required, and no
          account needed to join.
        </p>
      </div>

      {signedIn === "checking" && <p className="text-center text-sm text-black/50 dark:text-white/50">Loading…</p>}

      {signedIn === "out" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-black/10 p-6 text-center dark:border-white/10">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to start a lounge.</p>
          <a
            href="/login"
            className="rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--user-accent, var(--wl-accent))" }}
          >
            Sign in
          </a>
        </div>
      )}

      {signedIn === "in" && (
        <>
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-3 rounded-2xl border border-black/10 p-6 dark:border-white/10"
          >
            <input
              type="text"
              placeholder="Room name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            />
            <input
              type="text"
              placeholder="Your display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            />
            <input
              type="password"
              placeholder="Set a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy || !name.trim() || !password}
              className="rounded-full px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--user-accent, var(--wl-accent))" }}
            >
              {busy ? "Starting…" : "Create & enter lounge"}
            </button>
          </form>

          {rooms !== null && rooms.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-black/60 dark:text-white/60">Your lounges</h2>
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{room.name}</span>
                    {room.closed ? (
                      <span className="text-xs text-black/40 dark:text-white/40">Closed</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRejoin(room)}
                          disabled={joiningRoomId === room.id}
                          className="rounded-full px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                          style={{ background: "var(--user-accent, var(--wl-accent))" }}
                        >
                          {joiningRoomId === room.id ? "Joining…" : "Join"}
                        </button>
                        <button
                          onClick={() => handleClose(room.id)}
                          className="rounded-full border border-black/10 px-2.5 py-1 text-xs dark:border-white/10"
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                  {!room.closed && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-black/50 dark:text-white/50">
                      <code className="font-mono">{shareUrl(room.slug)}</code>
                      <button
                        onClick={() => copyLink(room.id, room.slug)}
                        className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] dark:border-white/10"
                      >
                        {copiedRoomId === room.id ? "Copied!" : "Copy link"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
