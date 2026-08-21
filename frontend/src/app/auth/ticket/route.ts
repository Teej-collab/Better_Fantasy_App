import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

/**
 * Mints a short-lived, purpose-scoped backend ticket (see backend's
 * app/auth/session.py and POST /auth/ticket) for the two real
 * requests that can't go through the generic /api/backend proxy: the
 * chat WebSocket handshake (a protocol upgrade, not a plain fetch)
 * and the chug video upload (a real file — proxying it through a
 * Vercel serverless function would count against its request-body
 * size limit, which the current direct-to-backend upload never hits).
 * Both are still cross-site browser requests, so they'd hit the same
 * Safari ITP cookie-blocking problem /api/backend was built to solve
 * for everything else — this route reads the visitor's first-party
 * cookie server-side (never touched by ITP) and forwards it to the
 * backend to mint the ticket, same pattern as every other route here.
 */
export async function POST(request: NextRequest) {
  const purpose = request.nextUrl.searchParams.get("purpose");
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  if (!sessionCookie) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const res = await fetch(`${API_BASE_URL}/auth/ticket?purpose=${encodeURIComponent(purpose ?? "")}`, {
    method: "POST",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
