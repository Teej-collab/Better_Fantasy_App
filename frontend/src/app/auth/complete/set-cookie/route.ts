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

  // SameSite: "lax" by default (production, first-party). In the Base44
  // preview the frontend runs in a cross-site iframe (app.base44.com →
  // 3000-…base44-preview.app), where SameSite=Lax cookies are NOT sent
  // with the iframe's requests — so COOKIE_SAMESITE=none switches to
  // SameSite=None, which requires Secure (the preview is HTTPS, so the
  // browser accepts it even though the proxy forwards HTTP internally).
  const sameSite = (process.env.COOKIE_SAMESITE ?? "lax") as "lax" | "none" | "strict";
  const secure = sameSite === "none" || request.nextUrl.protocol === "https:";

  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
