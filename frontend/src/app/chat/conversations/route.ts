import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getChatConversations } from "@/lib/api";

/**
 * Same-origin counterpart to useUnreadChatCount's client-side unread
 * check — see app/auth/me/route.ts for why this indirection exists
 * (Safari's ITP blocks the backend's cross-site cookie on a direct
 * browser fetch). Shape matches what the backend itself returns
 * ({ conversations: [...] }) so the hook doesn't need to change.
 */
export async function GET() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const conversations = await getChatConversations(sessionCookie);
  if (conversations === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({ conversations });
}
