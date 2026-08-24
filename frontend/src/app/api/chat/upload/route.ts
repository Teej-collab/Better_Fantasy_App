import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Token endpoint for @vercel/blob/client's upload() — the browser
 * calls this to get a short-lived upload token, then sends the file
 * bytes straight to Blob storage, never through this (or any)
 * serverless function. Same reasoning as the chug video upload and
 * the chat WS ticket: proxying real file bytes through a Vercel
 * function would count against its request-body size limit.
 *
 * Auth is a same-origin, first-party cookie read (no ITP concern —
 * this route only ever gets called by our own frontend), verified
 * against the backend's /auth/me the same way /auth/ticket does,
 * rather than trusting the cookie's mere presence.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!meRes.ok) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        addRandomSuffix: true,
        maximumSizeInBytes: MAX_IMAGE_BYTES,
      }),
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
