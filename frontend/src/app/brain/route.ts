import { cookies } from "next/headers";
import { API_BASE_URL } from "@/lib/api";
import { BRAIN_HTML } from "./brainHtml";

/**
 * The live system map (2026-10-22), for site admins only: the backend's
 * /system/status decides (League #1's commissioner and anyone with
 * users.is_admin), and everyone else gets a plain 404, as if the page
 * weren't here. The page then reads the same status through
 * /api/backend every 15 seconds.
 */
export async function GET(): Promise<Response> {
  const notFound = new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const session = (await cookies()).get("session")?.value;
  if (!session) return notFound;
  const check = await fetch(`${API_BASE_URL}/system/status`, {
    headers: { cookie: `session=${session}` },
    cache: "no-store",
  }).catch(() => null);
  if (!check?.ok) return notFound;
  return new Response(BRAIN_HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}
