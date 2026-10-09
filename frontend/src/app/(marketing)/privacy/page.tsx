import type { Metadata } from "next";
import { LegalContact, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

// Every data category and vendor named here is one the app actually
// uses today (backend/app/providers, notifications, auth). Update this
// page whenever a new one is added, since the App Store and Play Store
// listings both link to it.
export const metadata: Metadata = {
  title: "Privacy Policy — The Weekend",
  description: "What The Weekend collects, why, who it's shared with, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        The Weekend is a free fantasy football app for private leagues. This page explains what we collect when you
        use the website or the iOS/Android app, what we do with it, and how to get it deleted. We don&apos;t sell your
        data, we don&apos;t show ads, and we don&apos;t use third-party ad or tracking networks.
      </p>

      <LegalSection title="What we collect">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Account info:</strong> your display name and email address. If you sign up with a password, we
            store it only as a one-way hash. If you sign in with Discord, Google, or Apple, we receive your account ID,
            name, and email from them (Apple can give us a private relay address instead of your real one). We never
            see your Discord, Google, or Apple password.
          </li>
          <li>
            <strong>League activity:</strong> your teams, rosters, lineups, draft picks, trades, waiver claims, poll
            votes, and settings.
          </li>
          <li>
            <strong>Things you post:</strong> chat messages, direct messages, images and GIFs you send, feedback you
            submit (and any screenshot you attach), team logos, and chug videos you upload (only in leagues that turn on the optional chug board,
            which is for members 21 and older).
          </li>
          <li>
            <strong>ESPN league credentials:</strong> if a commissioner connects an ESPN league, we store the ESPN
            cookies they provide so we can sync that league. They&apos;re used for nothing else.
          </li>
          <li>
            <strong>Notification tokens:</strong> if you turn on push notifications, we store the token your device
            or browser gives us so we can deliver them. On iPhone, that includes the tokens that keep your live score
            on the Lock Screen and in the Dynamic Island up to date.
          </li>
          <li>
            <strong>Camera and microphone:</strong> only when you use them, for photos in chat, scanning invite codes,
            and live video and voice in the Lounge. Lounge video and voice are live and aren&apos;t recorded.
          </li>
          <li>
            <strong>Usage and diagnostics:</strong> which pages you open, when you&apos;re online (so your league can
            see who&apos;s around), and error and crash reports. These include your device type, platform, screen
            size, and app version. We also log IP addresses to rate-limit sign-in attempts and block abuse.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <p>
          We use your information to run the app: to sign you in, run your league, deliver chat and notifications,
          send password-reset emails, generate league recaps and write-ups, and find and fix bugs. League content is
          visible to the other members of your league. It isn&apos;t public.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>
          We share data only with the service providers that run the app for us, and only what each one needs:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Vercel (website hosting and chat image storage)</li>
          <li>Railway (servers and chug video storage)</li>
          <li>Supabase (database)</li>
          <li>Anthropic (writes AI recaps and write-ups from league stats and results)</li>
          <li>LiveKit (live voice and video in watch parties)</li>
          <li>GIPHY (GIF search. Your search terms go to GIPHY.)</li>
          <li>Resend (password-reset and account emails, and forwarding feedback to us)</li>
          <li>Apple and Google (delivering push notifications)</li>
          <li>Discord, Google, and Apple (only if you choose to sign in with them)</li>
          <li>Expo (delivering app updates. It sees your device type and network address when the app checks for one.)</li>
          <li>ESPN (only for a league whose commissioner connects it, to read that league&apos;s data)</li>
        </ul>
        <p>
          Each of these providers may use your information only to provide its service to us, and is required to
          protect it at least as well as this policy does.
        </p>
        <p>
          We may also disclose information if the law requires it, or to protect the safety of our users or the
          service.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          We use a secure sign-in cookie to keep you logged in, and a few small cookies and local-storage entries to
          remember your appearance settings (theme, accent color, animations). There are no advertising or
          cross-site tracking cookies, so we don&apos;t need to ask for cookie consent. Because we don&apos;t track you
          across other sites or apps, there&apos;s nothing for Do Not Track or Global Privacy Control signals to turn
          off.
        </p>
      </LegalSection>

      <LegalSection title="Keeping and deleting your data">
        <p>
          We keep your data for as long as your account exists. You can delete your account at any time from{" "}
          <strong>Settings → Account → Delete account</strong>. That removes your login, your connected sign-in
          accounts (and revokes Sign in with Apple), your league memberships, and your feedback, and signs you out everywhere. Shared league history
          stays with your team so your league&apos;s records don&apos;t break. That includes past scores, trades,
          standings, chat messages, and chug results. If you&apos;re the only commissioner of a league, you&apos;ll
          need to hand that role to someone else first. You can turn off push notifications in Settings or in your phone&apos;s settings, and stop
          sharing your camera or microphone in your phone&apos;s settings, at any time.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can ask for a copy of your data, ask us to correct it, or ask us to delete it, wherever you live. Email
          us at <LegalContact /> and we&apos;ll respond within 30 days. We don&apos;t sell your personal information or
          share it for targeted advertising, and we won&apos;t treat you differently for using these rights.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          All traffic is encrypted with HTTPS, passwords are hashed, and uploaded videos are kept in private storage.
          Only members of your league can view them. No system is perfectly secure, but we take reasonable steps to
          protect your information. Our servers and data are in the United States.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          The Weekend isn&apos;t meant for anyone under 18, and its optional chug board is only for members 21 and
          older. We don&apos;t knowingly collect information from
          children under 13. If you believe a child has signed up, contact us and we&apos;ll delete the account.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If we change this policy, we&apos;ll update the date at the top of this page. For significant changes, we
          will also let you know in the app. For questions or privacy requests, reach us through <LegalContact />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
