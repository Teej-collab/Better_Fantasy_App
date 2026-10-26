"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  acceptFriend,
  getFriends,
  getMyUsername,
  getPlayedWith,
  removeFriend,
  searchFriends,
  sendFriendRequest,
  setMyUsername,
  type FriendPerson,
  type FriendsList,
} from "@/lib/api";

const ACCENT = { background: "var(--user-accent, var(--wl-accent))" };

/**
 * Friends (2026-10-26): people from any league, or none. Find them by
 * @username or from the leagues you've played in, then invite them to a
 * private lounge (/lounge/private), where they get in without the
 * password. Nothing here changes a league. Same screen as the app's
 * mobile/src/app/friends.tsx.
 */
export default function FriendsPage() {
  const [list, setList] = useState<FriendsList | null>(null);
  const [people, setPeople] = useState<FriendPerson[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ term: string; people: FriendPerson[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [l, p] = await Promise.all([getFriends(), getPlayedWith()]);
    setList(l);
    setPeople(p);
  }, []);

  useEffect(() => {
    // The setState lands after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => setError("Couldn't load your friends. Are you signed in?"));
  }, [refresh]);

  const term = q.trim().replace(/^@/, "");
  useEffect(() => {
    if (term.length < 2) return;
    const t = setTimeout(() => {
      searchFriends(term)
        .then((found) => setFound({ term, people: found }))
        .catch(() => setFound({ term, people: [] }));
    }, 300);
    return () => clearTimeout(t);
  }, [term]);
  const results = term.length >= 2 && found?.term === term ? found.people : null;

  async function act(userId: number, run: () => Promise<unknown>) {
    if (busy !== null) return;
    setBusy(userId);
    setError(null);
    try {
      const r = (await run()) as { relationship?: FriendPerson["relationship"] } | undefined;
      if (r?.relationship) {
        setFound((cur) => cur && { ...cur, people: cur.people.map((p) => (p.user_id === userId ? { ...p, relationship: r.relationship } : p)) });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  function remove(p: FriendPerson) {
    if (window.confirm(`Remove ${p.name}? They won't be told. Any lounge invites between you go away too.`)) {
      void act(p.user_id, () => removeFriend(p.user_id));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Friends</h1>
      <UsernameCard />

      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find someone by @username"
          autoCapitalize="none"
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2.5 text-sm dark:border-white/10"
        />
        {results !== null &&
          (results.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">Nobody with that username yet.</p>
          ) : (
            results.map((p) => (
              <PersonRow key={p.user_id} person={p}>
                {p.relationship === "friends" ? (
                  <span className="text-xs text-black/50 dark:text-white/50">Friends</span>
                ) : p.relationship === "outgoing" ? (
                  <span className="text-xs text-black/50 dark:text-white/50">Asked</span>
                ) : (
                  <Btn primary busy={busy === p.user_id} onClick={() => act(p.user_id, () => sendFriendRequest(p.user_id))}>
                    {p.relationship === "incoming" ? "Accept" : "Add"}
                  </Btn>
                )}
              </PersonRow>
            ))
          ))}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!!list?.incoming.length && (
        <Section title="Friend requests">
          {list.incoming.map((p) => (
            <PersonRow key={p.user_id} person={p}>
              <Btn primary busy={busy === p.user_id} onClick={() => act(p.user_id, () => acceptFriend(p.user_id))}>
                Accept
              </Btn>
              <Btn busy={false} onClick={() => act(p.user_id, () => removeFriend(p.user_id))}>
                Decline
              </Btn>
            </PersonRow>
          ))}
        </Section>
      )}

      <Section title={list?.friends.length ? `Friends · ${list.friends.length}` : "Friends"}>
        {list === null ? (
          <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>
        ) : list.friends.length ? (
          <>
            {list.friends.map((p) => (
              <PersonRow key={p.user_id} person={p}>
                <Btn busy={busy === p.user_id} onClick={() => remove(p)}>
                  Remove
                </Btn>
              </PersonRow>
            ))}
            <Link href="/lounge/private" className="mt-2 rounded-full px-4 py-2.5 text-center text-sm font-semibold text-white" style={ACCENT}>
              Start a lounge with friends
            </Link>
          </>
        ) : (
          <p className="text-sm text-black/50 dark:text-white/50">
            No friends yet. Add people from your leagues below, or search by username.
          </p>
        )}
      </Section>

      {!!list?.outgoing.length && (
        <Section title="Waiting on them">
          {list.outgoing.map((p) => (
            <PersonRow key={p.user_id} person={p}>
              <Btn busy={busy === p.user_id} onClick={() => act(p.user_id, () => removeFriend(p.user_id))}>
                Cancel
              </Btn>
            </PersonRow>
          ))}
        </Section>
      )}

      {people.length > 0 && (
        <Section title="People you've played with">
          {people.map((p) => (
            <PersonRow key={p.user_id} person={p}>
              <Btn primary busy={busy === p.user_id} onClick={() => act(p.user_id, () => sendFriendRequest(p.user_id))}>
                Add
              </Btn>
            </PersonRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function UsernameCard() {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyUsername()
      .then(setCurrent)
      .catch(() => setCurrent(null));
  }, []);

  if (current === undefined) return null;
  if (current && !editing) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <div className="flex-1">
          <p className="text-xs text-black/50 dark:text-white/50">Your username</p>
          <p className="text-lg font-bold">@{current}</p>
        </div>
        <Btn
          busy={false}
          onClick={() => {
            setValue(current);
            setEditing(true);
          }}
        >
          Change
        </Btn>
      </div>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setCurrent((await setMyUsername(value)).username);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <p className="font-semibold">{current ? "Change your username" : "Pick a username"}</p>
      <p className="text-xs text-black/50 dark:text-white/50">
        So friends outside your leagues can find you. Letters, numbers, _ and . only.
      </p>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="@username"
          maxLength={21}
          autoCapitalize="none"
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        />
        <button type="submit" disabled={saving} className="rounded-full px-4 text-sm font-semibold text-white disabled:opacity-40" style={ACCENT}>
          {saving ? "…" : "Save"}
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-black/50 dark:text-white/50">{title}</h2>
      {children}
    </section>
  );
}

function PersonRow({ person, children }: { person: FriendPerson; children?: React.ReactNode }) {
  const sub = [person.username ? `@${person.username}` : "", person.shared_leagues?.join(", ") ?? ""].filter(Boolean).join(" · ");
  const initials = person.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5 dark:border-white/10">
      {person.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/10 text-sm font-bold dark:bg-white/10">
          {initials}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{person.name}</p>
        {sub && <p className="truncate text-xs text-black/50 dark:text-white/50">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, busy, primary }: { children: React.ReactNode; onClick: () => void; busy: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold disabled:opacity-40 ${primary ? "text-white" : "border border-black/10 dark:border-white/10"}`}
      style={primary ? ACCENT : undefined}
    >
      {busy ? "…" : children}
    </button>
  );
}
