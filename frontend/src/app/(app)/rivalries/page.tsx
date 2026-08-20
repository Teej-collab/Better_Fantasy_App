import { listRivalries } from "@/lib/api";

export default async function RivalriesPage() {
  const { rivalries } = await listRivalries();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Rivalries</h1>

      {rivalries.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No rivalries recorded.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rivalries.map((r) => (
            <li key={r.id} className="rounded-lg border border-black/10 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="font-medium">
                  {r.emoji && <span className="mr-1">{r.emoji}</span>}
                  {r.name ?? `${r.owner_a_name} vs ${r.owner_b_name}`}
                </h2>
                {r.tier && (
                  <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                    {r.tier}
                  </span>
                )}
              </div>
              {r.tagline && <p className="mt-1 text-sm italic text-black/60 dark:text-white/60">{r.tagline}</p>}
              {r.description && <p className="mt-2 text-sm text-black/70 dark:text-white/70">{r.description}</p>}
              <div className="mt-3 flex items-center justify-between text-sm">
                <a href={`/owners/${r.owner_a_id}`} className="hover:underline">
                  {r.owner_a_name}
                </a>
                <span className="tabular-nums text-black/50 dark:text-white/50">
                  {r.all_time_wins_a}-{r.all_time_wins_b}
                </span>
                <a href={`/owners/${r.owner_b_id}`} className="hover:underline">
                  {r.owner_b_name}
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
