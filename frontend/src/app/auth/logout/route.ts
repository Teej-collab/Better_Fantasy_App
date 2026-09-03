import { NextRequest, NextResponse } from "next/server";

/**
 * Clears the frontend's own first-party session cookie (see
 * app/auth/complete/set-cookie/route.ts for why one exists). Sign-out
 * has to clear both copies — AuthStatus.tsx already calls the
 * backend's own /auth/logout to clear its cookie; without this, the
 * backend-domain cookie would be gone but the frontend-domain one
 * (the one every server-rendered page actually reads) would still be
 * sitting there, and the visitor would still look signed-in on every
 * page load until it expired on its own.
 *
 * secure MUST be derived the exact same way set-cookie/route.ts derives
 * it when actually setting the cookie (2026-09 fix — real bug, not
 * theoretical): this used to compute `secure = sameSite === "none"`
 * only, which is false for the default production case (HTTPS,
 * COOKIE_SAMESITE unset -> "lax") — but the cookie was originally SET
 * with secure:true there (HTTPS). A browser will not let a non-Secure
 * Set-Cookie delete a Secure cookie from a secure origin (spec-
 * mandated, and Safari enforces it correctly) — so this delete call
 * was silently failing to clear the real cookie on every logout in
 * production, leaving the old, already-revoked session sitting in
 * storage indefinitely. Found while diagnosing a real user report of
 * being permanently stuck on "Session expired or invalid" after a
 * logout, unable to log back in anywhere except a private window
 * (which starts with no cookie to conflict with).
 */
export async function POST(request: NextRequest) {
  const sameSite = (process.env.COOKIE_SAMESITE ?? "lax") as "lax" | "none" | "strict";
  const secure = sameSite === "none" || request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", "", { sameSite, secure, maxAge: 0, path: "/" });
  return response;
}
