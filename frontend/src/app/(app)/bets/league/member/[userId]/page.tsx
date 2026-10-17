import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { LeagueMemberView } from "@/components/bets/league/LeagueMemberView";

export const metadata: Metadata = { title: "Betting card — The Weekend" };

export default async function LeagueBetMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const [{ userId }, cookieStore] = await Promise.all([params, cookies()]);
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const me = await getMe(cookieStore.get("session")?.value);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  return <LeagueMemberView userId={id} />;
}
