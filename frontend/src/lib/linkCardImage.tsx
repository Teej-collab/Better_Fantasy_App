import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { LINK_FONT } from "@/components/share/LinkCard";
import { FORMAT_SIZE } from "@/lib/share";

// A link preview in the share cards' style (components/share/LinkCard.tsx)
// for pages that aren't share links: a Lounge room, a co-owner invite
// (2026-11-23; they unfurled as the site's generic picture).
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 700; style: "normal" }[]> | null = null;

function loadFonts() {
  const dir = path.join(process.cwd(), "public/share-fonts");
  fonts ??= Promise.all([
    readFile(path.join(dir, "Inter-Medium.ttf")).then((data) => ({ name: "Inter", data, weight: 500 as const, style: "normal" as const })),
    readFile(path.join(dir, "Inter-Bold.ttf")).then((data) => ({ name: "Inter", data, weight: 700 as const, style: "normal" as const })),
    readFile(path.join(process.cwd(), "public/fonts/BigShoulders_900Black.ttf")).then((data) => ({ name: LINK_FONT, data, weight: 400 as const, style: "normal" as const })),
  ]);
  return fonts;
}

export async function linkCardImage(card: ReactElement, maxAge = 300): Promise<ImageResponse> {
  return new ImageResponse(card, {
    ...FORMAT_SIZE.wide,
    fonts: await loadFonts(),
    headers: { "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}` },
  });
}
