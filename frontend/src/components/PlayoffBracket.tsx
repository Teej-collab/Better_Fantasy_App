import type { PlayoffBracketNode } from "@/lib/api";

function roundLabel(round: number, maxRound: number): string {
  if (round === maxRound) return "Final";
  if (round === maxRound - 1) return "Semifinals";
  if (round === maxRound - 2) return "Quarterfinals";
  return `Round ${round}`;
}

function TeamRow({
  name,
  seed,
  score,
  isWinner,
}: {
  name: string | null;
  seed: number | null;
  score: string | null;
  isWinner: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${isWinner ? "font-semibold" : "text-black/70 dark:text-white/70"}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {seed !== null && <span className="w-4 shrink-0 text-xs text-black/40 dark:text-white/40">{seed}</span>}
        <span className="truncate">{name ?? <span className="text-black/40 dark:text-white/40">TBD</span>}</span>
        {isWinner && <span className="shrink-0 text-emerald-500">&#10003;</span>}
      </span>
      {score !== null && (
        <span className="shrink-0 tabular-nums text-black/60 dark:text-white/60">{Number(score).toFixed(1)}</span>
      )}
    </div>
  );
}

function BracketNodeCard({ node }: { node: PlayoffBracketNode }) {
  return (
    <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
      <TeamRow
        name={node.team_a_name}
        seed={node.team_a_seed}
        score={node.team_a_score}
        isWinner={node.winner_team_id !== null && node.winner_team_id === node.team_a_id}
      />
      <TeamRow
        name={node.team_b_name}
        seed={node.team_b_seed}
        score={node.team_b_score}
        isWinner={node.winner_team_id !== null && node.winner_team_id === node.team_b_id}
      />
    </div>
  );
}

/**
 * The real in-app playoff bracket (backend/app/domain/playoffs.py) —
 * no ESPN read anywhere behind this. Renders nothing before a
 * commissioner has generated one for this season (nodes.length === 0),
 * same "no line rather than a fabricated one" restraint the standings
 * page's own playoff-line divider already follows. A later round's
 * still-unresolved slot shows "TBD" on both sides until its two
 * feeding rounds each produce a winner.
 */
export function PlayoffBracket({ nodes }: { nodes: PlayoffBracketNode[] }) {
  if (nodes.length === 0) return null;

  const rounds = Array.from(new Set(nodes.map((n) => n.round))).sort((a, b) => a - b);
  const maxRound = Math.max(...rounds);

  return (
    <div className="neon-panel flex flex-col gap-3 rounded-lg bg-black/[0.015] p-4 dark:bg-white/[0.03]">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Playoff Bracket
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-1">
        {rounds.map((round) => (
          <div key={round} className="flex min-w-[200px] flex-col gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-black/40 uppercase dark:text-white/40">
              {roundLabel(round, maxRound)}
            </h3>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {nodes
                .filter((n) => n.round === round)
                .sort((a, b) => a.slot - b.slot)
                .map((node) => (
                  <BracketNodeCard key={node.id} node={node} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
