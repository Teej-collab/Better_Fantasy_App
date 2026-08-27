import type { Metadata } from "next";
import { cookies } from "next/headers";
import { API_BASE_URL, getMySettings } from "@/lib/api";
import { SettingsShell } from "@/components/settings/SettingsShell";

export const metadata: Metadata = { title: "Settings — Weekend League" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const settings = await getMySettings(sessionCookie);

  if (!settings) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to manage your settings.</p>
          <a
            href={`${API_BASE_URL}/auth/discord/login`}
            className="w-fit rounded-full bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]"
          >
            Sign in with Discord
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsShell initial={settings} section={section} />
    </div>
  );
}
