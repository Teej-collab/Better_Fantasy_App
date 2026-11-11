/* eslint-disable @next/next/no-img-element -- Satori draws plain <img>, next/image doesn't exist there */
import type { CSSProperties, ReactNode } from "react";
import type { AwardsCard, MatchupCard, PowerCard, RecapCard, ShareData, ShareFormat, StandingsCard } from "@/lib/share";
import { FORMAT_SIZE } from "@/lib/share";

/**
 * The share cards as images (2026-11-10, the share overhaul): The
 * Weekend's look (neon green, one orange accent, Anton over a Satisfy
 * script, the honeycomb ground) drawn by next/og's ImageResponse in
 * app/s/[token]/image/route.tsx. Satori, not a browser: every box is
 * flex, styles are inline, and shapes are SVG.
 *
 * Post (4:5) and Story (9:16) share one layout, laid out on a 540-wide
 * grid and scaled ×2; Story just has more room. Wide (1.91:1) is the
 * link preview, its own short layout.
 */

const GREEN = "#39ff14";
const ORANGE = "#ff7a1a";
const PEACH = "#ffb27a";
const CREAM = "#f5f4ec";
const BG = "#0b0f14";
const PANEL = "#141a22";
const SOFT = "rgba(245,244,236,0.72)";
const FAINT = "rgba(245,244,236,0.5)";
const LINE = "rgba(255,255,255,0.08)";
const GLOW = "0 0 10px rgba(57,255,20,0.75), 0 0 26px rgba(57,255,20,0.35)";
const ANTON = "Anton";
const SCRIPT = "Satisfy";
const BODY = "Inter";

export type ShareAssets = { emblem: string; headshots: Record<string, string | null> };

type U = (n: number) => number;

function Row({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "row", alignItems: "center", ...style }}>{children}</div>;
}

function Col({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", ...style }}>{children}</div>;
}

function honeycomb(width: number, height: number, cell: number): string {
  const w = cell;
  const h = cell * 1.75;
  let d = "";
  for (let y = -h; y < height + h; y += h) {
    for (let x = -w; x < width + w; x += w) {
      const cx = x + w / 2;
      d += `M${cx} ${y + 1}L${x + w - 1} ${y + h * 0.163}V${y + h * 0.5}L${cx} ${y + h * 0.663}L${x + 1} ${y + h * 0.5}V${y + h * 0.163}ZM${cx} ${y + h * 0.663}V${y + h}`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${d}" fill="none" stroke="#39ff14" stroke-opacity="0.08" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function Hex({ size, fill, color, children, u }: { size: number; fill: string; color: string; children: ReactNode; u: U }) {
  const w = u(size);
  const h = w * 1.1547;
  return (
    <div style={{ display: "flex", position: "relative", width: w, height: h, alignItems: "center", justifyContent: "center" }}>
      <svg width={w} height={h} viewBox="0 0 100 115.47" style={{ position: "absolute", top: 0, left: 0 }}>
        <polygon points="50,0 100,28.87 100,86.6 50,115.47 0,86.6 0,28.87" fill={fill} />
      </svg>
      <div style={{ display: "flex", fontFamily: ANTON, fontSize: w * 0.5, color, lineHeight: 1 }}>{children}</div>
    </div>
  );
}

function Frame({ fmt, league, right, assets, children }: { fmt: ShareFormat; league: string; right: ReactNode; assets: ShareAssets; children: ReactNode }) {
  const { width, height } = FORMAT_SIZE[fmt];
  const u: U = (n) => (fmt === "wide" ? n * 1.12 : n * 2);
  const pad = fmt === "wide" ? u(28) : u(30);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        background: BG,
        color: CREAM,
        fontFamily: BODY,
        position: "relative",
        padding: `${fmt === "story" ? u(70) : pad}px ${u(32)}px ${fmt === "story" ? u(44) : u(24)}px`,
      }}
    >
      <img alt="" src={honeycomb(width, height, u(28))} width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
          backgroundImage: "radial-gradient(ellipse at 50% -10%, rgba(57,255,20,0.22), rgba(57,255,20,0) 55%), radial-gradient(circle at 100% 100%, rgba(255,122,26,0.14), rgba(255,122,26,0) 40%)",
        }}
      />
      <div style={{ position: "absolute", top: u(4), left: u(4), width: width - u(8), height: height - u(8), border: `${u(1.5)}px solid rgba(57,255,20,0.4)`, borderRadius: u(18) }} />
      <Row style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(13), letterSpacing: u(1), color: SOFT, textTransform: "uppercase" }}>{league}</div>
        {right}
      </Row>
      <Col style={{ flexGrow: 1, justifyContent: fmt === "post" ? "flex-start" : "center", paddingBottom: fmt === "wide" ? u(10) : 0 }}>{children}</Col>
      <Row style={{ justifyContent: "space-between", borderTop: `${u(1)}px solid ${LINE}`, paddingTop: u(12) }}>
        <Row style={{ gap: u(8) }}>
          <img alt="" src={assets.emblem} width={u(34)} height={u(36)} />
          <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(17), letterSpacing: u(0.7), color: GREEN, textShadow: GLOW, textTransform: "uppercase" }}>The Weekend</div>
        </Row>
        <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(12), letterSpacing: u(1), color: SOFT, textTransform: "uppercase" }}>Get it for your league</div>
      </Row>
    </div>
  );
}

const unit = (fmt: ShareFormat): U => (n) => (fmt === "wide" ? n * 1.12 : n * 2);

function Kicker({ u, children }: { u: U; children: ReactNode }) {
  return <div style={{ display: "flex", fontFamily: SCRIPT, fontSize: u(34), color: PEACH, textShadow: "0 0 12px rgba(255,122,26,0.7)", lineHeight: 1.1 }}>{children}</div>;
}

function Title({ u, size = 34, children }: { u: U; size?: number; children: ReactNode }) {
  return <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(size), color: GREEN, textShadow: GLOW, textTransform: "uppercase", letterSpacing: u(0.6), lineHeight: 1.05 }}>{children}</div>;
}

function Label({ u, color = SOFT, children }: { u: U; color?: string; children: ReactNode }) {
  return <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(14), letterSpacing: u(0.8), color, textTransform: "uppercase" }}>{children}</div>;
}

function Panel({ u, tone, style, children }: { u: U; tone?: "glory" | "shame"; style?: CSSProperties; children: ReactNode }) {
  const border = tone === "glory" ? "rgba(57,255,20,0.5)" : tone === "shame" ? "rgba(255,122,26,0.6)" : LINE;
  return (
    <Col style={{ background: PANEL, border: `${u(1.5)}px solid ${border}`, borderRadius: u(16), padding: `${u(12)}px ${u(14)}px`, gap: u(3), ...style }}>
      {children}
    </Col>
  );
}

function Live({ u, children }: { u: U; children: ReactNode }) {
  return (
    <Row style={{ gap: u(6) }}>
      <div style={{ width: u(8), height: u(8), borderRadius: u(4), background: "#ff4d4d" }} />
      <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(13), letterSpacing: u(1), color: "#ff4d4d", textTransform: "uppercase" }}>{children}</div>
    </Row>
  );
}

const fmtScore = (n: number) => n.toFixed(1);

// ---------------------------------------------------------------- matchup
function Matchup({ c, fmt, league, assets }: { c: MatchupCard; fmt: ShareFormat; league: string; assets: ShareAssets }) {
  const u = unit(fmt);
  const lead = c[c.leader];
  const sides = [c.home, c.away];
  const right =
    c.status === "live" ? <Live u={u}>Live · Week {c.week}</Live> : <Label u={u} color={GREEN}>{`Week ${c.week}${c.status === "final" ? " · Final" : ""}`}</Label>;
  const kicker =
    c.status === "final"
      ? c.margin === 0
        ? "Dead even"
        : `${lead.name} wins by ${fmtScore(c.margin)}`
      : c.status === "live"
        ? "Sweating it out"
        : c.rivalry ?? (c.is_playoff ? "Playoffs" : "Game day");
  const scoreSize = fmt === "wide" ? 104 : 92;
  return (
    <Frame fmt={fmt} league={league} right={right} assets={assets}>
      <div style={{ display: "flex", marginTop: u(fmt === "wide" ? 18 : 36) }}>
        <Kicker u={u}>{kicker}</Kicker>
      </div>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: u(8) }}>
        {sides.map((s, i) => {
          const leading = s === lead && c.margin > 0;
          return (
            <Col key={i} style={{ alignItems: i === 0 ? "flex-start" : "flex-end", maxWidth: "48%" }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: ANTON,
                  fontSize: u(scoreSize),
                  lineHeight: 1,
                  color: leading ? GREEN : "rgba(245,244,236,0.35)",
                  textShadow: leading ? GLOW : "none",
                }}
              >
                {fmtScore(s.score)}
              </div>
              <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(21), textTransform: "uppercase", marginTop: u(8), color: leading ? CREAM : SOFT }}>{s.team_name}</div>
              <div style={{ display: "flex", fontSize: u(13), color: FAINT }}>{[s.name, s.record].filter(Boolean).join(" · ")}</div>
            </Col>
          );
        })}
      </Row>
      {c.status === "live" && c.home.win_probability !== null && (
        <Col style={{ marginTop: u(16), gap: u(6) }}>
          <div style={{ display: "flex", height: u(12), borderRadius: u(7), border: `${u(1)}px solid rgba(57,255,20,0.4)`, background: "#10151c", overflow: "hidden" }}>
            <div style={{ display: "flex", width: `${c.home.win_probability}%`, backgroundImage: `linear-gradient(90deg, ${ORANGE}, ${GREEN})` }} />
          </div>
          <Row style={{ justifyContent: "space-between", fontSize: u(12), color: FAINT }}>
            <div style={{ display: "flex" }}>{`${Math.round(c.home.win_probability)}% to win`}</div>
            <div style={{ display: "flex" }}>{`${c.home.left_to_play} left · ${c.away.left_to_play} left`}</div>
          </Row>
        </Col>
      )}
      {fmt !== "wide" && c.stars.length > 0 && (
        <Col style={{ marginTop: u(26), gap: u(12) }}>
          <Label u={u}>{c.status === "final" ? "Who did it" : "Carrying the load"}</Label>
          {c.stars.map((p) => {
            const img = p.headshot ? assets.headshots[p.headshot] : null;
            return (
              <Row key={p.name} style={{ gap: u(12) }}>
                {img ? (
                  <img alt="" src={img} width={u(48)} height={u(48)} style={{ borderRadius: u(24), border: `${u(2)}px solid rgba(57,255,20,0.55)`, objectFit: "cover" }} />
                ) : (
                  <div style={{ display: "flex", width: u(48), height: u(48), borderRadius: u(24), background: PANEL, border: `${u(2)}px solid rgba(57,255,20,0.55)` }} />
                )}
                <Col style={{ flexGrow: 1 }}>
                  <div style={{ display: "flex", fontWeight: 700, fontSize: u(15) }}>{p.name}</div>
                  <div style={{ display: "flex", fontSize: u(12.5), color: FAINT }}>{p.line ?? `${p.position}${p.pro_team ? ` · ${p.pro_team}` : ""}`}</div>
                </Col>
                <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(26) }}>{fmtScore(p.points)}</div>
              </Row>
            );
          })}
        </Col>
      )}
      {fmt !== "wide" && c.bench_crime && (
        <Panel u={u} tone="shame" style={{ marginTop: u(18) }}>
          <Label u={u} color={ORANGE}>Bench crime</Label>
          <div style={{ display: "flex", fontSize: u(14) }}>{`${c.bench_crime.name} sat ${c.bench_crime.bench_player} for ${c.bench_crime.started_player}: ${fmtScore(c.bench_crime.points)} points left on the bench.`}</div>
        </Panel>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- recap
function Recap({ c, fmt, league, assets }: { c: RecapCard; fmt: ShareFormat; league: string; assets: ShareAssets }) {
  const u = unit(fmt);
  const tiles: { tone?: "glory" | "shame"; title: string; who: string; note: string }[] = [];
  if (c.top_score) tiles.push({ tone: "glory", title: "Top score", who: `${c.top_score.name} · ${fmtScore(c.top_score.points)}`, note: "Best of the week" });
  if (c.meltdown) tiles.push({ tone: "shame", title: "Meltdown", who: c.meltdown.name, note: `${fmtScore(c.meltdown.under)} under projection` });
  if (c.bench_crime) tiles.push({ tone: "shame", title: "Bench crime", who: `${c.bench_crime.name} · ${fmtScore(c.bench_crime.points)}`, note: "Left on the bench" });
  if (c.chugs_owed.length) tiles.push({ title: "Chugs owed", who: c.chugs_owed.join(", "), note: "Pay up" });
  return (
    <Frame fmt={fmt} league={league} right={<Label u={u} color={GREEN}>{`Week ${c.week} Recap`}</Label>} assets={assets}>
      <Col style={{ marginTop: u(fmt === "wide" ? 14 : 34) }}>
        <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(60), color: ORANGE, textShadow: "0 0 18px rgba(255,122,26,0.6)", lineHeight: 0.8, height: u(30) }}>“</div>
        <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(fmt === "wide" ? 30 : 31), lineHeight: 1.17, marginTop: u(8) }}>{c.headline}</div>
        {fmt !== "wide" && <div style={{ display: "flex", fontSize: u(13), color: FAINT, marginTop: u(12) }}>The week in one line. Full recap in the app.</div>}
      </Col>
      {fmt !== "wide" && tiles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: u(10), marginTop: u(24) }}>
          {tiles.map((t) => (
            <Panel key={t.title} u={u} tone={t.tone} style={{ width: u(233) }}>
              <Label u={u} color={t.tone === "glory" ? GREEN : t.tone === "shame" ? ORANGE : SOFT}>{t.title}</Label>
              <div style={{ display: "flex", fontWeight: 700, fontSize: u(15), marginTop: u(3) }}>{t.who}</div>
              <div style={{ display: "flex", fontSize: u(12), color: FAINT }}>{t.note}</div>
            </Panel>
          ))}
        </div>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- standings
function Standings({ c, fmt, league, assets }: { c: StandingsCard; fmt: ShareFormat; league: string; assets: ShareAssets }) {
  const u = unit(fmt);
  const cut = c.playoff_teams ?? 0;
  const teams = fmt === "wide" ? c.teams.slice(0, 5) : c.teams;
  const rowH = fmt === "story" ? 48 : teams.length > 10 ? 31 : 35;
  return (
    <Frame fmt={fmt} league={league} right={<Label u={u} color={GREEN}>{c.week ? `Week ${c.week}` : `${c.season}`}</Label>} assets={assets}>
      <div style={{ display: "flex", marginTop: u(fmt === "wide" ? 10 : 20) }}>
        <Title u={u}>The standings</Title>
      </div>
      {cut > 0 && fmt !== "wide" && <div style={{ display: "flex", fontSize: u(13), color: FAINT, marginTop: u(2) }}>{`Top ${cut} make the playoffs.`}</div>}
      <Col style={{ marginTop: u(12) }}>
        <Row style={{ height: u(20), fontFamily: ANTON, fontSize: u(12), color: FAINT, letterSpacing: u(0.6) }}>
          <div style={{ display: "flex", width: u(40) }} />
          <div style={{ display: "flex", flexGrow: 1 }} />
          <div style={{ display: "flex", width: u(60), justifyContent: "flex-end" }}>W-L</div>
          <div style={{ display: "flex", width: u(70), justifyContent: "flex-end" }}>PF</div>
        </Row>
        {teams.map((t) => {
          const inside = cut === 0 || t.seed <= cut;
          return (
            <Col key={t.seed}>
              {cut > 0 && t.seed === cut + 1 && (
                <Row style={{ gap: u(10), margin: `${u(4)}px 0` }}>
                  <div style={{ display: "flex", flexGrow: 1, height: u(2), backgroundImage: `linear-gradient(90deg, ${ORANGE}, rgba(255,122,26,0))` }} />
                  <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(13), color: "#ff9a4a", letterSpacing: u(0.8), textTransform: "uppercase" }}>Playoff line</div>
                </Row>
              )}
              <Row style={{ height: u(rowH) }}>
                <div style={{ display: "flex", width: u(40) }}>
                  <Hex size={24} u={u} fill={inside ? GREEN : "rgba(245,244,236,0.2)"} color={inside ? "#06110a" : CREAM}>
                    {t.seed}
                  </Hex>
                </div>
                <div style={{ display: "flex", flexGrow: 1, fontWeight: 700, fontSize: u(15), color: inside ? CREAM : SOFT }}>{t.name}</div>
                <div style={{ display: "flex", width: u(60), justifyContent: "flex-end", fontFamily: ANTON, fontSize: u(18) }}>{t.record}</div>
                <div style={{ display: "flex", width: u(70), justifyContent: "flex-end", fontFamily: ANTON, fontSize: u(16), color: FAINT }}>{t.points_for.toLocaleString("en-US")}</div>
              </Row>
            </Col>
          );
        })}
      </Col>
    </Frame>
  );
}

// ---------------------------------------------------------------- power rankings
function Power({ c, fmt, league, assets }: { c: PowerCard; fmt: ShareFormat; league: string; assets: ShareAssets }) {
  const u = unit(fmt);
  const [top, ...rest] = c.teams;
  const shown = rest.slice(0, fmt === "wide" ? 3 : fmt === "story" ? 11 : 8);
  return (
    <Frame fmt={fmt} league={league} right={<Label u={u} color={GREEN}>{`Power rankings · Wk ${c.week}`}</Label>} assets={assets}>
      {top && (
        <Row style={{ gap: u(18), marginTop: u(fmt === "wide" ? 14 : 26) }}>
          <Hex size={70} u={u} fill={ORANGE} color="#1a0b00">
            1
          </Hex>
          <Col>
            <Title u={u} size={30}>
              {top.name}
            </Title>
            <div style={{ display: "flex", fontSize: u(13), color: SOFT, marginTop: u(4) }}>{top.team_name}</div>
            {top.why && <div style={{ display: "flex", fontSize: u(12.5), color: FAINT }}>{top.why}</div>}
          </Col>
        </Row>
      )}
      <Col style={{ marginTop: u(18) }}>
        {shown.map((t) => (
          <Row key={t.rank} style={{ height: u(fmt === "story" ? 52 : 44), borderTop: `${u(1)}px solid ${LINE}`, gap: u(12) }}>
            <div style={{ display: "flex", width: u(26), fontFamily: ANTON, fontSize: u(20), color: FAINT }}>{t.rank}</div>
            <Col style={{ flexGrow: 1 }}>
              <div style={{ display: "flex", fontWeight: 700, fontSize: u(15) }}>{t.name}</div>
              {t.why && <div style={{ display: "flex", fontSize: u(11.5), color: FAINT }}>{t.why}</div>}
            </Col>
            <div
              style={{
                display: "flex",
                fontFamily: ANTON,
                fontSize: u(14),
                color: t.movement && t.movement > 0 ? GREEN : t.movement && t.movement < 0 ? ORANGE : FAINT,
              }}
            >
              {t.movement && t.movement > 0 ? `▲ ${t.movement}` : t.movement && t.movement < 0 ? `▼ ${-t.movement}` : "–"}
            </div>
          </Row>
        ))}
      </Col>
    </Frame>
  );
}

// ---------------------------------------------------------------- week awards
function Awards({ c, fmt, league, assets }: { c: AwardsCard; fmt: ShareFormat; league: string; assets: ShareAssets }) {
  const u = unit(fmt);
  const shown = fmt === "wide" ? c.awards.slice(0, 3) : c.awards;
  return (
    <Frame fmt={fmt} league={league} right={<Label u={u} color={GREEN}>{`Week ${c.week} awards`}</Label>} assets={assets}>
      <div style={{ display: "flex", marginTop: u(fmt === "wide" ? 10 : 20) }}>
        <Title u={u}>Glory &amp; shame</Title>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: u(12), marginTop: u(16) }}>
        {shown.map((a) => (
          <Panel key={a.title} u={u} tone={a.tone} style={{ width: fmt === "wide" ? u(320) : u(232), minHeight: u(fmt === "story" ? 150 : 112) }}>
            <Label u={u} color={a.tone === "glory" ? GREEN : ORANGE}>{a.title}</Label>
            <div style={{ display: "flex", fontWeight: 700, fontSize: u(18), marginTop: u(4) }}>{a.name}</div>
            <div style={{ display: "flex", fontFamily: ANTON, fontSize: u(26) }}>{a.value}</div>
            <div style={{ display: "flex", fontSize: u(12), color: FAINT }}>{a.note}</div>
          </Panel>
        ))}
      </div>
    </Frame>
  );
}

export function ShareImage({ data, fmt, assets }: { data: ShareData; fmt: ShareFormat; assets: ShareAssets }) {
  const league = data.league_name;
  switch (data.kind) {
    case "matchup":
      return <Matchup c={data.card} fmt={fmt} league={league} assets={assets} />;
    case "recap":
      return <Recap c={data.card} fmt={fmt} league={league} assets={assets} />;
    case "standings":
      return <Standings c={data.card} fmt={fmt} league={league} assets={assets} />;
    case "power":
      return <Power c={data.card} fmt={fmt} league={league} assets={assets} />;
    case "awards":
      return <Awards c={data.card} fmt={fmt} league={league} assets={assets} />;
  }
}
