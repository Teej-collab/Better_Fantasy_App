import { nflTeamColor } from "@/lib/nfl-teams";
import type { LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const SCORE_EMOJI: Record<string, string> = { TD: "🏈", FG: "🎯", SAFETY: "🛡️", "2PT": "✌️" };

/**
 * A compact chronological summary of how the score developed — the
 * "how did we get here" companion to the live score up in GameHeader.
 */
export function ScoringSummary({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  if (game.scoring_plays.length === 0) return null;

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
      style={beta ? undefined : panelGlowStyle(SECTION_COLORS.awards)}
    >
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Scoring</h2>
      <ol className="flex flex-col gap-3">
        {[...game.scoring_plays].reverse().map((sp) => {
          const color = nflTeamColor(sp.team_abbr);
          return (
            <li key={sp.play_id} className="flex flex-col gap-0.5 text-sm">
              <div className="flex items-center justify-between text-xs text-black/50 dark:text-white/50">
                <span className="tabular-nums">
                  Q{sp.period} {sp.clock}
                </span>
                <span className="tabular-nums">
                  {sp.away_score_after} – {sp.home_score_after}
                </span>
              </div>
              <p>
                <span aria-hidden>{SCORE_EMOJI[sp.score_type] ?? "🏈"}</span>{" "}
                <span className="font-semibold" style={{ color: color ?? undefined }}>
                  {sp.team_abbr} {sp.score_type}
                </span>
              </p>
              <p className="text-black/60 dark:text-white/60">{sp.description}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
