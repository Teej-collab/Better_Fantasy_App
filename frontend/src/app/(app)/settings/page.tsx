import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, getMySettings } from "@/lib/api";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Settings — Weekend League" };

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
    </div>
  );
}
