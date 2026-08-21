import { NextResponse } from "next/server";

/**
 * Clears the frontend's own first-party session cookie (see
 * app/auth/complete/set-cookie/route.ts for why one exists). Sign-out
 * has to clear both copies — AuthStatus.tsx already calls the
 * backend's own /auth/logout to clear its cookie; without this, the
 * backend-domain cookie would be gone but the frontend-domain one
 * (the one every server-rendered page actually reads) would still be
 * sitting there, and the visitor would still look signed-in on every
 * page load until it expired on its own.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("session");
  return response;
}
