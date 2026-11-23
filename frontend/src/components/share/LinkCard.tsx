import type { ReactNode } from "react";
import { ordinal } from "@/lib/bracketEngine";
import { whatIfLine, type ShareData } from "@/lib/share";

// Every shared link's preview card (2026-11-17), in the style of the
// invite card the user picked: a green eyebrow under a floodlight, the
// thing itself in big scoreboard type, one line of detail, and the one
// number that matters lit green at the bottom. 1200×630, drawn by
// /s/[token]/image?f=wide (next/og). The post and story pictures keep
// their own layouts (ShareImage.tsx).

export const LINK_FONT = "Big Shoulders";

export type LinkCardParts = {
  eyebrow: string;
  title: string;
  detail?: string | null;
  heroLabel?: string | null;
  hero?: ReactNode;
  live?: boolean;
  photo?: string | null;
};

const INK = "#f2f3ee";
const INK2 = "#c8ccd2";
const MUTE = "#808894";
const LAMP = "#39ff14";

const one = (n: number) => n.toFixed(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function partsFor(data: ShareData): LinkCardParts {
  switch (data.kind) {
    case "matchup": {
      const c = data.card;
      const tag = c.status === "final" ? `Final · Week ${c.week}` : c.status === "live" ? `Live · Week ${c.week}` : `Week ${c.week}`;
      const lead = c.leader === "home" ? c.home : c.away;
      const wp = lead.win_probability;
      return {
        eyebrow: `${c.is_playoff ? "Playoffs · " : ""}${tag}${c.rivalry ? ` · ${c.rivalry}` : ""}`,
        title: `${c.home.name} v ${c.away.name}`,
        detail: `${c.home.team_name} ${c.home.record ?? ""} · ${c.away.team_name} ${c.away.record ?? ""}`,
        heroLabel: c.status === "final" ? `${lead.name} by ${one(c.margin)}` : wp !== null ? `${lead.name} · ${Math.round(wp)}% to win` : "Score",
        hero: (
          <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
            <span style={{ color: c.leader === "home" ? LAMP : INK2 }}>{one(c.home.score)}</span>
            <span style={{ color: MUTE, fontSize: 56 }}>–</span>
            <span style={{ color: c.leader === "away" ? LAMP : INK2 }}>{one(c.away.score)}</span>
          </div>
        ),
        live: c.status === "live",
        photo: c.stars[0]?.headshot ?? null,
      };
    }
    case "recap": {
      const c = data.card;
      return {
        eyebrow: `Week ${c.week} recap`,
        title: c.headline,
        detail: clip(c.teaser, 120),
        heroLabel: c.top_score ? "Top score" : null,
        hero: c.top_score ? `${c.top_score.name} ${one(c.top_score.points)}` : null,
      };
    }
    case "standings": {
      const c = data.card;
      const top = c.teams[0];
      return {
        eyebrow: `Standings${c.week ? ` · Week ${c.week}` : ""}`,
        title: data.league_name,
        detail: c.teams.slice(1, 4).map((t) => `${t.seed}. ${t.name} ${t.record}`).join("  ·  "),
        heroLabel: "1st place",
        hero: top ? `${top.name} ${top.record}` : null,
      };
    }
    case "power": {
      const c = data.card;
      const top = c.teams[0];
      return {
        eyebrow: `Power rankings · Week ${c.week}`,
        title: data.league_name,
        detail: c.teams.slice(1, 4).map((t) => `${t.rank}. ${t.name}`).join("  ·  "),
        heroLabel: "No. 1",
        hero: top ? top.name : null,
      };
    }
    case "awards": {
      const [first, ...rest] = data.card.awards;
      return {
        eyebrow: `Week ${data.card.week} awards`,
        title: first ? first.title : "The week's awards",
        detail: rest.slice(0, 3).map((a) => `${a.title}: ${a.name}`).join("  ·  "),
        heroLabel: first?.note ?? null,
        hero: first ? `${first.name} ${first.value}` : null,
      };
    }
    case "champion": {
      const c = data.card;
      return {
        eyebrow: `${c.season} champion`,
        title: c.name,
        detail: [c.team_name, c.record, c.final].filter(Boolean).join(" · "),
        heroLabel: c.titles > 1 ? "Titles" : "Champion",
        hero: c.titles > 1 ? `${c.titles}×` : String(c.season),
      };
    }
    case "season_awards": {
      const c = data.card;
      return {
        eyebrow: `${c.season} season awards`,
        title: data.league_name,
        detail: c.awards.slice(0, 3).map((a) => `${a.title}: ${a.name}`).join("  ·  "),
        heroLabel: "Awards",
        hero: String(c.awards.length),
      };
    }
    case "chug": {
      const c = data.card;
      return {
        eyebrow: `Chug${c.week ? ` · Week ${c.week}` : ""}`,
        title: `${c.name}'s chug`,
        detail: c.quote ? `“${clip(c.quote, 90)}”` : c.line,
        heroLabel: c.seconds !== null ? `Grade · ${c.seconds.toFixed(2)}s` : "Grade",
        hero: `${one(c.score)}/10`,
      };
    }
    case "bet": {
      const c = data.card;
      const n = c.legs.length;
      return {
        eyebrow: `Bet · ${c.status.replace("_", " ")}`,
        title: `${c.name}'s ${n > 1 ? `${n}-leg parlay` : "bet"}`,
        detail: clip(c.legs.map((l) => l.text).join("  ·  "), 120),
        heroLabel: c.payout !== null ? "To win" : c.odds !== null ? "Odds" : null,
        hero: c.payout !== null ? `$${c.payout.toFixed(2)}` : c.odds !== null ? (c.odds > 0 ? `+${c.odds}` : String(c.odds)) : null,
      };
    }
    case "trade": {
      const [a, b] = data.card.sides;
      const names = (s: typeof a) => [...s.players.map((p) => p.name), ...(s.picks ? [`${s.picks} pick${s.picks > 1 ? "s" : ""}`] : [])].join(", ");
      return {
        eyebrow: `Trade${data.card.date ? ` · ${data.card.date}` : ""}`,
        title: `${a.name} ⇄ ${b.name}`,
        detail: clip(`${a.name} gets ${names(b)}  ·  ${b.name} gets ${names(a)}`, 130),
        heroLabel: "Players moved",
        hero: String(a.players.length + b.players.length),
      };
    }
    case "wheel": {
      const c = data.card;
      return {
        eyebrow: `${c.season} punishment wheel`,
        title: c.text,
        detail: c.loser ? `${c.loser.name} spun it · ${c.loser.record}` : null,
        heroLabel: "Slices",
        hero: String(c.slices),
      };
    }
    case "invite": {
      const c = data.card;
      const full = c.team_count ? `${c.members} of ${c.team_count} teams` : `${c.members} members`;
      return {
        eyebrow: "You're invited",
        title: data.league_name,
        detail: [full, c.commissioner ? `run by ${c.commissioner.split(" ")[0]}` : null].filter(Boolean).join(" · "),
        heroLabel: "Invite code",
        hero: c.invite_code,
      };
    }
    case "player": {
      const c = data.card;
      const g = c.game;
      return {
        eyebrow: [c.position, c.team].filter(Boolean).join(" · ") || "Player",
        title: c.name,
        detail: g.away && g.home ? `${g.away} ${g.away_score ?? ""} @ ${g.home} ${g.home_score ?? ""} · ${g.clock ?? g.status}` : null,
        heroLabel: c.points !== null ? "Fantasy points" : null,
        hero: c.points !== null ? one(c.points) : null,
        live: g.status === "in_progress" || g.status === "live",
        photo: c.headshot,
      };
    }
    case "survivor": {
      const c = data.card;
      const started = c.entries > 0 ? `${c.alive} of ${c.entries} still alive` : "Nobody's in yet";
      return {
        eyebrow: `Survivor pool · ${c.season}`,
        title: c.name,
        detail: `Pick one NFL team to win each week, never the same team twice. ${started} · starts week ${c.start_week}${c.lives > 1 ? ` · ${c.lives} lives` : ""}`,
        heroLabel: "Join code",
        hero: c.join_code,
      };
    }
    case "whatif": {
      const c = data.card;
      return {
        eyebrow: `What-If · ${c.season}`,
        title: `What if… ${c.team_name}`,
        detail: whatIfLine(c),
        heroLabel: c.place ? "Finishes" : "Seed",
        hero: c.place === 1 ? "Champs" : c.place ? ordinal(c.place) : `#${c.seed}`,
      };
    }
  }
}

export function LinkCard({ data, photos }: { data: ShareData; photos: Record<string, string | null> }) {
  const p = partsFor(data);
  return <LinkCardView parts={p} photo={p.photo ? photos[p.photo] : null} footer={data.league_name} />;
}

/** The card itself, for previews that aren't share links (a Lounge room,
 *  a co-owner invite): `footer` is the small line over "The Weekend". */
export function LinkCardView({ parts: p, photo = null, footer }: { parts: LinkCardParts; photo?: string | null; footer?: string | null }) {
  const titleSize = p.title.length > 34 ? 64 : p.title.length > 22 ? 82 : 104;
  const heroText = typeof p.hero === "string" ? p.hero : null;
  const heroSize = heroText && heroText.length > 14 ? 60 : 84;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        padding: "60px 72px",
        color: INK,
        fontFamily: "Inter",
        background:
          "radial-gradient(ellipse 70% 90% at 50% -10%, rgba(57,255,20,0.30) 0%, rgba(57,255,20,0.06) 45%, rgba(57,255,20,0) 70%), #0b0d10",
      }}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- next/og draws plain img tags
        <img src={photo} alt="" width={420} height={420} style={{ position: "absolute", right: 30, bottom: 0, objectFit: "contain", opacity: 0.9 }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, letterSpacing: 6, color: LAMP, textTransform: "uppercase" }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: p.live ? "#ff4d4d" : LAMP, boxShadow: `0 0 16px ${p.live ? "#ff4d4d" : LAMP}` }} />
          {clip(p.eyebrow, 48)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: photo ? 760 : 1056 }}>
          <div style={{ display: "flex", fontFamily: LINK_FONT, fontSize: titleSize, lineHeight: 1, textTransform: "uppercase" }}>{clip(p.title, 64)}</div>
          {p.detail ? <div style={{ display: "flex", fontSize: 30, lineHeight: 1.3, color: INK2 }}>{clip(p.detail, 130)}</div> : null}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          {p.hero ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {p.heroLabel ? <div style={{ display: "flex", fontSize: 22, letterSpacing: 5, color: MUTE, textTransform: "uppercase" }}>{clip(p.heroLabel, 44)}</div> : null}
              <div style={{ display: "flex", fontFamily: LINK_FONT, fontSize: heroSize, lineHeight: 1, letterSpacing: 2, color: LAMP }}>{p.hero}</div>
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {footer ? <div style={{ display: "flex", fontSize: 22, color: MUTE }}>{clip(footer, 36)}</div> : null}
            <div style={{ display: "flex", fontFamily: LINK_FONT, fontSize: 32, color: INK2 }}>The Weekend</div>
          </div>
        </div>
      </div>
    </div>
  );
}
