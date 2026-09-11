import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getChatConversations, getMe } from "@/lib/api";
import { ChatApp } from "@/components/chat/ChatApp";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Chat — Weekend League" };

export default async function ChatPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  // GET /chat/conversations now requires an active league (it's scoped
  // to it, see app/routers/chat.py) — a member with no active league
  // yet would otherwise see getChatConversations' 409-into-null
  // collapse rendered as a misleading "sign in" prompt.
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const conversations = await getChatConversations(sessionCookie);
  if (conversations === null) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }

  return <ChatApp initialConversations={conversations} myOwnerId={me.owner_id} />;
}
