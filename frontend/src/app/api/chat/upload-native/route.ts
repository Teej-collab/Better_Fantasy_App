import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Under Vercel's 4.5 MB function request-body limit. The native app
// resizes and compresses photos on the phone first (~0.5 MB), so this
// is a ceiling, not the usual size.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Chat image upload for the native app (mobile/). The web composer
 * uses ../upload's client-token flow instead, where the browser sends
 * the file straight to Blob storage; @vercel/blob's browser client
 * doesn't fit React Native, and the native app has no session cookie.
 * So here the phone posts the (already compressed) file itself, with
 * its `Authorization: Bearer` session token, verified against the
 * backend's /auth/me the same way ../upload verifies the cookie. The
 * file goes into the same Blob store, so the URL passes the backend's
 * CHAT_IMAGE_HOST check (backend/app/image_url.py).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
    cache: "no-store",
    headers: { Authorization: authorization },
  });
  if (!meRes.ok) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload with a file field" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }

  const blob = await put(file.name || "photo.jpg", file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
  });
  return NextResponse.json({ url: blob.url });
}
