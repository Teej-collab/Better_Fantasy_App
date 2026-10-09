import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — The Weekend",
  description: "The rules for using The Weekend.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        By creating an account or using The Weekend (the website and the iOS/Android app), you agree to these
        terms. If you don&apos;t agree, please don&apos;t use the app.
      </p>

      <LegalSection title="Who can use it">
        <p>
          You must be at least 18 to use The Weekend. The chug board is optional: each league&apos;s commissioner
          decides whether to turn it on. Where it is on, it&apos;s only for members 21 or older, the legal drinking age
          in the United States (or older, where the local drinking age is higher). Never drink and drive. Keep your sign-in details to yourself. You&apos;re
          responsible for anything done from your account.
        </p>
      </LegalSection>

      <LegalSection title="It's free, and there's no gambling">
        <p>
          The Weekend is free. We don&apos;t take entry fees, hold money, or pay out prizes. If your league plays
          for money or side bets, that stays between the league members. The Weekend isn&apos;t a party to it and
          isn&apos;t responsible for it. Follow the laws that apply where you live.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You own what you post: messages, images, logos, videos, and so on. By posting it, you give us permission to
          store it and show it to the members of your league, which we need to run the app. Don&apos;t post anything
          that&apos;s illegal, that harasses or threatens someone, that you don&apos;t have the right to share, or
          that shows someone who hasn&apos;t agreed to be in it.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          Don&apos;t try to break, overload, or get around the app&apos;s security. Don&apos;t access other
          leagues&apos; data or other people&apos;s accounts, and don&apos;t scrape or resell the service.
          Commissioners can manage their own league. We can suspend or remove accounts that break these rules.
        </p>
      </LegalSection>

      <LegalSection title="Stats, scores, and AI write-ups">
        <p>
          Scores and player data come from third-party sources and can be delayed or wrong. Recaps, grades, and
          roasts are generated automatically by AI and are meant for fun. Your league&apos;s own rules and your
          commissioner&apos;s decisions settle any dispute, not us. The Weekend isn&apos;t affiliated with the
          NFL, ESPN, Sleeper, or Yahoo.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          We provide the app &ldquo;as is&rdquo;, with no guarantees that it will always be available, accurate, or
          free of bugs. As far as the law allows, we aren&apos;t liable for indirect or consequential damages arising
          from your use of the app, including lost data or a lineup that didn&apos;t set. Since the app is free, our
          total liability is limited to $0 where the law allows that.
        </p>
      </LegalSection>

      <LegalSection title="Ending your account">
        <p>
          You can delete your account at any time from Settings. We may change, pause, or shut down the service. If
          we shut it down, we&apos;ll try to give you reasonable notice first.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          We may update these terms. If we do, we&apos;ll change the date at the top, and if you keep using the app,
          you accept the new version. Our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          explains how we handle your data. For questions, reach us through <LegalContact />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
