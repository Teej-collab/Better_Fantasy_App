import { NextRequest, NextResponse } from "next/server";

// Matches app/auth/session.py's SESSION_MAX_AGE_SECONDS (30 days) — this
// cookie and the backend's own are two copies of the exact same token,
// so they should expire together.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The frontend half of the cross-domain login handoff — see
 * backend/app/routers/auth.py's discord_callback for why this exists:
 * a cookie set on the backend's own domain (railway.app) is never sent
 * by the browser to a page served from a different domain (vercel.app),
 * so every server-rendered page that gates on "is this visitor signed
 * in" (the homepage's front door, chat, chug, settings, my team) needs
 * its own first-party copy of the session token to actually see it.
 *
 * Deliberately doesn't verify the JWT signature here — that's not this
 * route's job. Every real use of this cookie forwards it to the
 * backend (getMe, getChatConversations, etc.), which independently
 * verifies the signature with SESSION_SECRET on every call — that's
 * the actual trust boundary. A garbage token set here just fails that
 * check later and reads as "not signed in," the same as no cookie at
 * all; there's nothing for a bad token to actually do here.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }

  // Local dev serves the frontend over plain http — a Secure cookie
  // can't be set at all there (the browser silently drops it), same
  // reasoning as the backend's own SESSION_COOKIE_SECURE flag. Derived
  // from the actual request instead of an env var since this route has
  // no equivalent flag of its own.
  const secure = request.nextUrl.protocol === "https:";

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
