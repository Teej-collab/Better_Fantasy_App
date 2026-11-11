import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { ShareImage, type ShareAssets } from "@/components/share/ShareImage";
import { FORMAT_SIZE, getShareCard, type ShareFormat } from "@/lib/share";

// A shared card as a PNG (2026-11-10): /s/{token}/image?f=post|story|wide.
// Public like the link itself. Built live, so a shared live matchup
// keeps moving; cached a minute at the edge.

const DIR = path.join(process.cwd(), "public/share-fonts");
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 700; style: "normal" }[]> | null = null;
let emblem: Promise<string> | null = null;

function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(DIR, "Anton-Regular.ttf")).then((data) => ({ name: "Anton", data, weight: 400 as const, style: "normal" as const })),
    readFile(path.join(DIR, "Satisfy-Regular.ttf")).then((data) => ({ name: "Satisfy", data, weight: 400 as const, style: "normal" as const })),
    readFile(path.join(DIR, "Inter-Medium.ttf")).then((data) => ({ name: "Inter", data, weight: 500 as const, style: "normal" as const })),
    readFile(path.join(DIR, "Inter-Bold.ttf")).then((data) => ({ name: "Inter", data, weight: 700 as const, style: "normal" as const })),
  ]);
  return fonts;
}

function loadEmblem() {
  emblem ??= readFile(path.join(DIR, "emblem.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);
  return emblem;
}

// A missing headshot shouldn't sink the card, so each is fetched here and
// left out if it fails.
async function inline(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    // Sleeper serves PNGs labeled image/jpeg, which the renderer rejects,
    // so go by the file's own first bytes. Anything else (WebP) is left out.
    const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : null;
    return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = new URL(request.url).searchParams.get("f");
  const fmt: ShareFormat = f === "story" || f === "wide" ? f : "post";
  const data = await getShareCard(token);
  if (!data) return new Response("Not found", { status: 404 });

  const headshotUrls = data.kind === "matchup" ? data.card.stars.map((s) => s.headshot).filter((u): u is string => Boolean(u)) : [];
  const [fontData, emblemSrc, shots] = await Promise.all([loadFonts(), loadEmblem(), Promise.all(headshotUrls.map(inline))]);
  const assets: ShareAssets = { emblem: emblemSrc, headshots: Object.fromEntries(headshotUrls.map((u, i) => [u, shots[i]])) };

  return new ImageResponse(<ShareImage data={data} fmt={fmt} assets={assets} />, {
    ...FORMAT_SIZE[fmt],
    fonts: fontData,
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
