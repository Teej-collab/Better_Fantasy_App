import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { DraftRoom } from "@/components/draft/DraftRoom";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Draft — Weekend League" };

export default async function DraftPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="draft" />
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
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
