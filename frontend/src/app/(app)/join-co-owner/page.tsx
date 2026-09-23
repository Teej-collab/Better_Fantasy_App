import type { Metadata } from "next";
import { JoinCoOwnerForm } from "@/components/JoinCoOwnerForm";

export const metadata: Metadata = { title: "Join as Co-Owner — Weekend League" };

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
