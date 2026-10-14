import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

// Matches set-cookie/route.ts and the backend's SESSION_MAX_AGE_SECONDS.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Keeps a signed-in browser signed in (2026-10): trades the first-party
 * session cookie for a fresh 30-day one via the backend's POST
 * /auth/refresh. Sessions used to end 30 days after sign-in however
 * often someone used the site. Called at most once a day by
 * SessionKeeper. A failed refresh leaves the current cookie alone; an
 * expired session just stays expired and signs in again as before.
 */
export async function POST(request: NextRequest) {
  const sessionCookie = (await cookies()).get("session")?.value;
  if (!sessionCookie) return NextResponse.json({ ok: false }, { status: 401 });

  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { cookie: `session=${sessionCookie}` },
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return NextResponse.json({ ok: false }, { status: res?.status ?? 502 });
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!data?.token) return NextResponse.json({ ok: false }, { status: 502 });

  // Same attributes set-cookie/route.ts uses, so this replaces that cookie.
  const sameSite = (process.env.COOKIE_SAMESITE ?? "lax") as "lax" | "none" | "strict";
  const secure = sameSite === "none" || request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", data.token, { httpOnly: true, secure, sameSite, maxAge: SESSION_MAX_AGE_SECONDS, path: "/" });
  return response;
}
