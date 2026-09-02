import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

// A cropped square logo (LogoUploadCropper.tsx draws it at a fixed
// 512x512) never needs anywhere near chat's own 8MB image allowance —
// 2MB is already generous for a single PNG/JPEG this size.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Token endpoint for @vercel/blob/client's upload() — same direct-to-
 * Blob pattern as api/chat/upload/route.ts (see that file's own
 * docstring for the full reasoning: file bytes never pass through this
 * or any serverless function, only a short-lived upload token does).
 * Its own separate route rather than reusing /api/chat/upload as-is —
 * a logo has tighter constraints (no GIF, much smaller size cap) that
 * shouldn't quietly apply to chat images too, or vice versa.
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
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
        addRandomSuffix: true,
        maximumSizeInBytes: MAX_LOGO_BYTES,
      }),
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
