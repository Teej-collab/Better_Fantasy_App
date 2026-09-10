import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset Password — Weekend League" };

export default function ForgotPasswordPage() {
  return (
    <div className="wl-gate flex items-center justify-center px-6">
      <div className="wl-ambient wl-ambient--lit" aria-hidden />
      <ForgotPasswordForm />
    </div>
  );
}
