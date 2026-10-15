import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe, getMySettings } from "@/lib/api";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Settings — The Weekend" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [settings, me] = await Promise.all([getMySettings(sessionCookie), getMe(sessionCookie)]);

  if (!settings) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsShell initial={settings} section={section} isCommissioner={me?.is_commissioner ?? false} />
      {/* In-app route to the legal pages — the App Store and Play Store
          both expect the privacy policy to be reachable from inside the
          app, not just from the store listing. */}
      <p className="pt-2 text-center text-xs text-[color:var(--wl-text-secondary)]">
        <Link href="/privacy" className="hover:text-[color:var(--wl-text)]">
          Privacy Policy
        </Link>
        {" · "}
        <Link href="/terms" className="hover:text-[color:var(--wl-text)]">
          Terms of Service
        </Link>
      </p>
    </div>
  );
}
