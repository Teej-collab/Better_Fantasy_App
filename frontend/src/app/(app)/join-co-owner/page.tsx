import type { Metadata } from "next";
import { JoinCoOwnerForm } from "@/components/JoinCoOwnerForm";

// The preview card when the invite is texted (2026-11-23).
const PREVIEW = { url: "/api/og/co-owner", width: 1200, height: 630, alt: "Help run my team on The Weekend" };
export const metadata: Metadata = {
  title: "Join as Co-Owner — The Weekend",
  description: "Co-own a fantasy team on The Weekend.",
  openGraph: { title: "Help run my team on The Weekend", description: "Co-own a fantasy team on The Weekend.", images: [PREVIEW], type: "website", siteName: "The Weekend" },
  twitter: { card: "summary_large_image", title: "Help run my team on The Weekend", images: [PREVIEW.url] },
};

// The link an owner shares (POST /leagues/co-owner-invite) points here
// with ?code=... — read server-side, same shape as reset-password's
// own ?token= handling, rather than a client-side useSearchParams()
// read.
export default async function JoinCoOwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  return (
    <div className="wl-gate flex items-center justify-center px-6">
      <div className="wl-ambient wl-ambient--lit" aria-hidden />
      <JoinCoOwnerForm code={code} />
    </div>
  );
}
