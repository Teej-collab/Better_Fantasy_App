package app.theweekend.tv

import java.time.Instant

/** A starter who won't play, while there's still time to swap him. */
data class LineupAlert(val playerName: String, val why: String, val kickoff: Instant?) {
    /** "McCaffrey OUT" */
    val short: String get() = "${playerName.substringAfterLast(' ')} $why"
}

/** Injury designations that mean he won't (or almost surely won't) play. */
private val SITTING = setOf("OUT", "IR", "PUP", "SUS", "SUSPENDED", "DOUBTFUL", "NA")

/**
 * Your starters who are out, doubtful, on a bye, or named inactive
 * (`inactive`, from the live line) and whose game hasn't started: the
 * window where swapping them still counts. Soonest kickoff first.
 */
fun lineupAlerts(roster: List<RosterPlayer>, games: List<NflGame>, inactive: Set<String> = emptySet()): List<LineupAlert> =
    roster.filter { it.starting }.mapNotNull { p ->
        val game = games.firstOrNull { it.has(p.proTeam) }
        val why = when {
            p.name in inactive -> "INACTIVE"
            p.onBye -> "ON BYE"
            p.injury?.uppercase() in SITTING -> p.injury!!.uppercase().let { if (it == "SUS") "SUSPENDED" else it }
            else -> return@mapNotNull null
        }
        // Once his game is underway (or over) it's too late to matter; a bye has no game.
        if (game != null && game.state != "pre") return@mapNotNull null
        LineupAlert(p.name, why, game?.kickoff)
    }.sortedBy { it.kickoff ?: Instant.MAX }
