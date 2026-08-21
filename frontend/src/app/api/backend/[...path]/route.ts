import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

/**
 * Generic same-origin proxy for every client-side authenticated call
 * this app makes to the backend — same root cause and fix as
 * app/auth/me/route.ts and app/chat/conversations/route.ts, just
 * generalized instead of hand-written per endpoint. A direct
 * browser->backend fetch with credentials: "include" depends on the
 * browser sending the backend's cross-site cookie, which Safari's
 * Intelligent Tracking Prevention (mobile Safari and iOS Chrome, and
 * desktop Safari) blocks by default regardless of SameSite=None — the
 * concrete symptom that prompted this: My Team showing "Not signed
 * in" for a visitor who very much was.
 *
 * Reads the frontend's own first-party cookie server-side (no browser
 * round-trip involved, so ITP never enters into it) and forwards it
 * to the backend as its own session cookie — same pattern
 * page.tsx/ChatApp.tsx already use for SSR, just generalized to cover
 * POST/PUT/DELETE and arbitrary JSON bodies too.
 *
 * Deliberately NOT used for the chug video upload (binary body would
 * count against Vercel's serverless request-body size limit, which
 * doesn't apply to today's direct-to-backend upload — a real
 * regression risk for large videos) or the chat WebSocket (an HTTP
 * proxy can't forward a protocol upgrade) — both need a different,
 * ticket-based fix, tracked separately.
 */
async function proxy(request: NextRequest, path: string[]) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const target = `${API_BASE_URL}/${path.join("/")}${request.nextUrl.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const headers: Record<string, string> = {};
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  if (sessionCookie) headers["cookie"] = `session=${sessionCookie}`;

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  });

  const body = await res.arrayBuffer();
  return new NextResponse(body, {
    status: res.status,
    headers: res.headers.get("content-type") ? { "content-type": res.headers.get("content-type")! } : undefined,
  });
}

type RouteParams = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  return proxy(request, (await params).path);
}
export async function POST(request: NextRequest, { params }: RouteParams) {
  return proxy(request, (await params).path);
}
export async function PUT(request: NextRequest, { params }: RouteParams) {
  return proxy(request, (await params).path);
}
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return proxy(request, (await params).path);
}
