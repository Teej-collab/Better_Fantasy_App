"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  claimInboxItem,
  getAdminInbox,
  setInboxItemDone,
  type AdminInbox,
  type AdminInboxItem,
  type AdminInboxKind,
} from "@/lib/api";
import { needsMe, relativeTime } from "@/lib/adminFormat";
import { startVisibleInterval } from "@/lib/visibleInterval";

// The admin inbox (2026-10-28, mockup B): everything that needs a
// person, one feed shared by the admins. Claim an item so two people
// don't both chase it; mark it done when it's handled. `limit` is the
// Command Center's short "Needs a person" list: open items that aren't
// someone else's, no filters.

export const KIND_META: Record<AdminInboxKind, { label: string; color: string }> = {
  error: { label: "Error", color: "#ff6961" },
  crash: { label: "Crash", color: "#ff375f" },
  feedback: { label: "Feedback", color: "#64d2ff" },
  waitlist: { label: "Waitlist", color: "#ffd60a" },
  join: { label: "Join", color: "#0a84ff" },
  league: { label: "League", color: "#30d158" },
};

const POLL_MS = 60 * 1000;

function hrefFor(item: AdminInboxItem): string | null {
  const { screen, id } = item.link;
  if (screen === "error" && id) return `/admin/errors?fp=${encodeURIComponent(id)}`;
  if (screen === "league" && id) return `/admin/leagues/${id}`;
  if (screen === "crashes") return "/admin/crashes";
  if (screen === "waitlist") return "/admin/waitlist";
  return null;
}

type Filter = { key: string; label: string; test: (i: AdminInboxItem) => boolean };

export function InboxPanel({ initial, limit }: { initial: AdminInbox; limit?: number }) {
  const [inbox, setInbox] = useState(initial);
  const [filter, setFilter] = useState("open");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stop = startVisibleInterval(() => {
      getAdminInbox()
        .then((d) => !cancelled && setInbox(d))
        .catch(() => {});
    }, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  async function change(item: AdminInboxItem, c: { claim?: boolean; done?: boolean }) {
    const before = inbox;
    // Show it right away; the reload after fills in names.
    setInbox({
      ...inbox,
      items: inbox.items.map((i) =>
        i.kind === item.kind && i.ref === item.ref
          ? {
              ...i,
              claimed_by: c.claim === undefined ? i.claimed_by : c.claim ? { user_id: inbox.me, name: "You" } : null,
              done: c.done ?? i.done,
              done_by: c.done ? "You" : c.done === false ? null : i.done_by,
            }
          : i
      ),
    });
    setError(null);
    try {
      if (c.claim !== undefined) await claimInboxItem(item.kind, item.ref, c.claim);
      if (c.done !== undefined) await setInboxItemDone(item.kind, item.ref, c.done);
      setInbox(await getAdminInbox());
    } catch (e) {
      setInbox(before);
      setError(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  const me = inbox.me;
  const others = [
    ...new Map(
      inbox.items
        .filter((i) => !i.done && i.claimed_by && i.claimed_by.user_id !== me)
        .map((i) => [i.claimed_by!.user_id, i.claimed_by!.name])
    ).entries(),
  ];
  const filters: Filter[] = [
    { key: "open", label: "Open", test: (i) => !i.done },
    { key: "mine", label: "Mine", test: (i) => !i.done && i.claimed_by?.user_id === me },
    ...others.map(([id, name]) => ({
      key: `u${id}`,
      label: name.split(" ")[0],
      test: (i: AdminInboxItem) => !i.done && i.claimed_by?.user_id === id,
    })),
    { key: "done", label: "Done", test: (i) => i.done },
  ];
  const active = filters.find((f) => f.key === filter) ?? filters[0];
  const shown = limit ? needsMe(inbox).slice(0, limit) : inbox.items.filter(active.test);

  return (
    <div className="flex flex-col gap-2">
      {!limit && (
        <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-black/10 p-1 dark:border-white/10">
          {filters.map((f) => {
            const count = f.key === "done" ? 0 : inbox.items.filter(f.test).length;
            const on = f.key === active.key;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={on}
                onClick={() => setFilter(f.key)}
                className={`min-h-9 flex-1 rounded-lg px-3 text-sm font-semibold ${
                  on ? "bg-black/10 dark:bg-white/10" : "text-black/50 dark:text-white/50"
                }`}
              >
                {f.label}
                {count > 0 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {shown.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">
          {active.key === "done" && !limit ? "Nothing marked done yet." : "All clear. Nothing needs a person."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => (
            <InboxRow key={`${item.kind}:${item.ref}`} item={item} me={me} compact={Boolean(limit)} onChange={change} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  me,
  compact,
  onChange,
}: {
  item: AdminInboxItem;
  me: number;
  compact: boolean;
  onChange: (item: AdminInboxItem, c: { claim?: boolean; done?: boolean }) => void;
}) {
  const meta = KIND_META[item.kind];
  const mine = item.claimed_by?.user_id === me;
  const href = hrefFor(item);
  const owner = item.done
    ? `Done${item.done_by ? ` · ${item.done_by}` : ""}`
    : item.claimed_by
      ? mine
        ? "You"
        : item.claimed_by.name
      : "Unclaimed";
  const ownerColor = item.done ? "#30d158" : item.claimed_by ? (mine ? "#7d7aff" : "#ff9f0a") : undefined;

  return (
    <li className={`flex flex-col gap-1.5 border-t border-black/5 py-3 first:border-t-0 dark:border-white/5 ${item.done ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="w-[72px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-extrabold tracking-wider uppercase"
          style={{ color: meta.color, backgroundColor: `${meta.color}26` }}
        >
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold">{item.title}</span>
        <span className="text-xs font-bold text-black/50 dark:text-white/50" style={ownerColor ? { color: ownerColor } : undefined}>
          {owner}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[80px]">
        <span className="min-w-0 flex-1 text-xs text-black/50 dark:text-white/50">
          {relativeTime(item.at)}
          {item.detail ? ` · ${item.detail}` : ""}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {item.done ? (
            <ActionButton onClick={() => onChange(item, { done: false })}>Reopen</ActionButton>
          ) : (
            <>
              {!item.claimed_by && (
                <ActionButton primary onClick={() => onChange(item, { claim: true })}>
                  I&apos;ll take it
                </ActionButton>
              )}
              <ActionButton primary={mine} onClick={() => onChange(item, { done: true })}>
                Mark done
              </ActionButton>
              {mine && !compact && <ActionButton onClick={() => onChange(item, { claim: false })}>Let go</ActionButton>}
            </>
          )}
          {href && (
            <Link
              href={href}
              className="inline-flex min-h-8 items-center rounded-full border border-black/15 px-3 text-xs font-semibold dark:border-white/15"
            >
              Open
            </Link>
          )}
          {item.link.image_url && (
            <a
              href={item.link.image_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 items-center rounded-full border border-black/15 px-3 text-xs font-semibold dark:border-white/15"
            >
              Screenshot
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function ActionButton({ children, onClick, primary = false }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-bold ${
        primary ? "bg-[#bf5af2] text-white" : "border border-black/15 dark:border-white/15"
      }`}
    >
      {children}
    </button>
  );
}
