import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { StartFlow } from "@/components/start/StartFlow";

export const metadata: Metadata = { title: "Join or Create a League — The Weekend" };

// The front door for joining or creating a league (components/start/
// StartFlow.tsx). ?flow=join|create opens that path; ?join=CODE (a
// league's invite link and QR) opens Join with the code filled in.
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; join?: string }>;
}) {
  const { flow, join } = await searchParams;
  const cookieStore = await cookies();
  const me = await getMe(cookieStore.get("session")?.value);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard
          variant={join || flow === "join" ? "join" : flow === "create" ? "create" : undefined}
          nextHref={join ? `/start?join=${encodeURIComponent(join)}` : undefined}
        />
      </div>
    );
  }
  return (
    <StartFlow
      displayName={me.display_name}
      initialFlow={flow === "join" || flow === "create" ? flow : null}
      initialCode={join ?? null}
    />
  );
}
