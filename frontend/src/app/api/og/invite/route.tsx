import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

import { getInviteCard, inviteSummary } from "@/lib/inviteCard";

// The preview card an invite link unfurls with (2026-11-17: the shared
// text used to be three raw links). Your league's name in scoreboard type
// under a floodlight, how full it is, and the code to type in.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const card = code ? await getInviteCard(code) : null;
  const font = await readFile(path.join(process.cwd(), "public/fonts/BigShoulders_900Black.ttf"));
  const name = card?.name ?? "A league on The Weekend";
  const size = name.length > 26 ? 76 : name.length > 16 ? 96 : 120;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          color: "#f2f3ee",
          fontFamily: "sans-serif",
          background:
            "radial-gradient(ellipse 70% 90% at 50% -10%, rgba(57,255,20,0.30) 0%, rgba(57,255,20,0.06) 45%, rgba(57,255,20,0) 70%), #0b0d10",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, letterSpacing: 6, color: "#39ff14", textTransform: "uppercase" }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#39ff14", boxShadow: "0 0 16px #39ff14" }} />
          You&apos;re invited
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontFamily: "Big Shoulders", fontSize: size, lineHeight: 1, textTransform: "uppercase" }}>{name}</div>
          {card && <div style={{ fontSize: 32, color: "#c8ccd2" }}>{inviteSummary(card)}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 22, letterSpacing: 5, color: "#808894", textTransform: "uppercase" }}>Invite code</div>
            <div style={{ fontFamily: "Big Shoulders", fontSize: 84, lineHeight: 1, letterSpacing: 6, color: "#39ff14" }}>{card?.invite_code ?? code}</div>
          </div>
          <div style={{ fontSize: 30, color: "#c8ccd2" }}>The Weekend</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "Big Shoulders", data: font, weight: 900, style: "normal" }],
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    },
  );
}
