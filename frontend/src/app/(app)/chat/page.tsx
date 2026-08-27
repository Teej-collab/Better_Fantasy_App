import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getChatConversations, getMe, API_BASE_URL } from "@/lib/api";
import { ChatApp } from "@/components/chat/ChatApp";

export const metadata: Metadata = { title: "Chat — Weekend League" };

export default async function ChatPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [me, conversations] = await Promise.all([getMe(sessionCookie), getChatConversations(sessionCookie)]);

  if (!me || conversations === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Weekend League Chat</h1>
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to join the league chat.</p>
          <a
            href={`${API_BASE_URL}/auth/discord/login`}
            className="w-fit rounded-full bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]"
          >
            Sign in with Discord
          </a>
        </section>
      </div>
    );
  }

  return <ChatApp initialConversations={conversations} myOwnerId={me.owner_id} />;
}
