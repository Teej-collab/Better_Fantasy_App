import { API_BASE_URL } from "@/lib/api";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      {error === "not_a_league_member" && (
        <p className="max-w-sm text-sm text-red-700 dark:text-red-400">
          That Discord account isn&apos;t linked to a team in this league. If
          you think that&apos;s wrong, check with your commissioner.
        </p>
      )}

      <a
        href={`${API_BASE_URL}/auth/discord/login`}
        className="rounded-full bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]"
      >
        Sign in with Discord
      </a>
    </div>
  );
}
