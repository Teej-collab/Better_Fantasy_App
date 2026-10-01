import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { BetsApp } from "@/components/bets/BetsApp";

export const metadata: Metadata = { title: "My Bets — Weekend League" };

// Bet tracking — tracking only; nothing here places a bet. Private to
// the signed-in user unless they share a bet to league chat.
export default async function BetsPage() {
  const cookieStore = await cookies();
  const me = await getMe(cookieStore.get("session")?.value);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  return <BetsApp />;
}
