import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a New Password — Weekend League" };

// The link in the reset email (POST /auth/forgot-password) points
// here with ?token=... — read server-side, same shape as
// app/(app)/login/page.tsx's own ?error= handling, rather than a
// client-side useSearchParams() read.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="wl-gate flex items-center justify-center px-6">
      <div className="wl-ambient wl-ambient--lit" aria-hidden />
      <ResetPasswordForm token={token} />
    </div>
  );
}
