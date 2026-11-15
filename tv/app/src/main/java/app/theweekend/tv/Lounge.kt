package app.theweekend.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Duration
import java.time.Instant

// ---------- data ----------

data class PowerRow(val rank: Int, val teamName: String, val ownerName: String?, val movement: Int?)

data class BetRow(val name: String, val wins: Int, val losses: Int, val units: Double, val streak: String?, val me: Boolean)

data class CommishPost(val title: String, val body: String, val at: Instant?)

data class LoungeData(
    val powerWeek: Int?,
    val power: List<PowerRow>,
    val bets: List<BetRow>?,
    val post: CommishPost?,
    val activity: List<Pair<String, String>>,
)

object LoungeApi {
    /** Everything the Lounge shows besides the recap (that comes with the home data). Each piece fails on its own. */
    suspend fun load(token: String, season: Int, fromCache: Boolean = false): LoungeData = coroutineScope {
        val power = async {
            runCatching {
                val week = Api.get("/seasons/$season/power-rankings/latest-week", token, fromCache).let { if (it.isNull("week")) null else it.optInt("week") }
                    ?: return@runCatching null to emptyList<PowerRow>()
                week to Api.get("/seasons/$season/weeks/$week/power-rankings", token, fromCache).optJSONArray("rankings").objects().map {
                    PowerRow(
                        rank = it.optInt("power_rank"),
                        teamName = it.optString("team_name"),
                        ownerName = it.optStringOrNull("owner_name"),
                        movement = if (it.isNull("movement")) null else it.optInt("movement"),
                    )
                }.sortedBy { it.rank }
            }.getOrDefault(null to emptyList())
        }
        val bets = async {
            // Null when the league doesn't do bets (409), so the card can say so.
            runCatching {
                Api.get("/bets/league/board?range=season", token, fromCache).optJSONArray("rows").objects().map {
                    BetRow(
                        name = it.optString("name"),
                        wins = it.optInt("wins"),
                        losses = it.optInt("losses"),
                        units = it.optDouble("units", 0.0),
                        streak = it.optStringOrNull("streak"),
                        me = it.optBoolean("me"),
                    )
                }
            }.getOrNull()
        }
        val post = async {
            runCatching {
                Api.get("/tv/commish-post", token, fromCache).optJSONObject("post")?.let {
                    CommishPost(it.optString("title"), it.optString("body"), it.optStringOrNull("created_at")?.let { t -> runCatching { java.time.OffsetDateTime.parse(t).toInstant() }.getOrNull() })
                }
            }.getOrNull()
        }
        val activity = async {
            runCatching {
                Api.get("/seasons/$season/activity?limit=4", token, fromCache).optJSONArray("items").objects().mapNotNull(::activityLine)
            }.getOrDefault(emptyList())
        }
        val (week, rows) = power.await()
        LoungeData(week, rows, bets.await(), post.await(), activity.await())
    }

    /** "TRADE" to "Dave and Alex: D. Henry, G. Wilson" style lines (backend app/domain/league_activity.py). */
    private fun activityLine(j: JSONObject): Pair<String, String>? = when (j.optString("kind")) {
        "trade" -> {
            val who = listOfNotNull(j.optStringOrNull("proposing_owner_name"), j.optStringOrNull("receiving_owner_name")).joinToString(" and ") { it.substringBefore(' ') }
            val assets = j.optJSONArray("assets").objects().map { it.optString("player_name") }.filter { it.isNotBlank() }
            "TRADE" to "$who swap ${assets.joinToString(", ").ifEmpty { "players" }}"
        }
        "roster" -> {
            val who = (j.optStringOrNull("owner_name") ?: j.optString("team_name")).substringBefore(' ')
            val add = j.optStringOrNull("added_player_name")
            val drop = j.optStringOrNull("dropped_player_name")
            val label = if (j.optString("source").contains("waiver", ignoreCase = true)) "WAIVER" else "ADD"
            when {
                add != null && drop != null -> label to "$who adds $add, drops $drop"
                add != null -> label to "$who adds $add"
                drop != null -> "DROP" to "$who drops $drop"
                else -> null
            }
        }
        else -> null
    }
}

// ---------- screen ----------

private val UP = Color(0xFF39FF14)
private val DOWN = Color(0xFFFF8A7A)

/**
 * League Lounge: the league between games. Last week's recap (OK reads it
 * in full), power rankings, the bets board, the commissioner's latest
 * post (OK reads it) and recent trades and pickups.
 */
@Composable
fun LoungeScreen(d: HomeData?, token: String?, onRead: (String, String) -> Unit) {
    val season = d?.week?.season
    var lounge by remember { mutableStateOf<LoungeData?>(null) }
    LaunchedEffect(season, token) {
        if (season == null || token == null) return@LaunchedEffect
        runCatching { LoungeApi.load(token, season, fromCache = true) }.onSuccess { if (lounge == null) lounge = it }
        while (true) {
            runCatching { LoungeApi.load(token, season) }.onSuccess { if (it != lounge) lounge = it }
            delay(5 * 60_000L)
        }
    }
    if (d == null) return Empty("The Lounge opens once your league loads.")
    val l = lounge

    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.weight(1.25f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Recap(d, onRead)
            Power(l, Modifier.fillMaxWidth().weight(1f))
        }
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Commish(l?.post, onRead)
            Bets(l?.bets, Modifier.fillMaxWidth().weight(1f))
            Activity(l?.activity.orEmpty())
        }
    }
}

@Composable
private fun Recap(d: HomeData, onRead: (String, String) -> Unit) {
    val w = d.week
    val title = if (w != null && w.week > 1) "Week ${w.week - 1} recap" else "Recap"
    val text = d.lastRecap
    Panel(Modifier.fillMaxWidth().height(150.dp), lit = true, padding = 16.dp, onClick = { if (text != null) onRead(title, text) }) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel(title, W.Neon)
                Spacer(Modifier.weight(1f))
                Chip("WRITTEN BY AI", W.Muted, W.Raised)
            }
            if (text == null) {
                BasicText("Last week's recap comes out at the Tuesday flip.", style = W.body(15, W.Muted))
            } else {
                val head = firstSentence(text)
                BasicText(head, style = W.body(17, bold = true), maxLines = 2, overflow = TextOverflow.Ellipsis)
                BasicText(text.removePrefix(head).trim(), style = W.body(13, Color(0xFFC7CCD6)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.weight(1f))
                val minutes = (text.split(Regex("\\s+")).size / 200).coerceAtLeast(1)
                BasicText("OK · Read the full recap · $minutes min", style = W.body(11, W.Dim, bold = true))
            }
        }
    }
}

@Composable
private fun Power(l: LoungeData?, modifier: Modifier) {
    Panel(modifier, padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            SectionLabel(l?.powerWeek?.let { "Power rankings · week $it" } ?: "Power rankings")
            if (l == null) BasicText("Loading…", style = W.body(13, W.Muted))
            else if (l.power.isEmpty()) BasicText("Power rankings start after week 1.", style = W.body(13, W.Muted))
            l?.power?.take(8)?.forEach { p ->
                Row(Modifier.fillMaxWidth().height(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicText("${p.rank}", style = W.big(16, if (p.rank <= 3) W.Neon else W.Muted), modifier = Modifier.width(28.dp))
                    BasicText(p.teamName, style = W.body(14, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    p.ownerName?.let { BasicText(it.substringBefore(' '), style = W.body(12, W.Muted), maxLines = 1) }
                    Spacer(Modifier.width(12.dp))
                    val mv = p.movement
                    BasicText(
                        when { mv == null || mv == 0 -> "—"; mv > 0 -> "▲$mv"; else -> "▼${-mv}" },
                        style = W.body(12, when { mv == null || mv == 0 -> W.Dim; mv > 0 -> UP; else -> DOWN }, bold = true),
                        modifier = Modifier.width(30.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun Commish(post: CommishPost?, onRead: (String, String) -> Unit) {
    val ago = post?.at?.let { Duration.between(it, Instant.now()) }?.let {
        when {
            it.toMinutes() < 60 -> "${it.toMinutes().coerceAtLeast(1)}m ago"
            it.toHours() < 48 -> "${it.toHours()}h ago"
            else -> "${it.toDays()}d ago"
        }
    }
    Panel(Modifier.fillMaxWidth().height(112.dp), padding = 14.dp, onClick = { post?.let { onRead(it.title, it.body) } }) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel("From the commish", W.Orange)
                Spacer(Modifier.weight(1f))
                ago?.let { BasicText(it, style = W.body(11, W.Dim)) }
            }
            if (post == null) {
                BasicText("Nothing posted in Commish Corner yet.", style = W.body(14, W.Muted))
            } else {
                BasicText(post.title, style = W.body(16, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                BasicText(post.body.replace(Regex("\\s+"), " "), style = W.body(13, Color(0xFFC7CCD6)), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun Bets(rows: List<BetRow>?, modifier: Modifier) {
    Panel(modifier, padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            SectionLabel("Bets board · season")
            when {
                rows == null -> BasicText("Bets aren't on for this league.", style = W.body(13, W.Muted))
                rows.isEmpty() -> BasicText("No bets tracked yet this season.", style = W.body(13, W.Muted))
            }
            rows?.take(4)?.forEach { b ->
                Row(Modifier.fillMaxWidth().height(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicText(b.name.substringBefore(' '), style = W.body(14, if (b.me) W.Orange else W.Text, bold = true), modifier = Modifier.weight(1f), maxLines = 1)
                    BasicText(listOfNotNull("${b.wins}–${b.losses}", b.streak).joinToString(" · "), style = W.body(12, W.Muted))
                    Spacer(Modifier.width(12.dp))
                    BasicText(
                        (if (b.units > 0) "+" else if (b.units < 0) "−" else "") + fmt(kotlin.math.abs(b.units)) + "u",
                        style = W.big(16, if (b.units > 0) UP else Color(0xFFC7CCD6)),
                        modifier = Modifier.width(56.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            BasicText("Tracking only. 1 unit a bet; stakes never shown.", style = W.body(10, W.Dim))
        }
    }
}

@Composable
private fun Activity(items: List<Pair<String, String>>) {
    Panel(Modifier.fillMaxWidth().height(104.dp), padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SectionLabel("Activity")
            if (items.isEmpty()) BasicText("No trades or pickups lately.", style = W.body(13, W.Muted))
            items.take(3).forEach { (kind, text) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicText(kind, style = W.label(if (kind == "TRADE") W.Orange else W.Neon), modifier = Modifier.width(64.dp))
                    BasicText(text, style = W.body(12, Color(0xFFE6E9EF)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
