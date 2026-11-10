import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

/**
 * Where a notification tap lands (2026-11-10): /open?league=<id>&to=<path>
 * makes the push's own league active, then goes to the page it's about.
 * Pages are server-rendered from the session's active league, so a push
 * from your other league used to open its matchup or trade under this
 * one ("not found"). The service worker (public/sw.js) and the inbox
 * build these links. A failed switch still goes to the page.
 */
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to") ?? "/";
  // Same-site paths only, never //evil.com or /\evil.com.
  const target = to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/\\") ? to : "/";
  const league = Number(request.nextUrl.searchParams.get("league"));
  const sessionCookie = (await cookies()).get("session")?.value;
  if (sessionCookie && Number.isInteger(league) && league > 0) {
    await fetch(`${API_BASE_URL}/leagues/${league}/select`, {
      method: "POST",
      headers: { cookie: `session=${sessionCookie}`, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    }).catch(() => null);
  }
  return NextResponse.redirect(new URL(target, request.url));
}
