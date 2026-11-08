"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ELITE, EliteCard, EliteTitle } from "@/components/elite/Elite";
import { announceUnread, inboxApi, type InboxNotification } from "@/lib/inboxApi";

/**
 * The notification inbox (2026-11-08): everything we've pushed you in the
 * last 30 days, including what quiet hours held back or a device missed.
 * Same screen as the app's mobile/src/app/inbox.tsx. A row opens what it
 * was about; the ones with buttons on the push have them here too.
 */
const BUTTONS: Record<string, { action: string; label: string }[]> = {
  trade_offer: [{ action: "decline", label: "Decline" }],
  survivor_pick: [{ action: "best", label: "Pick best odds" }],
  friend_request: [{ action: "accept", label: "Accept" }],
};

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso).toDateString();
  if (d === new Date().toDateString()) return "Today";
  if (d === new Date(Date.now() - 86_400_000).toDateString()) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<InboxNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await inboxApi.list();
    setItems(r.notifications);
    setUnread(r.unread);
    announceUnread(r.unread);
  }, []);
  useEffect(() => {
    // The setState lands after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => setError("Couldn't load your notifications. Are you signed in?"));
  }, [refresh]);

  async function markRead(ids?: number[]) {
    const r = await inboxApi.markRead(ids).catch(() => null);
    if (!r) return;
    setUnread(r.unread);
    announceUnread(r.unread);
    setItems((cur) => cur?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) ?? cur);
  }

  function open(n: InboxNotification) {
    if (!n.read) void markRead([n.id]);
    router.push(n.url);
  }

  async function act(n: InboxNotification, action: string) {
    setNote(null);
    try {
      if (n.data.category === "trade_offer" && n.data.trade_id && action === "decline") {
        await inboxApi.declineTrade(n.data.trade_id);
        setNote("Trade declined.");
      } else if (n.data.category === "survivor_pick" && n.data.entry_id && action === "best") {
        const r = await inboxApi.bestPick(n.data.entry_id);
        setNote(`Picked ${r.teams.join(" and ")} for week ${r.week}. You can change it until kickoff.`);
      } else if (n.data.category === "friend_request" && n.data.user_id && action === "accept") {
        await inboxApi.acceptFriend(n.data.user_id);
        setNote("You're friends now.");
      }
      await markRead([n.id]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work. Open it and try there.");
    }
  }

  if (!items) {
    return (
      <div className="flex flex-col gap-4">
        <EliteTitle title="Inbox" />
        <p className="text-center text-sm text-white/60">{error ?? "Loading…"}</p>
      </div>
    );
  }

  const groups: { label: string; rows: InboxNotification[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.created_at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(n);
    else groups.push({ label, rows: [n] });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <EliteTitle kicker="Notifications" title="Inbox" subtitle="The last 30 days, including anything quiet hours held back." />
      <div className="flex items-center justify-between gap-3">
        <Link href="/settings?section=notifications" className="text-sm font-semibold" style={{ color: ELITE.soft }}>
          Notification settings ›
        </Link>
        {unread > 0 && (
          <button type="button" onClick={() => void markRead()} className="text-sm font-bold" style={{ color: ELITE.green }}>
            Mark all read
          </button>
        )}
      </div>
      {note && (
        <p role="status" className="rounded-xl border border-white/10 bg-[#10151c] px-3 py-2.5 text-sm" style={{ color: ELITE.cream }}>
          {note}
        </p>
      )}
      {items.length === 0 ? (
        <EliteCard className="p-4">
          <p className="font-extrabold">Nothing yet</p>
          <p className="mt-1 text-sm" style={{ color: ELITE.soft }}>
            Trade offers, injuries, your matchup and survivor reminders land here.
          </p>
        </EliteCard>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-bold tracking-wide uppercase" style={{ color: ELITE.faint }}>
              {g.label}
            </h2>
            <EliteCard className="divide-y divide-white/[0.07] overflow-hidden">
              {g.rows.map((n) => {
                const buttons = (n.data.category && BUTTONS[n.data.category]) || [];
                return (
                  <div key={n.id} className="flex gap-3 p-4 hover:bg-white/[0.03]">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: n.read ? "transparent" : ELITE.green }} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <button type="button" onClick={() => open(n)} className="flex w-full items-start gap-2 text-left">
                        <span className={`min-w-0 flex-1 text-sm ${n.read ? "font-semibold" : "font-extrabold"}`} style={{ color: n.read ? ELITE.soft : ELITE.cream }}>
                          {n.title}
                          {!n.read && <span className="sr-only"> (unread)</span>}
                        </span>
                        <span className="shrink-0 text-[11px]" style={{ color: ELITE.grey }}>
                          {ago(n.created_at)}
                        </span>
                      </button>
                      {n.body && (
                        <p className="text-sm break-words" style={{ color: ELITE.soft }}>
                          {n.body}
                        </p>
                      )}
                      {buttons.length > 0 && !n.read && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {buttons.map((b) => (
                            <button
                              key={b.action}
                              type="button"
                              onClick={() => void act(n, b.action)}
                              className="min-h-9 rounded-[10px] border px-3.5 text-xs font-extrabold"
                              style={{ borderColor: ELITE.green, color: ELITE.green }}
                            >
                              {b.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </EliteCard>
          </section>
        ))
      )}
    </div>
  );
}
