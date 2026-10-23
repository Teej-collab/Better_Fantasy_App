"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass, GroupTitle, inputClass, panelClass } from "@/components/commissioner/CommishBits";
import { commishApi, formatWhen, timeAgo, TONES, type CommishAnnouncements, type CommishChange } from "@/lib/commishApi";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Commish Corner + change log (2026-10-23 overhaul, mockup 7): post an
// announcement now or schedule it, then every change a commissioner has
// made. Same as the app's mobile/src/app/commissioner/corner.tsx.

const AREA_COLORS: Record<string, string> = {
  trades: TONES.orange,
  scoring: "#4ade80",
  lineups: TONES.purple,
  waivers: "#2dd4bf",
  members: TONES.purple,
  teams: TONES.purple,
  announcements: TONES.yellow,
  draft: "#eab308",
  keepers: "#10b981",
  playoffs: TONES.blue,
  league: TONES.blue,
};

export function CommishCorner() {
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  return (
    <div className="flex flex-col gap-6">
      <Composer onPosted={refresh} />
      <Posts version={version} onChanged={refresh} />
      <ChangeLog version={version} />
    </div>
  );
}

function Composer({ onPosted }: { onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notify, setNotify] = useState(true);
  const [sendAt, setSendAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const when = sendAt ? new Date(sendAt).toISOString() : null;
      await commishApi.post(title.trim(), body.trim(), notify, when);
      setDone(when ? `Scheduled for ${formatWhen(when)}.` : "Posted to Commish Corner.");
      setTitle("");
      setBody("");
      setSendAt("");
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${panelClass} flex flex-col gap-3 p-4`} style={{ borderColor: `${TONES.yellow}66` }}>
      <label className="flex flex-col gap-1 text-sm text-black/60 dark:text-white/60">
        Headline
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Trade deadline moved to Nov 20" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-black/60 dark:text-white/60">
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What does the league need to know?" className={`${inputClass} py-2`} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-black/60 dark:text-white/60">
        Send later (leave empty to post now)
        <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-5" style={{ accentColor: "#39ff14" }} />
        Send a notification to everyone with notifications on
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {done && <p className="text-sm text-emerald-500">{done}</p>}
      <button type="button" onClick={post} disabled={busy || !title.trim() || !body.trim()} className={`${buttonClass} self-start`} style={{ backgroundColor: TONES.yellow }}>
        {busy ? "Posting…" : sendAt ? "Schedule" : "Post now"}
      </button>
    </section>
  );
}

function Posts({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [data, setData] = useState<CommishAnnouncements | null>(null);

  useEffect(() => {
    commishApi.announcements().then(setData).catch(() => setData(null));
  }, [version]);

  if (!data || (data.scheduled.length === 0 && data.recent.length === 0)) return null;
  return (
    <div className="flex flex-col gap-4">
      {data.scheduled.length > 0 && (
        <section className="flex flex-col gap-2">
          <GroupTitle title="Scheduled" color={TONES.blue} />
          <div className={`${panelClass} divide-y divide-black/5 dark:divide-white/[0.08]`}>
            {data.scheduled.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex flex-1 flex-col">
                  <span className="font-semibold">{s.title}</span>
                  <span className="text-sm text-black/55 dark:text-white/55">{formatWhen(s.send_at)}</span>
                </span>
                <button type="button" onClick={() => commishApi.cancelPost(s.id).then(onChanged)} className="rounded-full bg-red-500/10 px-3.5 py-1.5 text-sm font-bold text-red-500">
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {data.recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <GroupTitle title="Recent posts" color={TONES.yellow} />
          <div className={`${panelClass} divide-y divide-black/5 dark:divide-white/[0.08]`}>
            {data.recent.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{r.title}</span>
                  <span className="text-sm text-black/55 dark:text-white/55">{timeAgo(r.created_at)}</span>
                </span>
                {data.conversation_id && (
                  <Link href={`/chat?conversation=${data.conversation_id}`} className="rounded-full px-3.5 py-1.5 text-sm font-bold" style={{ backgroundColor: `color-mix(in srgb, ${NAV_ACCENT} 20%, transparent)` }}>
                    Who read it
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChangeLog({ version }: { version: number }) {
  const [data, setData] = useState<{ public: boolean; changes: CommishChange[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commishApi
      .log()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the change log."));
  }, [version]);

  async function toggle(isPublic: boolean) {
    await commishApi.setLogPublic(isPublic);
    setData((d) => (d ? { ...d, public: isPublic } : d));
  }

  return (
    <section className="flex flex-col gap-2">
      <GroupTitle title="Change log" color="#8790a0" right={data ? (data.public ? "The league can see this" : "Only commissioners") : undefined} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {data && (
        <>
          <label className={`${panelClass} flex cursor-pointer items-center gap-3 px-4 py-3`}>
            <span className="flex flex-1 flex-col">
              <span className="font-semibold">Let the league see this</span>
              <span className="text-xs text-black/55 dark:text-white/55">Shows on League → Activity</span>
            </span>
            <input type="checkbox" checked={data.public} onChange={(e) => toggle(e.target.checked)} className="size-5" style={{ accentColor: "#39ff14" }} />
          </label>
          {data.changes.length === 0 ? (
            <p className="text-sm text-black/55 dark:text-white/55">Nothing yet. Every change a commissioner makes from now on shows up here.</p>
          ) : (
            <ul className="flex flex-col">
              {data.changes.map((c) => (
                <li key={c.id} className="flex gap-3 border-b border-black/5 py-2.5 dark:border-white/[0.08]">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: AREA_COLORS[c.area] ?? "#8790a0" }} aria-hidden />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{c.summary}</span>
                    <span className="text-xs text-black/55 dark:text-white/55">
                      {c.actor_name} · {timeAgo(c.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
