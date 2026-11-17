import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { IOS_APP_URL } from "@/lib/appLinks";
import { getInviteCard, inviteSummary, type InviteCard } from "@/lib/inviteCard";
import { SignInCard } from "@/components/SignInCard";
import { StartFlow } from "@/components/start/StartFlow";

// An invite link (/start?join=CODE) unfurls as a card with the league's
// name and code (app/api/og/invite), not the site's generic one
// (2026-11-17: the shared text used to be three raw links).
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ join?: string }> }): Promise<Metadata> {
  const { join } = await searchParams;
  const card = join ? await getInviteCard(join) : null;
  if (!join || !card) return { title: "Join or Create a League — The Weekend" };
  const title = `Join ${card.name} on The Weekend`;
  const description = `${inviteSummary(card)}. Invite code ${card.invite_code}.`;
  const image = { url: `/api/og/invite?code=${encodeURIComponent(card.invite_code)}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { title, description, images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

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
    const card = join ? await getInviteCard(join) : null;
    return (
      <div className="flex flex-col items-center gap-6 py-6">
        {card && <InviteHero card={card} />}
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

// Signed out with an invite: who's inviting you, the code, and the app.
// The app link opens the app's own join screen for anyone who has it.
function InviteHero({ card }: { card: InviteCard }) {
  return (
    <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[radial-gradient(ellipse_at_top,rgba(57,255,20,0.16),transparent_60%)] p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#39ff14]">You&apos;re invited</p>
      <h1 className="mt-3 text-3xl font-bold text-balance">{card.name}</h1>
      <p className="mt-2 text-sm text-white/60">{inviteSummary(card)}</p>
      <p className="mt-5 text-xs uppercase tracking-[0.25em] text-white/50">Invite code</p>
      <p className="mt-1 font-mono text-3xl font-bold tracking-[0.2em] text-[#39ff14]">{card.invite_code}</p>
      <div className="mt-6 grid gap-2">
        <a
          href={`weekendleague://start/join?code=${encodeURIComponent(card.invite_code)}`}
          className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#0b0d10]"
        >
          Open in the app
        </a>
        <a href={IOS_APP_URL} className="rounded-full border border-white/20 px-5 py-3 text-sm font-semibold">
          Get the iPhone app
        </a>
      </div>
      <p className="mt-4 text-xs text-white/50">Or sign in below to join on the web.</p>
    </section>
  );
}
