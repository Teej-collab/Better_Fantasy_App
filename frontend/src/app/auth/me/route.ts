import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getMe } from "@/lib/api";

/**
 * Same-origin counterpart to AuthStatus's client-side sign-in check.
 * AuthStatus used to fetch the backend's /auth/me directly from the
 * browser with credentials: "include" — that depends on the browser
 * actually sending the backend's (railway.app) cookie on a cross-site
 * request. Safari's Intelligent Tracking Prevention (and iOS Chrome,
 * same engine) blocks third-party cookies on fetch/XHR by default,
 * SameSite=None or not — so on mobile Safari that request silently
 * came back unauthenticated even for a genuinely signed-in visitor,
 * showing "Sign in with Discord" while every server-rendered page
 * (which reads the frontend's own first-party cookie directly, never
 * through the browser) correctly showed them as signed in.
 *
 * This route reads that same first-party cookie server-side — no
 * browser cross-site request involved — and forwards it to the
 * backend itself, same pattern as getMe's other callers (page.tsx,
 * ChatApp.tsx SSR).
 */
export async function GET() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json(me);
}
