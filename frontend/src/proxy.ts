import { NextResponse, type NextRequest } from "next/server";
import { currentSeason } from "@/lib/seasonal";

// Seasonal home-screen icons for the web app (lib/seasonal.ts). Only the
// two icon addresses run through here — everything else skips it (see
// matcher). During a season they serve that season's copy:
// - /manifest.json → the Android/desktop install icons. A new icon file
//   name is what makes Chrome update an installed app's icon by itself
//   the next time it's opened.
// - /apple-icon.png → the iPhone home-screen icon. iOS only reads it when
//   someone adds the site to their home screen (and never refreshes it),
//   so this covers anyone adding it during the season.
const SEASONAL: Record<string, Record<string, string>> = {
  halloween: {
    "/manifest.json": "/manifest-halloween.json",
    "/apple-icon.png": "/images/apple-icon-halloween.png",
  },
};

export function proxy(request: NextRequest) {
  const season = currentSeason();
  const target = season ? SEASONAL[season]?.[request.nextUrl.pathname] : undefined;
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  const response = NextResponse.rewrite(url);
  // Short-lived, so the icon flips back promptly when the season ends.
  response.headers.set("Cache-Control", "public, max-age=3600");
  return response;
}

export const config = {
  matcher: ["/manifest.json", "/apple-icon.png"],
};
