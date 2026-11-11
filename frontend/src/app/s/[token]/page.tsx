import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ANTON, SATISFY } from "@/components/elite/Elite";
import { getShareCard, shareTitle } from "@/lib/share";

/**
 * Where a shared link lands (2026-11-10, the share overhaul): anyone,
 * signed in or not, sees the card itself, plus a way into The Weekend
 * for their own league. The link preview (iMessage, Discord, X) is the
 * card's Wide image. Members open the full thing in the app.
 */

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await getShareCard(token);
  if (!data) return { title: "The Weekend" };
  const title = shareTitle(data);
  const image = { url: `/s/${token}/image?f=wide`, width: 1200, height: 630, alt: title };
  return {
    title,
    description: "Fantasy football with your league, on The Weekend.",
    openGraph: { title, type: "website", siteName: "The Weekend", images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default async function SharedCardPage({ params }: Props) {
  const { token } = await params;
  const data = await getShareCard(token);
  if (!data) notFound();
  const title = shareTitle(data);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 text-[#f5f4ec]">
      <div className="flex flex-col items-center text-center">
        <span className={`${SATISFY} text-2xl text-[#ffb27a]`} style={{ textShadow: "0 0 10px rgba(255,122,26,.7)" }}>
          {data.league_name}
        </span>
        <h1 className={`${ANTON} text-3xl uppercase tracking-wide text-[#39ff14]`} style={{ textShadow: "0 0 8px rgba(57,255,20,.8)" }}>
          {title}
        </h1>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element -- the card is drawn by our own image route at a fixed size */}
      <img src={`/s/${token}/image?f=post`} alt={title} width={1080} height={1350} className="h-auto w-full rounded-[22px] shadow-[0_0_34px_rgba(57,255,20,.15)]" />

      {data.kind === "recap" && (
        <section className="rounded-[22px] border border-white/10 bg-[#141a22] p-5">
          <h2 className={`${ANTON} text-lg uppercase tracking-wide text-[#f5f4ec]/75`}>The recap</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#f5f4ec]/85">{data.card.teaser}…</p>
          <p className="mt-2 text-sm text-[#f5f4ec]/55">Members read the whole thing in the app.</p>
        </section>
      )}

      {data.kind === "invite" ? (
        <section className="flex flex-col gap-3 rounded-[22px] border border-[#39ff14]/40 bg-[#141a22] p-5 shadow-[0_0_26px_rgba(57,255,20,.12)]">
          <h2 className={`${ANTON} text-2xl uppercase tracking-wide text-[#39ff14]`}>Join {data.league_name}</h2>
          <p className="text-[15px] leading-relaxed text-[#f5f4ec]/75">
            Sign up, then enter code <span className="font-mono font-bold tracking-widest text-[#f5f4ec]">{data.card.invite_code}</span> if it doesn&apos;t fill in for you.
          </p>
          <Link
            href={`/start?join=${encodeURIComponent(data.card.invite_code)}`}
            className={`${ANTON} flex min-h-12 items-center justify-center rounded-xl bg-[#ff7a1a] text-lg uppercase tracking-wide text-[#1a0b00] shadow-[0_0_18px_rgba(255,122,26,.45)]`}
          >
            Join the league
          </Link>
        </section>
      ) : (
      <section className="flex flex-col gap-3 rounded-[22px] border border-[#39ff14]/40 bg-[#141a22] p-5 shadow-[0_0_26px_rgba(57,255,20,.12)]">
        <h2 className={`${ANTON} text-2xl uppercase tracking-wide text-[#39ff14]`}>Your league deserves this</h2>
        <p className="text-[15px] leading-relaxed text-[#f5f4ec]/75">
          Live scores, recaps that roast your friends, chug rules and the whole history. Bring your ESPN or Sleeper league over in a couple of minutes.
        </p>
        <Link
          href="/start"
          className={`${ANTON} flex min-h-12 items-center justify-center rounded-xl bg-[#ff7a1a] text-lg uppercase tracking-wide text-[#1a0b00] shadow-[0_0_18px_rgba(255,122,26,.45)]`}
        >
          Start your league
        </Link>
        <Link href="/" className="text-center text-sm font-semibold text-[#f5f4ec]/70 hover:text-[#39ff14]">
          Already in {data.league_name}? Open The Weekend
        </Link>
      </section>
      )}
    </main>
  );
}
