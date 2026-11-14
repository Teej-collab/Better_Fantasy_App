package app.theweekend.tv

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Your matchup this week, from GET /me/week (backend app/domain/your_week.py). */
data class MyWeek(
    val season: Int,
    val week: Int,
    val teamName: String,
    val record: String?,
    val started: Boolean,
    val myScore: Double?,
    val myProjected: Double?,
    val myYetToPlay: Int,
    val myInPlay: Int,
    val oppTeamName: String,
    val oppOwnerName: String?,
    val oppRecord: String?,
    val oppScore: Double?,
    val oppProjected: Double?,
    val oppYetToPlay: Int,
    val oppInPlay: Int,
    /** Percent, 0-100. An estimate (normal model on live projections), never a fact. */
    val winProbability: Double?,
    val matchupId: Int?,
    val myLogoUrl: String?,
    val oppLogoUrl: String?,
)

data class RosterPlayer(
    val id: String,
    val name: String,
    val position: String?,
    val proTeam: String?,
    val slot: String?,
    val points: Double?,
) {
    val starting: Boolean get() = slot != null && slot !in setOf("BE", "IR", "TAXI")
}

data class TickerMatchup(val home: String, val homeScore: Double?, val away: String, val awayScore: Double?)

/** One NFL game off ESPN's scoreboard, via GET /nfl/scoreboard. */
data class NflGame(
    val id: String,
    val home: String,
    val away: String,
    val homeScore: String?,
    val awayScore: String?,
    /** "pre" | "in" | "post" */
    val state: String,
    val statusDetail: String?,
    val kickoff: Instant?,
    val broadcast: String?,
) {
    val live: Boolean get() = state == "in"
    fun has(team: String?) = team != null && (team == home || team == away)
}

/** One side of a matchup, from /seasons/{s}/weeks/{w}/matchup-context. */
data class Side(
    val teamId: Int,
    val teamName: String,
    val ownerName: String?,
    val logoUrl: String?,
    val score: Double?,
    val record: String?,
    val projected: Double?,
    val winProbability: Double?,
    val powerRank: Int?,
    val roster: List<RosterSpot>,
)

data class RosterSpot(
    val name: String,
    val position: String?,
    val slot: String?,
    val proTeam: String?,
    val points: Double?,
    val projected: Double?,
    val opponent: String?,
    val gameTime: String?,
) {
    val starting: Boolean get() = slot != null && slot !in setOf("BE", "IR", "TAXI")
}

data class LeagueMatchup(
    val id: Int,
    val home: Side,
    val away: Side,
    val isGameOfTheWeek: Boolean,
    val headline: String?,
    /** The AI write-up (preview before kickoff, recap after), from cached league stats only. */
    val narrative: String?,
)

data class Standing(
    val teamId: Int,
    val teamName: String,
    val ownerName: String?,
    val wins: Int,
    val losses: Int,
    val ties: Int,
    val pointsFor: Double,
    val pointsAgainst: Double,
) {
    val record: String get() = if (ties > 0) "$wins-$losses-$ties" else "$wins-$losses"
}

data class HomeData(
    val week: MyWeek?,
    val roster: List<RosterPlayer>,
    val ticker: List<TickerMatchup>,
    val games: List<NflGame>,
    val fetchedAt: Instant,
    val matchups: List<LeagueMatchup> = emptyList(),
    val standings: List<Standing> = emptyList(),
    /** Last week's recap text, once the league has released it. */
    val lastRecap: String? = null,
    val myMatchupId: Int? = null,
    val playoffTeams: Int? = null,
) {
    val myMatchup: LeagueMatchup? get() = matchups.firstOrNull { it.id == myMatchupId }
    /** My side of my matchup, decided by team name (the /me/week team). */
    fun mine(m: LeagueMatchup): Side = if (m.away.teamName == week?.teamName) m.away else m.home
    fun theirs(m: LeagueMatchup): Side = if (m.away.teamName == week?.teamName) m.home else m.away
    val myRank: Int? get() = week?.let { w -> standings.indexOfFirst { it.teamName == w.teamName }.takeIf { it >= 0 }?.plus(1) }

    /**
     * Game-day look: there are NFL games today, it's within 2 hours of the
     * first kickoff, and they aren't all over. Comes from the real schedule,
     * so Thursday/Sunday/Monday, Saturday games and holidays all just work.
     */
    fun isGameDay(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): Boolean {
        val today = LocalDate.now(zone)
        val todays = games.filter { g -> g.kickoff?.atZone(zone)?.toLocalDate() == today }
        if (todays.isEmpty()) return false
        val first = todays.mapNotNull { it.kickoff }.minOrNull() ?: return false
        return now.isAfter(first.minusSeconds(2 * 3600)) && todays.any { it.state != "post" }
    }
}

object League {
    suspend fun myWeek(token: String): MyWeek? {
        val j = Api.get("/me/week", token)
        val m = j.optJSONObject("matchup") ?: return null
        return MyWeek(
            season = j.optInt("season"),
            week = j.optInt("week"),
            teamName = j.optString("team_name"),
            record = m.optStringOrNull("record"),
            started = m.optBoolean("started"),
            myScore = m.optDoubleOrNull("my_score"),
            myProjected = m.optDoubleOrNull("my_projected_total"),
            myYetToPlay = m.optInt("my_yet_to_play"),
            myInPlay = m.optInt("my_in_play"),
            oppTeamName = m.optString("opponent_team_name"),
            oppOwnerName = m.optStringOrNull("opponent_owner_name"),
            oppRecord = m.optStringOrNull("opponent_record"),
            oppScore = m.optDoubleOrNull("opponent_score"),
            oppProjected = m.optDoubleOrNull("opponent_projected_total"),
            oppYetToPlay = m.optInt("opponent_yet_to_play"),
            oppInPlay = m.optInt("opponent_in_play"),
            winProbability = m.optDoubleOrNull("win_probability"),
            matchupId = if (m.isNull("matchup_id")) null else m.optInt("matchup_id"),
            myLogoUrl = m.optStringOrNull("my_logo_url"),
            oppLogoUrl = m.optStringOrNull("opponent_logo_url"),
        )
    }

    suspend fun roster(token: String): List<RosterPlayer> =
        Api.get("/me/team", token).optJSONArray("roster").objects().map {
            RosterPlayer(
                id = it.optString("player_id"),
                name = it.optString("player_name"),
                position = it.optStringOrNull("position"),
                proTeam = it.optStringOrNull("pro_team"),
                slot = it.optStringOrNull("lineup_slot"),
                points = it.optDoubleOrNull("points"),
            )
        }

    suspend fun ticker(token: String, season: Int, week: Int): List<TickerMatchup> =
        Api.get("/seasons/$season/weeks/$week/ticker", token).optJSONArray("items").objects().map {
            TickerMatchup(
                home = it.optString("home_team_name"),
                homeScore = it.optDoubleOrNull("home_score"),
                away = it.optString("away_team_name"),
                awayScore = it.optDoubleOrNull("away_score"),
            )
        }

    suspend fun games(): List<NflGame> =
        Api.get("/nfl/scoreboard", null).optJSONArray("games").objects().map {
            NflGame(
                id = it.optString("id"),
                home = it.optString("home_team"),
                away = it.optString("away_team"),
                homeScore = it.optStringOrNull("home_score"),
                awayScore = it.optStringOrNull("away_score"),
                state = it.optString("state", "pre"),
                statusDetail = it.optStringOrNull("status_detail"),
                kickoff = it.optStringOrNull("date")?.let(::parseEspnInstant),
                broadcast = it.optStringOrNull("broadcast"),
            )
        }

    suspend fun weekContext(token: String, season: Int, week: Int): List<LeagueMatchup> =
        Api.get("/seasons/$season/weeks/$week/matchup-context", token).optJSONArray("matchups").objects().map { m ->
            LeagueMatchup(
                id = m.optInt("matchup_id"),
                home = side(m.getJSONObject("home")),
                away = side(m.getJSONObject("away")),
                isGameOfTheWeek = m.optBoolean("is_game_of_the_week"),
                headline = m.optStringOrNull("headline"),
                narrative = m.optStringOrNull("narrative"),
            )
        }

    private fun side(j: JSONObject) = Side(
        teamId = j.optInt("team_id"),
        teamName = j.optString("team_name"),
        ownerName = j.optStringOrNull("owner_name"),
        logoUrl = j.optStringOrNull("logo_url"),
        score = j.optDoubleOrNull("score"),
        record = j.optStringOrNull("record"),
        projected = j.optDoubleOrNull("projected_total"),
        winProbability = j.optDoubleOrNull("win_probability"),
        powerRank = if (j.isNull("power_rank")) null else j.optInt("power_rank"),
        roster = j.optJSONArray("roster").objects().map {
            RosterSpot(
                name = it.optString("player_name"),
                position = it.optStringOrNull("position"),
                slot = it.optStringOrNull("lineup_slot"),
                proTeam = it.optStringOrNull("pro_team"),
                points = it.optDoubleOrNull("points_scored"),
                projected = it.optDoubleOrNull("live_projected") ?: it.optDoubleOrNull("points_projected"),
                opponent = it.optStringOrNull("next_opponent"),
                gameTime = it.optStringOrNull("game_time"),
            )
        },
    )

    suspend fun standings(token: String, season: Int): Pair<List<Standing>, Int?> {
        val j = Api.get("/seasons/$season/standings", token)
        val rows = j.optJSONArray("standings").objects().map {
            Standing(
                teamId = it.optInt("team_id"),
                teamName = it.optString("team_name"),
                ownerName = it.optStringOrNull("owner_name"),
                wins = it.optInt("wins"),
                losses = it.optInt("losses"),
                ties = it.optInt("ties"),
                pointsFor = it.optDouble("points_for", 0.0),
                pointsAgainst = it.optDouble("points_against", 0.0),
            )
        }
        return rows to (if (j.isNull("playoff_team_count")) null else j.optInt("playoff_team_count"))
    }

    suspend fun recap(token: String, season: Int, week: Int): String? =
        Api.get("/seasons/$season/weeks/$week/recap", token).optJSONObject("narrative")?.optStringOrNull("text")

    /** Everything the home screen shows. Partial data beats none: each piece fails on its own. */
    suspend fun home(token: String): HomeData {
        val games = runCatching { games() }.getOrDefault(emptyList())
        val week = try {
            myWeek(token)
        } catch (e: ApiError) {
            if (e.status == 401) throw e  // disconnected: the caller sends the TV back to pairing
            null
        }
        val roster = runCatching { roster(token) }.getOrDefault(emptyList())
        val ticker = week?.let { w -> runCatching { ticker(token, w.season, w.week) }.getOrDefault(emptyList()) }
            ?: emptyList()
        if (week == null) return HomeData(null, roster, ticker, games, Instant.now())
        val matchups = runCatching { weekContext(token, week.season, week.week) }.getOrDefault(emptyList())
        val (standings, playoffTeams) = runCatching { standings(token, week.season) }.getOrDefault(emptyList<Standing>() to null)
        val recap = if (week.week > 1) runCatching { recap(token, week.season, week.week - 1) }.getOrNull() else null
        return HomeData(
            week, roster, ticker, games, Instant.now(),
            matchups = matchups, standings = standings, lastRecap = recap,
            myMatchupId = week.matchupId, playoffTeams = playoffTeams,
        )
    }
}

/** ESPN writes kickoffs like "2026-11-15T18:00Z" (no seconds). */
fun parseEspnInstant(raw: String): Instant? =
    runCatching { Instant.parse(raw) }.getOrNull()
        ?: runCatching { Instant.parse(raw.removeSuffix("Z") + ":00Z") }.getOrNull()

fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key) || !has(key)) null else optString(key).takeIf { it.isNotEmpty() }

fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (isNull(key) || !has(key)) null else optDouble(key).takeIf { !it.isNaN() }

fun fmt(points: Double?): String = points?.let { String.format("%.1f", it) } ?: "–"
