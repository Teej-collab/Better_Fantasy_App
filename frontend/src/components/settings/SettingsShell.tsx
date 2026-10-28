import Link from "next/link";
import type { MySettings } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { ChatBubbleSection, ProfileSection } from "@/components/settings/ProfileSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { ChatSection } from "@/components/settings/ChatSection";
import { AppearanceSection, SoundSection } from "@/components/settings/AppearanceSection";
import { AccountSection } from "@/components/settings/AccountSection";
import { FeedbackSection } from "@/components/settings/FeedbackSection";
import { BetsSection } from "@/components/settings/BetsSection";

// Settings, grouped the same way as the app's (2026-10-28 cleanup):
// You · How it works for you · Account · Help. The old section names
// (appearance, bets, feedback) still open the right page.
const GROUPS = [
  { title: "You", sections: [{ key: "profile", label: "Profile" }] },
  {
    title: "How it works for you",
    sections: [
      { key: "notifications", label: "Notifications" },
      { key: "look", label: "Look & feel" },
      { key: "sound", label: "Sound" },
      { key: "chat", label: "Chat" },
      { key: "features", label: "Features" },
    ],
  },
  { title: "Account", sections: [{ key: "account", label: "Account & security" }] },
  { title: "Help", sections: [{ key: "help", label: "Help & feedback" }] },
] as const;

type SectionKey = (typeof GROUPS)[number]["sections"][number]["key"];

const ALIASES: Record<string, SectionKey> = { appearance: "look", bets: "features", feedback: "help" };

function resolve(value: string | undefined): SectionKey | null {
  if (!value) return null;
  if (ALIASES[value]) return ALIASES[value];
  return GROUPS.some((g) => g.sections.some((s) => s.key === value)) ? (value as SectionKey) : null;
}

/**
 * Desktop: the grouped sidebar and the content pane side by side.
 * Phone width: the grouped list when no `?section=` is in the URL, or just
 * that section (with a back link) when there is — all from the URL, so
 * the back button and direct links just work.
 */
export function SettingsShell({
  initial,
  section,
  isCommissioner,
}: {
  initial: MySettings;
  section: string | undefined;
  isCommissioner: boolean;
}) {
  const picked = resolve(section);
  const active: SectionKey = picked ?? "profile";

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
      {!picked && <BackButton fallbackHref="/" label="Home" />}
      <nav
        aria-label="Settings sections"
        className={`flex-col gap-4 sm:flex sm:w-56 sm:shrink-0 ${picked ? "hidden sm:flex" : "flex"}`}
      >
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 text-[11px] font-bold tracking-[0.14em] text-black/45 uppercase dark:text-white/45">{g.title}</span>
            {g.sections.map((s) => (
              <Link
                key={s.key}
                href={`/settings?section=${s.key}`}
                aria-current={active === s.key ? "page" : undefined}
                className={`flex min-h-11 items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors sm:min-h-0 sm:py-2 ${
                  active === s.key
                    ? "bg-black/[0.04] font-medium text-black dark:bg-white/[0.06] dark:text-white"
                    : "text-black/70 hover:bg-black/[0.02] dark:text-white/70 dark:hover:bg-white/[0.03]"
                }`}
              >
                {s.label}
                <span aria-hidden className="text-black/30 sm:hidden dark:text-white/30">
                  ›
                </span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className={`min-w-0 flex-1 ${picked ? "block" : "hidden sm:block"}`}>
        {picked && <BackButton fallbackHref="/settings" label="Settings" />}
        {active === "profile" && <ProfileSection initial={initial} />}
        {active === "notifications" && <NotificationsSection />}
        {active === "look" && <AppearanceSection />}
        {active === "sound" && <SoundSection />}
        {active === "chat" && (
          <div className="flex flex-col gap-6">
            <ChatSection />
            <ChatBubbleSection initialColor={initial.chat_color} />
          </div>
        )}
        {active === "features" && <BetsSection />}
        {active === "account" && <AccountSection initial={initial} />}
        {active === "help" && (
          <div className="flex flex-col gap-6">
            <section className="neon-panel flex flex-col gap-2 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
              <h2 className="text-sm font-semibold tracking-wide uppercase">Help</h2>
              <Link href="/whats-new" className="flex min-h-11 items-center justify-between text-sm">
                What&apos;s New <span aria-hidden>›</span>
              </Link>
              <p className="text-xs text-black/50 dark:text-white/50">
                The Glossary and the New Here tour are in the app: Profile circle › Help.
              </p>
            </section>
            <FeedbackSection isCommissioner={isCommissioner} />
          </div>
        )}
      </div>
    </div>
  );
}
