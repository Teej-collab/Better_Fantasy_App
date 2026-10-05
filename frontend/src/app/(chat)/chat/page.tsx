import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getChatConversations, getMe } from "@/lib/api";
import { ChatApp } from "@/components/chat/ChatApp";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Chat — The Weekend" };

export default async function ChatPage({
  searchParams,
}: {
  // ?conversation=<id> — set by a chat push notification's url (see
  // backend/app/notifications/formatter.py's _chat_url), so tapping one
  // opens the actual conversation it was about instead of always
  // landing on ChatApp's own most-recent-conversation default.
  searchParams: Promise<{ conversation?: string; party?: string; newParty?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const { conversation, party, newParty } = await searchParams;
  // ?party=<room id> opens that Watch Party room straight away — how the
  // native app hands "Join video" off to the browser (LiveKit's video
  // SDK only runs here, not in Expo Go).
  const parsedPartyId = party !== undefined ? Number(party) : NaN;
  const initialPartyId = Number.isInteger(parsedPartyId) ? parsedPartyId : null;
  const parsedConversationId = conversation !== undefined ? Number(conversation) : NaN;
  const initialConversationId = Number.isInteger(parsedConversationId) ? parsedConversationId : null;

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

  return (
    <ChatApp
      initialConversations={conversations}
      myOwnerId={me.owner_id}
      initialConversationId={initialConversationId}
      initialPartyId={initialPartyId}
      initialNewParty={newParty === "1"}
    />
  );
}
