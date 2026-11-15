package app.theweekend.tv

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.ZoneId

// ---------- data: GET /nfl/games/{id} (backend app/gamecast/models.py LiveGame) ----------

data class GcTeam(val abbr: String, val name: String, val score: Int)

data class GcPlay(val id: String, val period: Int, val clock: String, val text: String, val type: String, val scoring: Boolean)

data class GcDrive(val team: String, val plays: Int, val yards: Int, val duration: String, val startYardsToGoal: Int?, val result: String?)

data class GcGame(
    val id: String,
    /** scheduled | in_progress | halftime | final | postponed | canceled */
    val status: String,
    val periodLabel: String?,
    val clock: String?,
    val home: GcTeam,
    val away: GcTeam,
    val possession: String?,
    val down: Int?,
    val distance: Int?,
    val yardsToGoal: Int?,
    val fieldLabel: String?,
    val redZone: Boolean,
    val drive: GcDrive?,
    val plays: List<GcPlay>,
) {
    val live: Boolean get() = status == "in_progress" || status == "halftime"
}

/** One player in this game who matters to the league: rostered, or a free agent putting up points. */
data class GcPlayer(val id: String?, val name: String, val owner: String, val mine: Boolean, val opponent: Boolean, val points: Double?)

/** What one play earned someone in the league (GET /nfl/games/{g}/plays/{p}/fantasy). */
data class GcImpact(val text: String, val mine: Boolean)

object Gamecast {
    suspend fun game(id: String): GcGame = parse(Api.get("/nfl/games/$id", null))

    private fun team(j: JSONObject) = GcTeam(j.optString("abbr"), j.optString("name"), j.optInt("score"))

    private fun JSONObject.optIntOrNull(key: String): Int? = if (isNull(key) || !has(key)) null else optInt(key)

    fun parse(j: JSONObject) = GcGame(
        id = j.optString("game_id"),
        status = j.optString("status"),
        periodLabel = j.optStringOrNull("period_label"),
        clock = j.optStringOrNull("clock"),
        home = team(j.getJSONObject("home_team")),
        away = team(j.getJSONObject("away_team")),
        possession = j.optStringOrNull("possession_team_abbr"),
        down = j.optIntOrNull("down"),
        distance = j.optIntOrNull("distance"),
        yardsToGoal = j.optIntOrNull("yards_to_goal"),
        fieldLabel = j.optStringOrNull("field_position_label"),
        redZone = j.optBoolean("is_redzone"),
        drive = (j.optJSONObject("current_drive") ?: j.optJSONArray("drives")?.optJSONObject(0))?.let {
            GcDrive(
                team = it.optString("team_abbr"),
                plays = it.optInt("play_count"),
                yards = it.optInt("yards"),
                duration = it.optString("duration"),
                startYardsToGoal = it.optIntOrNull("start_yard_line"),
                result = it.optStringOrNull("result"),
            )
        },
        // Newest first. Bookkeeping rows (end of quarter, timeouts) aren't plays you'd want to read.
        plays = j.optJSONArray("plays").objects()
            .filter { it.optString("play_type") !in setOf("other", "timeout") && it.optString("description").isNotBlank() }
            .map {
                GcPlay(
                    id = it.optString("play_id"),
                    period = it.optInt("period"),
                    clock = it.optString("clock"),
                    text = it.optString("description"),
                    type = it.optString("play_type"),
                    scoring = it.optBoolean("is_scoring_play"),
                )
            },
    )

    /** player_id -> "248 pass yds · 2 TD", from the box score. */
    suspend fun statLines(id: String): Map<String, String> {
        val lines = LinkedHashMap<String, MutableList<String>>()
        for (t in Api.get("/nfl/games/$id/boxscore", null).optJSONArray("teams").objects()) {
            for (c in t.optJSONArray("categories").objects()) {
                val labels = c.optJSONArray("labels")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: continue
                for (a in c.optJSONArray("athletes").objects()) {
                    val pid = a.optStringOrNull("player_id") ?: continue
                    val stats = a.optJSONArray("stats")?.let { s -> (0 until s.length()).map { s.optString(it) } } ?: continue
                    fun stat(label: String) = labels.indexOf(label).takeIf { it >= 0 }?.let { stats.getOrNull(it) }
                    fun td() = stat("TD")?.toIntOrNull()?.takeIf { it > 0 }?.let { "$it TD" }
                    val part = when (c.optString("key")) {
                        "passing" -> listOfNotNull("${stat("YDS")} pass yds", td(), stat("INT")?.toIntOrNull()?.takeIf { it > 0 }?.let { "$it INT" })
                        "rushing" -> listOfNotNull("${stat("CAR")} car · ${stat("YDS")} yds", td())
                        "receiving" -> listOfNotNull("${stat("REC")} rec · ${stat("YDS")} yds", td())
                        "kicking" -> listOfNotNull(stat("FG")?.let { "$it FG" })
                        else -> emptyList()
                    }
                    if (part.isNotEmpty()) lines.getOrPut(pid) { mutableListOf() }.add(part.joinToString(" · "))
                }
            }
        }
        return lines.mapValues { it.value.joinToString(" · ") }
    }

    /** The top scorers in this game under your league's scoring, rostered or not. */
    suspend fun leaders(id: String, token: String?): List<Triple<String, String, Double>> {
        val gl = Api.get("/nfl/games/$id/fantasy-impact", token).optJSONObject("game_leaders") ?: return emptyList()
        return listOf("home", "away").flatMap { side ->
            gl.optJSONObject(side)?.optJSONArray("leaders").objects().map {
                Triple(it.optString("player_id"), it.optString("player_name"), it.optDouble("points_scored", 0.0))
            }
        }
    }

    /** Who in the league this play paid (or cost), yours first. Null when it didn't touch anyone. */
    suspend fun impact(gameId: String, playId: String, token: String?): GcImpact? {
        val players = Api.get("/nfl/games/$gameId/plays/$playId/fantasy", token).optJSONArray("players").objects()
            .filter { (it.optDoubleOrNull("points") ?: 0.0) != 0.0 }
        val p = players.firstOrNull { it.optBoolean("is_mine") } ?: players.maxByOrNull { kotlin.math.abs(it.optDouble("points")) } ?: return null
        val pts = p.optDouble("points")
        val who = if (p.optBoolean("is_mine")) "you" else (p.optStringOrNull("owner_name")?.substringBefore(' ') ?: p.optString("team_name"))
        return GcImpact((if (pts > 0) "+" else "−") + fmt(kotlin.math.abs(pts)) + " " + who, p.optBoolean("is_mine"))
    }
}

/** Each NFL team's main color, for the end zones and badges. */
private val TEAM_COLORS = mapOf(
    "ARI" to 0xFF97233F, "ATL" to 0xFFA71930, "BAL" to 0xFF241773, "BUF" to 0xFF00338D, "CAR" to 0xFF0085CA,
    "CHI" to 0xFF0B162A, "CIN" to 0xFFFB4F14, "CLE" to 0xFF311D00, "DAL" to 0xFF041E42, "DEN" to 0xFFFB4F14,
    "DET" to 0xFF0076B6, "GB" to 0xFF203731, "HOU" to 0xFF03202F, "IND" to 0xFF002C5F, "JAX" to 0xFF006778,
    "KC" to 0xFFE31837, "LAC" to 0xFF0080C6, "LAR" to 0xFF003594, "LV" to 0xFF5B6168, "MIA" to 0xFF008E97,
    "MIN" to 0xFF4F2683, "NE" to 0xFF002244, "NO" to 0xFFD3BC8D, "NYG" to 0xFF0B2265, "NYJ" to 0xFF125740,
    "PHI" to 0xFF004C54, "PIT" to 0xFFFFB612, "SF" to 0xFFAA0000, "SEA" to 0xFF002244, "TB" to 0xFFD50A0A,
    "TEN" to 0xFF0C2340, "WSH" to 0xFF5A1414,
)

private fun teamColor(abbr: String) = Color(TEAM_COLORS[abbr] ?: 0xFF1C222C)

/** The same colors as plain ints, for the overlay's Views. */
fun teamColorInt(abbr: String): Int = (TEAM_COLORS[abbr] ?: 0xFF1C222C).toInt()
private fun lightTeam(abbr: String) = abbr in setOf("PIT", "NO")

private val LOS = Color(0xFF4DA3FF)
private val FIRST_DOWN = Color(0xFFFFD400)

/**
 * One NFL game, live: score and situation, the field with the drive on it,
 * who in your league is in this game (and what they've scored under your
 * league's scoring), and the last few plays with what each one paid. OK on
 * "Watch on …" opens the app that has it; Back goes back to Scores.
 */
@Composable
fun GamecastScreen(game: NflGame, d: HomeData?, apps: List<TvApp>, token: String?) {
    val context = LocalContext.current
    var state by remember(game.id) { mutableStateOf<GcGame?>(null) }
    var lines by remember(game.id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var leaders by remember(game.id) { mutableStateOf<List<Triple<String, String, Double>>>(emptyList()) }
    val impacts = remember(game.id) { mutableStateMapOf<String, GcImpact?>() }
    var failed by remember(game.id) { mutableStateOf(false) }

    LaunchedEffect(game.id) {
        var round = 0
        while (true) {
            val s = runCatching { Gamecast.game(game.id) }.getOrNull()
            failed = s == null && state == null
            if (s != null && s != state) state = s
            // Stats and points move slower than plays: every 30 s while it's on.
            if (round % 6 == 0) {
                runCatching { Gamecast.statLines(game.id) }.onSuccess { if (it != lines) lines = it }
                runCatching { Gamecast.leaders(game.id, token) }.onSuccess { if (it != leaders) leaders = it }
            }
            s?.plays?.take(4)?.forEach { p ->
                if (p.id !in impacts) impacts[p.id] = runCatching { Gamecast.impact(game.id, p.id, token) }.getOrNull()
            }
            round++
            delay(if (s?.live == true) 5_000L else 60_000L)
        }
    }

    val g = state
    if (g == null) return Empty(if (failed) "Can't load this game right now." else "Loading ${game.away} @ ${game.home}…")
    val app = Apps.forBroadcast(apps, game.broadcast)
    val watch = remember { FocusRequester() }
    LaunchedEffect(app != null) { if (app != null) runCatching { watch.requestFocus() } }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Scoreboard(g, game, app?.label, watch) { app?.let { Apps.launch(context, it.packageName) } }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.weight(1.6f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Field(g, Modifier.fillMaxWidth().height(160.dp))
                SectionLabel("Last plays · fantasy impact")
                if (g.plays.isEmpty()) BasicText(if (g.status == "scheduled") "Plays show up here from kickoff." else "No plays yet.", style = W.body(13, W.Muted))
                g.plays.take(4).forEach { p -> PlayRow(p, impacts[p.id]) }
            }
            LeaguePlayers(g, d, lines, leaders, Modifier.weight(1f).fillMaxHeight())
        }
    }
}

@Composable
private fun Scoreboard(g: GcGame, game: NflGame, appLabel: String?, watch: FocusRequester, onWatch: () -> Unit) {
    val zone = ZoneId.systemDefault()
    Row(
        Modifier.fillMaxWidth().height(64.dp).background(W.Surface, RoundedCornerShape(16.dp)).border(1.dp, W.Line, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TeamScore(g.away, g.possession == g.away.abbr && g.live, g.status != "scheduled")
        Spacer(Modifier.width(24.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(190.dp)) {
            val head = when (g.status) {
                "scheduled" -> game.kickoff?.atZone(zone)?.format(KICK) ?: "Not started"
                "final" -> "Final"
                "halftime" -> "Halftime"
                else -> listOfNotNull(g.periodLabel, g.clock).joinToString(" · ")
            }
            BasicText(head, style = W.big(20, if (g.live) W.Text else W.Muted))
            val situation = if (g.live && g.down != null && g.down > 0 && g.distance != null) {
                val dist = if (g.yardsToGoal != null && g.distance >= g.yardsToGoal) "Goal" else "${g.distance}"
                "${ordinal(g.down)} & $dist" + (g.fieldLabel?.let { " · $it" } ?: "")
            } else null
            situation?.let { BasicText(it, style = W.body(12, if (g.redZone) W.Orange else W.Neon, bold = true)) }
        }
        Spacer(Modifier.width(24.dp))
        TeamScore(g.home, g.possession == g.home.abbr && g.live, g.status != "scheduled", home = true)
        Spacer(Modifier.weight(1f))
        if (appLabel != null) {
            Focusable(
                modifier = Modifier.height(40.dp).focusRequester(watch),
                corner = 20.dp,
                background = W.Raised,
                onClick = onWatch,
            ) { focused ->
                BasicText(
                    "WATCH ON ${appLabel.uppercase()}",
                    style = W.label(if (focused) W.Night else W.Neon),
                    maxLines = 1, softWrap = false,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 18.dp),
                )
            }
        } else if (game.broadcast != null) {
            BasicText("${game.broadcast} · not in your apps", style = W.body(12, W.Stale, bold = true))
        }
    }
}

@Composable
private fun TeamScore(t: GcTeam, ball: Boolean, showScore: Boolean, home: Boolean = false) {
    val badge = @Composable {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(teamColor(t.abbr)), contentAlignment = Alignment.Center) {
            BasicText(t.abbr, style = W.big(15, if (lightTeam(t.abbr)) W.Night else W.Text))
        }
    }
    val name = @Composable {
        Column(horizontalAlignment = if (home) Alignment.End else Alignment.Start) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (ball && home) { BallDot(); Spacer(Modifier.width(5.dp)) }
                BasicText(t.name.substringAfterLast(' '), style = W.body(14, bold = true), maxLines = 1)
                if (ball && !home) { Spacer(Modifier.width(5.dp)); BallDot() }
            }
            BasicText(if (home) "Home" else "Away", style = W.body(11, W.Muted))
        }
    }
    val score = @Composable { BasicText(if (showScore) "${t.score}" else "", style = W.big(36)) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (home) { score(); name(); badge() } else { badge(); name(); score() }
    }
}

@Composable
private fun BallDot() = Box(Modifier.size(8.dp).clip(CircleShape).background(W.Neon))

private fun ordinal(n: Int) = when (n) { 1 -> "1st"; 2 -> "2nd"; 3 -> "3rd"; else -> "${n}th" }

/**
 * The field: away team's end zone on the left, home's on the right. The
 * neon bar is this drive so far, blue the line of scrimmage, yellow the
 * line to gain.
 */
@Composable
private fun Field(g: GcGame, modifier: Modifier) {
    val shape = RoundedCornerShape(16.dp)
    val awayColor = teamColor(g.away.abbr)
    val homeColor = teamColor(g.home.abbr)
    // Spots as yards from the left goal line. The home team attacks the left end zone.
    fun spot(team: String, yardsToGoal: Int) = if (team == g.home.abbr) yardsToGoal else 100 - yardsToGoal
    val ball = if (g.live && g.possession != null && g.yardsToGoal != null) spot(g.possession, g.yardsToGoal) else null
    val toGain = if (ball != null && g.distance != null && g.distance > 0 && g.distance < (g.yardsToGoal ?: 0)) {
        if (g.possession == g.home.abbr) ball - g.distance else ball + g.distance
    } else null
    val dr = g.drive
    val driveStart = if (ball != null && dr != null && dr.team == g.possession && dr.startYardsToGoal != null) spot(dr.team, dr.startYardsToGoal) else null

    Box(modifier.clip(shape).border(1.dp, W.Line, shape)) {
        Canvas(Modifier.fillMaxSize()) {
            val ez = size.width / 12f  // 10-yard end zones on a 120-yard field
            val yd = (size.width - 2 * ez) / 100f
            fun x(yards: Int) = ez + yards * yd
            drawRect(Color(0xFF163A1F))
            for (i in 0 until 10 step 2) drawRect(Color(0xFF1A4224), Offset(x(i * 10), 0f), Size(10 * yd, size.height))
            drawRect(awayColor, Offset.Zero, Size(ez, size.height))
            drawRect(homeColor, Offset(size.width - ez, 0f), Size(ez, size.height))
            for (i in 1..9) drawLine(Color.White.copy(alpha = 0.3f), Offset(x(i * 10), 0f), Offset(x(i * 10), size.height), 2f)
            if (ball != null) {
                if (driveStart != null && driveStart != ball) {
                    val l = x(minOf(driveStart, ball)); val r = x(maxOf(driveStart, ball))
                    drawRoundRect(W.Neon.copy(alpha = 0.85f), Offset(l, size.height / 2 - 5.dp.toPx()), Size(r - l, 10.dp.toPx()), CornerRadius(5.dp.toPx()))
                }
                toGain?.let { drawLine(FIRST_DOWN, Offset(x(it), 0f), Offset(x(it), size.height), 3.dp.toPx() / 1.5f) }
                drawLine(LOS, Offset(x(ball), 0f), Offset(x(ball), size.height), 3.dp.toPx() / 1.5f)
                drawCircle(Color(0xFF8B5A2B), 7.dp.toPx(), Offset(x(ball), size.height / 2))
            }
        }
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            val caption = when {
                dr == null -> null
                ball != null -> "Drive · ${dr.plays} plays · ${dr.yards} yds · ${dr.duration}"
                else -> "Last drive · ${dr.team} · ${dr.plays} plays · ${dr.yards} yds" + (dr.result?.let { " · ${if (it == "END_OF_HALF" && g.status == "final") "end of game" else driveResult(it)}" } ?: "")
            }
            caption?.let { BasicText(it, style = W.body(12, W.Text, bold = true), modifier = Modifier.background(W.Night.copy(alpha = 0.8f), RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) }
            Spacer(Modifier.weight(1f))
            if (ball != null) {
                Row(Modifier.background(W.Night.copy(alpha = 0.8f), RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp, 3.dp).background(LOS)); Spacer(Modifier.width(5.dp))
                    BasicText("scrimmage", style = W.body(11, W.Muted)); Spacer(Modifier.width(10.dp))
                    if (toGain != null) {
                        Box(Modifier.size(10.dp, 3.dp).background(FIRST_DOWN)); Spacer(Modifier.width(5.dp))
                        BasicText("first down", style = W.body(11, W.Muted))
                    }
                }
            }
        }
    }
}

private fun driveResult(r: String) = when (r) {
    "TD" -> "touchdown"; "FG" -> "field goal"; "PUNT" -> "punt"; "TURNOVER" -> "turnover"; "END_OF_HALF" -> "end of half"
    else -> r.lowercase().replace('_', ' ')
}

@Composable
private fun PlayRow(p: GcPlay, impact: GcImpact?) {
    Row(
        Modifier.fillMaxWidth().height(38.dp).background(W.Surface, RoundedCornerShape(12.dp))
            .border(1.dp, if (p.scoring) W.Neon else W.Line, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicText("Q${p.period} ${p.clock}", style = W.body(12, W.Muted, bold = true), modifier = Modifier.width(70.dp))
        BasicText(p.text, style = W.body(13, Color(0xFFE6E9EF)), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        impact?.let {
            Spacer(Modifier.width(10.dp))
            BasicText(it.text, style = W.body(13, if (it.mine) W.Orange else W.Muted, bold = true))
        }
    }
}

/** Everyone in the league with a player in this game, yours first; then free agents doing damage. */
@Composable
private fun LeaguePlayers(g: GcGame, d: HomeData?, lines: Map<String, String>, leaders: List<Triple<String, String, Double>>, modifier: Modifier) {
    val teams = setOf(g.home.abbr, g.away.abbr)
    val my = d?.myMatchup
    val mySide = my?.let { d.mine(it) }
    val oppSide = my?.let { d.theirs(it) }
    val rostered = d?.matchups.orEmpty().flatMap { listOf(it.home, it.away) }.distinctBy { it.teamId }.flatMap { side ->
        side.roster.filter { it.proTeam in teams }.map { p ->
            val mine = side.teamId == mySide?.teamId
            GcPlayer(
                id = p.id, name = p.name,
                owner = when {
                    mine -> "YOU · ${side.teamName}"
                    side.teamId == oppSide?.teamId -> "OPPONENT · ${side.ownerName?.substringBefore(' ') ?: side.teamName}"
                    else -> listOfNotNull(side.ownerName?.substringBefore(' '), side.teamName).joinToString(" · ")
                } + if (!p.starting) " · bench" else "",
                mine = mine, opponent = side.teamId == oppSide?.teamId, points = p.points,
            )
        }
    }
    val owned = rostered.mapNotNull { it.id }.toSet()
    val free = leaders.filter { it.first !in owned && it.third >= 5.0 }
        .map { GcPlayer(it.first, it.second, "Free agent", mine = false, opponent = false, points = it.third) }
    val players = (rostered.sortedWith(compareBy({ if (it.mine) 0 else if (it.opponent) 1 else 2 }, { -(it.points ?: 0.0) })) + free).take(5)

    Column(
        modifier.background(W.Surface, RoundedCornerShape(16.dp)).border(1.dp, W.Line, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SectionLabel("Your league in this game")
        if (players.isEmpty()) BasicText("Nobody in your league has a player in this game.", style = W.body(13, W.Muted))
        players.forEach { p ->
            Row(
                Modifier.fillMaxWidth()
                    .background(if (p.mine) Color(0xFF221A12) else W.Surface, RoundedCornerShape(12.dp))
                    .border(1.dp, if (p.mine) W.Orange.copy(alpha = 0.55f) else W.Line, RoundedCornerShape(12.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    BasicText(p.name, style = W.body(14, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    BasicText(p.owner, style = W.body(10, if (p.mine) W.Orange else if (p.owner == "Free agent") W.Dim else W.Muted, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    p.id?.let { lines[it] }?.let { BasicText(it, style = W.body(10, W.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                Spacer(Modifier.width(8.dp))
                BasicText(fmt(p.points), style = W.big(22, if ((p.points ?: 0.0) >= 15) W.Neon else if (p.owner == "Free agent") W.Muted else W.Text))
            }
        }
        Spacer(Modifier.weight(1f))
        BasicText("Points use your league's scoring.", style = W.body(10, W.Dim))
    }
}
