import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// The link-preview card every shared Weekend League URL unfurls with
// (iMessage, Discord, Slack, X) — file-based metadata at the root
// segment, so every route inherits it unless it defines its own.
// Replaces the bare 512×512 emblem the marketing pages used to point
// og:image at directly, which previews cropped into a tiny square
// thumbnail instead of the 1200×630 card link unfurlers expect.
export const alt = "The Weekend — fantasy football, with a memory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const emblem = await readFile(path.join(process.cwd(), "public/images/the-weekend-emblem.png"));
  const emblemSrc = `data:image/png;base64,${emblem.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 56,
          padding: "0 72px",
          background: "radial-gradient(circle at 22% 50%, #16301a 0%, #0d1016 58%)",
          color: "#eceef1",
          fontFamily: "sans-serif",
        }}
      >
        <img src={emblemSrc} width={360} height={360} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#39ff14",
            }}
          >
            Fantasy football, built different
          </div>
          <div style={{ fontSize: 68, lineHeight: 1.02, whiteSpace: "nowrap" }}>The Weekend</div>
          <div style={{ fontSize: 32, lineHeight: 1.3, color: "#aab2c0" }}>
            Real drafts, live scoring, league chat, AI recaps, and a record book that writes itself. Free.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
