import { timingSafeEqual } from "node:crypto";

// ESPN's public NFL hosts, the only ones the relay will fetch.
const ESPN_HOSTS = new Set(["site.api.espn.com", "site.web.api.espn.com", "sports.core.api.espn.com"]);

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A relay for the backend's ESPN requests (2026-10-22). That morning
 * ESPN started answering requests from Railway, where the backend runs,
 * with 403 Forbidden, while the same requests from anywhere else still
 * worked. When ESPN refuses the backend directly,
 * backend/app/providers/espn_http.py sends the request here instead and
 * Vercel fetches it. Only the backend can use it: it must send
 * ESPN_RELAY_SECRET, and anyone without it gets a 404 as if the route
 * weren't here. Only GETs to ESPN's public NFL hosts are fetched.
 */
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.ESPN_RELAY_SECRET;
  const given = request.headers.get("x-relay-secret") ?? "";
  if (!expected || !secretMatches(given, expected)) {
    return new Response("Not found", { status: 404 });
  }

  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get("url") ?? "");
  } catch {
    return Response.json({ error: "url must be an ESPN address" }, { status: 400 });
  }
  // ESPN's core API links to itself over http; fetch those over https.
  if (target.protocol === "http:") target.protocol = "https:";
  if (target.protocol !== "https:" || !ESPN_HOSTS.has(target.hostname)) {
    return Response.json({ error: "url must be an ESPN address" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    return Response.json({ error: "ESPN didn't answer" }, { status: 504 });
  }
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
