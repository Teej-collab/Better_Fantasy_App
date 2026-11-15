package app.theweekend.tv

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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val UPDATED = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
private const val FLASH_MS = 10_000L

/**
 * Red Zone: every matchup in the league at once, for game day. A tile lights
 * up neon for a few seconds when someone in it scores: with the player when
 * a touchdown comes over the live line, or just the points when a refresh
 * shows a score went up. Win chances are estimates.
 */
@Composable
fun RedZoneScreen(d: HomeData?, apps: List<TvApp>, touchdown: LiveEvent.Touchdown?) {
    if (d == null || d.matchups.isEmpty()) return Empty("Every matchup in the league shows up here once the week's set.")
    val started = d.week?.started == true

    // team name -> what to flash on its tile, and when that stops.
    val flashes = remember { mutableStateMapOf<String, Pair<String, Long>>() }
    var lastScores by remember { mutableStateOf<Pair<java.time.Instant, Map<String, Double>>?>(null) }
    LaunchedEffect(d) {
        val scores = d.matchups.flatMap { listOf(it.home, it.away) }.associate { it.teamName to (it.score ?: 0.0) }
        // Only between refreshes a few minutes apart: waking the TV mid-game
        // shouldn't light up every tile with the whole afternoon's points.
        val before = lastScores?.takeIf { java.time.Duration.between(it.first, d.fetchedAt).toMinutes() < 5 }?.second
        if (before != null) {
            for ((team, now) in scores) {
                val gain = now - (before[team] ?: now)
                // The touchdown line already said who it was; this catches field goals and the rest.
                if (gain >= 0.5 && flashes[team]?.second?.let { it > System.currentTimeMillis() } != true) {
                    flashes[team] = "+" + fmt(gain) to System.currentTimeMillis() + FLASH_MS
                }
            }
        }
        lastScores = d.fetchedAt to scores
    }
    LaunchedEffect(touchdown) {
        val td = touchdown ?: return@LaunchedEffect
        val who = td.playerName.substringAfterLast(' ')
        flashes[td.teamName] = (td.pointsDelta?.let { "+" + fmt(it) + " · " } ?: "") + "$who TD" to System.currentTimeMillis() + FLASH_MS
    }
    // Clears each flash when its time is up.
    LaunchedEffect(flashes.toMap()) {
        val next = flashes.values.minOfOrNull { it.second } ?: return@LaunchedEffect
        delay((next - System.currentTimeMillis()).coerceAtLeast(0))
        val now = System.currentTimeMillis()
        flashes.entries.removeAll { it.value.second <= now }
    }

    // Yours first, then the game of the week, then the rest as the league lists them.
    val tiles = d.matchups.sortedBy { m ->
        when {
            m.id == d.myMatchupId -> 0
            m.isGameOfTheWeek -> 1
            else -> 2
        }
    }
    val zone = ZoneId.systemDefault()
    val anyLive = d.games.any { it.live }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                SectionLabel("Week ${d.week?.week ?: ""} · every matchup${if (anyLive) " live" else ""}", if (anyLive) W.Neon else W.Muted)
                BasicText("A tile lights up when someone in it scores. Win chances are estimates.", style = W.body(12, W.Dim))
            }
            if (anyLive) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(W.Neon))
                Spacer(Modifier.width(6.dp))
                BasicText("LIVE", style = W.label(W.Neon))
                Spacer(Modifier.width(12.dp))
            }
            BasicText("Updated ${d.fetchedAt.atZone(zone).format(UPDATED)}", style = W.body(12, W.Muted))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            tiles.chunked(3).forEach { row ->
                Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { m ->
                        val flash = flashes[m.home.teamName]?.first ?: flashes[m.away.teamName]?.first
                        Tile(d, m, started, flash, Modifier.weight(1f).fillMaxHeight())
                    }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        NflStrip(d, apps, zone)
    }
}

@Composable
private fun Tile(d: HomeData, m: LeagueMatchup, started: Boolean, flash: String?, modifier: Modifier) {
    val mine = m.id == d.myMatchupId
    val shape = RoundedCornerShape(16.dp)
    val tag = when {
        mine -> "Your matchup"
        m.isGameOfTheWeek -> "Game of the week"
        else -> m.headline ?: "Matchup"
    }
    // Your side on top in yours; otherwise whoever's ahead.
    val (top, bottom) = when {
        mine -> d.mine(m) to d.theirs(m)
        (m.away.score ?: 0.0) > (m.home.score ?: 0.0) -> m.away to m.home
        else -> m.home to m.away
    }
    Column(
        modifier
            .background(
                if (mine) Brush.verticalGradient(listOf(Color(0xFF281A0E), W.Surface)) else Brush.verticalGradient(listOf(W.Surface, W.Surface)),
                shape,
            )
            .border(
                if (flash != null || mine) 2.dp else 1.dp,
                if (flash != null) W.Neon else if (mine) W.Orange else W.Line,
                shape,
            )
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicText(tag.uppercase(), style = W.label(if (mine) W.Orange else W.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (flash != null) Chip(flash, W.Night, W.Neon)
        }
        val lead = when {
            !started -> null
            (top.score ?: 0.0) > (bottom.score ?: 0.0) -> top
            (bottom.score ?: 0.0) > (top.score ?: 0.0) -> bottom
            else -> null
        }
        SideRow(d, top, mine && top == d.mine(m), lead == null || lead == top, started)
        SideRow(d, bottom, mine && bottom == d.mine(m), lead == null || lead == bottom, started)
        Spacer(Modifier.weight(1f))
        // The favorite's chance, as a bar and in words.
        val fav = listOf(top, bottom).filter { it.winProbability != null }.maxByOrNull { it.winProbability!! }
        if (fav != null) {
            val pct = fav.winProbability!!
            Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(W.Line)) {
                Box(Modifier.fillMaxHeight().fillMaxWidth((pct / 100).toFloat().coerceIn(0.02f, 1f)).background(if (mine) W.Orange else W.Neon, CircleShape))
            }
            BasicText("${fav.teamName} ${pct.toInt()}% to win · est.", style = W.body(11, W.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun SideRow(d: HomeData, s: Side, mine: Boolean, ahead: Boolean, started: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        TeamLogo(s.logoUrl, s.teamName, 34.dp, mine = mine)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            BasicText(s.teamName, style = W.body(15, if (ahead) W.Text else Color(0xFFC7CCD6), bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val left = playersLeft(d, s)
            BasicText(
                listOfNotNull(if (mine) "You" else s.ownerName?.substringBefore(' '), left?.let { "$it left" }).joinToString(" · "),
                style = W.body(11, W.Muted), maxLines = 1,
            )
        }
        Spacer(Modifier.width(8.dp))
        // Before kickoff, the projection (dimmed) instead of a row of zeros.
        if (started) {
            BasicText(fmt(s.score), style = W.big(28, if (ahead) W.Text else Color(0xFF8B93A1)))
        } else {
            BasicText(fmt(s.projected), style = W.big(24, W.Dim))
        }
    }
}

/** Starters whose NFL game hasn't finished, or null when the scoreboard doesn't cover them. */
private fun playersLeft(d: HomeData, s: Side): Int? {
    if (d.games.isEmpty()) return null
    return s.roster.filter { it.starting }.count { p ->
        val g = d.games.firstOrNull { it.has(p.proTeam) }
        g != null && g.state != "post"
    }
}

/** The NFL games on now (then the next ones), and which of your apps has each. */
@Composable
private fun NflStrip(d: HomeData, apps: List<TvApp>, zone: ZoneId) {
    val games = d.games.filter { it.state != "post" }
        .sortedWith(compareBy({ if (it.live) 0 else 1 }, { it.kickoff }))
        .take(5)
    if (games.isEmpty()) return
    Row(
        Modifier.fillMaxWidth().height(36.dp).background(W.Surface, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        SectionLabel("NFL", W.Neon)
        games.forEach { g ->
            val app = Apps.forBroadcast(apps, g.broadcast)
            Row(verticalAlignment = Alignment.CenterVertically) {
                BasicText(
                    if (g.state == "pre") "${g.away} @ ${g.home}" else "${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}",
                    style = W.body(12, bold = true), maxLines = 1,
                )
                Spacer(Modifier.width(6.dp))
                BasicText(
                    if (g.state == "pre") g.kickoff?.atZone(zone)?.format(KICK).orEmpty() else g.statusDetail.orEmpty(),
                    style = W.body(11, W.Muted), maxLines = 1,
                )
                Spacer(Modifier.width(6.dp))
                BasicText(app?.label ?: g.broadcast.orEmpty(), style = W.body(11, if (app != null) W.Neon else W.Stale, bold = true), maxLines = 1)
            }
        }
    }
}
