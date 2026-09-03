import Link from "next/link";
import type { MySettings } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { ChatSection } from "@/components/settings/ChatSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { NavigationSection } from "@/components/settings/NavigationSection";
import { AccountSection } from "@/components/settings/AccountSection";
import { FeedbackSection } from "@/components/settings/FeedbackSection";

const SECTIONS = [
  { key: "profile", label: "Profile" },
  { key: "notifications", label: "Notifications" },
  { key: "chat", label: "Chat" },
  { key: "appearance", label: "Appearance" },
  { key: "navigation", label: "Navigation" },
  { key: "account", label: "Account & Security" },
  { key: "feedback", label: "Feedback" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isSectionKey(value: string | undefined): value is SectionKey {
  return SECTIONS.some((s) => s.key === value);
}

/**
 * Desktop: persistent sidebar + content pane, both always visible.
 * Mobile: an index list of section rows when no `?section=` is in the
 * URL, or just the active section (with a back link) when there is —
 * both driven by the same server-rendered `section` query param, so
 * the browser back button and direct links (e.g. the account menu's
 * "Notifications" item, which links straight to
 * /settings?section=notifications) both just work without any client
 * state duplicating what the URL already says.
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
  const active: SectionKey = isSectionKey(section) ? section : "profile";

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
      {!section && <BackButton fallbackHref="/" label="Home" />}
      <nav
        aria-label="Settings sections"
        className={`flex-col gap-0.5 sm:flex sm:w-52 sm:shrink-0 ${section ? "hidden sm:flex" : "flex"}`}
      >
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={`/settings?section=${s.key}`}
            aria-current={active === s.key ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors sm:py-2 ${
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
      </nav>

      <div className={`min-w-0 flex-1 ${section ? "block" : "hidden sm:block"}`}>
        {section && <BackButton fallbackHref="/settings" label="Settings" />}
        {active === "profile" && <ProfileSection initial={initial} />}
        {active === "notifications" && <NotificationsSection />}
        {active === "chat" && <ChatSection />}
        {active === "appearance" && <AppearanceSection />}
        {active === "navigation" && <NavigationSection />}
        {active === "account" && <AccountSection initial={initial} />}
        {active === "feedback" && <FeedbackSection isCommissioner={isCommissioner} />}
      </div>
    </div>
  );
}
