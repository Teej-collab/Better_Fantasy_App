import { cookies } from "next/headers";
import { getChatMessages, getMe, API_BASE_URL } from "@/lib/api";
import { ChatRoom } from "@/components/ChatRoom";

export default async function ChatPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [me, messages] = await Promise.all([getMe(sessionCookie), getChatMessages(sessionCookie)]);

  if (!me || messages === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">League Chat</h1>
        <section className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">League Chat</h1>
      <ChatRoom initialMessages={messages} myOwnerId={me.owner_id} />
    </div>
  );
}
