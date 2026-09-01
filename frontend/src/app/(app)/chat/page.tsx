import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getChatConversations, getMe } from "@/lib/api";
import { ChatApp } from "@/components/chat/ChatApp";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Chat — Weekend League" };

export default async function ChatPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [me, conversations] = await Promise.all([getMe(sessionCookie), getChatConversations(sessionCookie)]);

  if (!me || conversations === null) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }

  return <ChatApp initialConversations={conversations} myOwnerId={me.owner_id} />;
}
