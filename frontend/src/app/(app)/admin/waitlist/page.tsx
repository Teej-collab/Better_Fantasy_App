import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAdminWaitlistServer, type WaitlistSignup } from "@/lib/api";

export const metadata: Metadata = { title: "Waitlist — Admin — The Weekend" };

const PLATFORM: Record<string, string> = { espn: "ESPN", sleeper: "Sleeper", yahoo: "Yahoo", nfl: "NFL.com", other: "Other", none: "New league" };

function refLabel(ref: string | null): string {
  if (!ref) return "Direct";
  if (ref.startsWith("share-")) return `Shared: ${ref.slice(6).replace(/-/g, " ")}`;
  return ref.replace(/-/g, " ");
}

function tally(rows: WaitlistSignup[], keyOf: (x: WaitlistSignup) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// The 2027 waitlist (2026-10-24): everyone who signed up on the public
// /waitlist page, where every "Get this for your league" share link
// lands. Same as the app's Admin > Waitlist.
export default async function AdminWaitlistPage() {
  const cookieStore = await cookies();
  const data = await getAdminWaitlistServer(cookieStore.get("session")?.value);
  if (!data) return <p className="text-sm text-red-500">Couldn&apos;t load the waitlist. Try refreshing.</p>;

  const breakdowns: [string, [string, number][]][] = [
    ["Where they play now", tally(data.signups, (x) => PLATFORM[x.platform ?? ""] ?? "Didn't say")],
    ["What brought them", tally(data.signups, (x) => refLabel(x.ref))],
  ];
  const csv = [
    "email,name,role,league_size,platform,ref,note,signed_up",
    ...data.signups.map((x) =>
      [x.email, x.name ?? "", x.role, x.league_size ?? "", x.platform ?? "", x.ref ?? "", (x.note ?? "").replace(/[\r\n"]+/g, " "), x.created_at]
        .map((v) => `"${String(v)}"`)
        .join(",")
    ),
  ].join("\n");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Signups", data.count],
          ["Commissioners", data.commissioners],
          ["Players in their leagues", data.players_represented],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-xs text-black/55 dark:text-white/55">{label}</div>
          </div>
        ))}
      </div>

      {data.signups.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {breakdowns.map(([title, rows]) => (
            <section key={title} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              {rows.map(([label, n]) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0 truncate">{label}</span>
                  <span className="h-2 rounded-full bg-[var(--admin-accent)]" style={{ width: `${(n / rows[0][1]) * 100}%`, maxWidth: "60%" }} />
                  <span className="font-mono text-xs">{n}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Everyone, newest first</h2>
          {data.signups.length > 0 && (
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
              download="weekend-waitlist.csv"
              className="text-sm font-semibold text-[var(--admin-accent)] underline"
            >
              Download CSV
            </a>
          )}
        </div>
        {data.signups.length === 0 ? (
          <p className="text-sm text-black/55 dark:text-white/55">No signups yet. Every share from the app links to the waitlist page.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
            {data.signups.map((x) => (
              <li key={x.id} className="flex flex-col gap-0.5 py-2.5">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <a href={`mailto:${x.email}`} className="font-semibold underline">
                    {x.name ? `${x.name} · ${x.email}` : x.email}
                  </a>
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">{x.role === "commissioner" ? "Commissioner" : "Player"}</span>
                </span>
                <span className="text-xs text-black/55 dark:text-white/55">
                  {[x.league_size ? `${x.league_size} teams` : null, PLATFORM[x.platform ?? ""], refLabel(x.ref), new Date(x.created_at).toLocaleString()]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {x.note && <span className="text-xs text-black/70 dark:text-white/70">&ldquo;{x.note}&rdquo;</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
