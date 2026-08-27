import type { Metadata } from "next";
import { cookies } from "next/headers";
import { API_BASE_URL, getMe } from "@/lib/api";
import { DraftRoom } from "@/components/draft/DraftRoom";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";

export const metadata: Metadata = { title: "Draft — Weekend League" };

export default async function DraftPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="draft" />
        <h1 className="text-2xl font-semibold">Draft</h1>
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to join the draft.</p>
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
      <MyTeamSubNav active="draft" />
      <h1 className="text-2xl font-semibold">Draft</h1>
      <DraftRoom myOwnerId={me.owner_id} isCommissioner={me.is_commissioner} />
    </div>
  );
}
