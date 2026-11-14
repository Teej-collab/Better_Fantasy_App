package app.theweekend.tv

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.ZoneId

// ---------- Matchup: both lineups, side by side ----------

@Composable
fun MatchupScreen(d: HomeData?, onRead: (String, String) -> Unit) {
    val m = d?.myMatchup
    if (d == null || m == null) return Empty("Your matchup shows up here once the week's set.")
    val mine = d.mine(m)
    val theirs = d.theirs(m)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionLabel("Week ${d.week?.week} · your matchup")
            Spacer(Modifier.weight(1f))
            m.narrative?.let { text ->
                Focusable(Modifier.height(30.dp), corner = 15.dp, background = W.Raised, onClick = { onRead("Week ${d.week?.week} preview", text) }) { focused ->
                    BasicText(
                        "READ THE PREVIEW",
                        style = W.label(if (focused) W.Night else W.Neon),
                        modifier = Modifier.align(Alignment.Center).padding(horizontal = 14.dp),
                    )
                }
                Spacer(Modifier.width(14.dp))
            }
            BasicText(d.week?.winProbability?.let { "${it.toInt()}% win chance (estimate)" } ?: "", style = W.body(12, W.Muted))
        }
        WinBar(d.week?.winProbability, Modifier.fillMaxWidth())
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            val started = d.week?.started == true
            Lineup(mine, true, started, Modifier.weight(1f).fillMaxHeight())
            Lineup(theirs, false, started, Modifier.weight(1f).fillMaxHeight())
        }
    }
}

@Composable
private fun Lineup(s: Side, mine: Boolean, started: Boolean, modifier: Modifier) {
    Panel(modifier, lit = mine, padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TeamLogo(s.logoUrl, s.teamName, 44.dp, mine = mine)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    BasicText(s.teamName, style = W.body(16, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    BasicText(listOfNotNull(s.ownerName, s.record).joinToString(" · "), style = W.body(11, W.Muted))
                }
                Column(horizontalAlignment = Alignment.End) {
                    // Before kickoff there's no score yet, just the projection.
                    if (started) {
                        BasicText(fmt(s.score), style = W.big(34, if (mine) W.Text else Color(0xFFC7CCD6)))
                        BasicText("proj ${fmt(s.projected)}", style = W.body(10, W.Muted))
                    } else {
                        BasicText(fmt(s.projected), style = W.big(30, W.Muted))
                        BasicText("projected", style = W.body(10, W.Muted))
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
            s.roster.filter { it.starting }.forEach { p ->
                Row(
                    Modifier.fillMaxWidth().height(29.dp).background(W.Night.copy(alpha = 0.55f), RoundedCornerShape(7.dp)).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BasicText(slotLabel(p.slot), style = W.label(W.Dim), maxLines = 1, modifier = Modifier.width(44.dp))
                    Column(Modifier.weight(1f)) {
                        BasicText(p.name, style = W.body(13, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    BasicText(
                        listOfNotNull(p.proTeam, p.opponent).joinToString(" "),
                        style = W.body(10, W.Muted), maxLines = 1,
                    )
                    Spacer(Modifier.width(8.dp))
                    // Points once they've played; until then the projection, dimmed.
                    val played = p.points != null && (started || (p.points ?: 0.0) != 0.0)
                    BasicText(
                        if (played) fmt(p.points) else fmt(p.projected),
                        style = W.big(16, if (!played) W.Dim else if ((p.points ?: 0.0) >= 15) W.Neon else W.Text).end(),
                        modifier = Modifier.width(40.dp),
                    )
                }
            }
        }
    }
}

// ---------- League: standings and this week's matchups ----------

@Composable
fun LeagueScreen(d: HomeData?) {
    if (d == null || d.standings.isEmpty()) return Empty("Standings show up after the first week's games.")
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Panel(Modifier.weight(1.25f).fillMaxHeight(), padding = 14.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row {
                    SectionLabel("Standings", W.Neon)
                    Spacer(Modifier.weight(1f))
                    SectionLabel("W–L        PF        PA")
                }
                Spacer(Modifier.height(2.dp))
                val cut = d.playoffTeams
                d.standings.forEachIndexed { i, s ->
                    val mine = s.teamName == d.week?.teamName
                    if (cut != null && i == cut) {
                        Box(Modifier.fillMaxWidth().height(1.dp).background(W.Neon.copy(alpha = 0.6f)))
                    }
                    Row(
                        Modifier.fillMaxWidth().height(25.dp)
                            .background(if (mine) W.Orange.copy(alpha = 0.12f) else Color.Transparent, RoundedCornerShape(6.dp))
                            .padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        HexBadge("${i + 1}", 22.dp, mine = mine)
                        Spacer(Modifier.width(8.dp))
                        BasicText(s.teamName, style = W.body(13, bold = mine), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        BasicText(s.record, style = W.big(14).end(), modifier = Modifier.width(44.dp))
                        BasicText(fmt(s.pointsFor), style = W.big(14, W.Muted).end(), modifier = Modifier.width(62.dp))
                        BasicText(fmt(s.pointsAgainst), style = W.big(14, W.Dim).end(), modifier = Modifier.width(62.dp))
                    }
                }
                if (d.playoffTeams != null) BasicText("Green line: playoff cut (top ${d.playoffTeams})", style = W.body(10, W.Dim))
            }
        }
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SectionLabel("Week ${d.week?.week} matchups")
            d.matchups.forEach { m ->
                val mine = m.id == d.myMatchupId
                Panel(Modifier.fillMaxWidth(), lit = mine, padding = 8.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        for (s in listOf(m.home, m.away)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TeamLogo(s.logoUrl, s.teamName, 20.dp, mine = s.teamName == d.week?.teamName)
                                Spacer(Modifier.width(8.dp))
                                BasicText(s.teamName, style = W.body(12, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                BasicText(fmt(s.score), style = W.big(15))
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------- Scores: every NFL game, and where you can watch it ----------

@Composable
fun ScoresScreen(d: HomeData?, apps: List<TvApp>) {
    val context = LocalContext.current
    val zone = ZoneId.systemDefault()
    if (d == null || d.games.isEmpty()) return Empty("No NFL games on the board right now.")
    val starters = d.roster.filter { it.starting }
    val games = d.games.sortedWith(compareBy({ if (it.live) 0 else if (it.state == "pre") 1 else 2 }, { it.kickoff }))
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionLabel("NFL this week")
            Spacer(Modifier.width(10.dp))
            Box(Modifier.size(8.dp).clip(CircleShape).background(W.Orange))
            Spacer(Modifier.width(6.dp))
            SectionLabel("your starters")
        }
        LazyVerticalGrid(GridCells.Fixed(3), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(games, key = { it.id }) { g ->
                val app = Apps.forBroadcast(apps, g.broadcast)
                val mine = starters.filter { g.has(it.proTeam) }
                Focusable(Modifier.fillMaxWidth().height(70.dp), onClick = { app?.let { Apps.launch(context, it.packageName) } }) { focused ->
                    val fg = if (focused) W.Night else W.Text
                    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val line = if (g.state == "pre") "${g.away} @ ${g.home}" else "${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}"
                            BasicText(line, style = W.big(17, fg))
                            if (mine.isNotEmpty()) {
                                Spacer(Modifier.width(6.dp))
                                Box(Modifier.size(7.dp).clip(CircleShape).background(W.Orange))
                            }
                            Spacer(Modifier.weight(1f))
                            BasicText(
                                if (g.state == "pre") g.kickoff?.atZone(zone)?.format(KICK) ?: "" else g.statusDetail ?: "",
                                style = W.body(11, if (g.live) (if (focused) W.Night else W.Neon) else (if (focused) W.Dim else W.Muted), bold = g.live),
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            BasicText(
                                mine.joinToString(" · ") { it.name.substringAfterLast(' ') },
                                style = W.body(11, if (focused) W.Dim else W.Orange), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            WatchLabel(app, g, focused)
                        }
                    }
                }
            }
        }
    }
}

/** ESPN's flex slot names ("RB/WR/TE", "RB/W") read as FLEX; the rest as they are. */
fun slotLabel(slot: String?): String = when {
    slot == null -> ""
    slot == "D/ST" || slot == "DST" -> "D/ST"
    "/" in slot || slot.uppercase().contains("FLEX") -> "FLEX"
    else -> slot
}

@Composable
private fun Empty(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { BasicText(text, style = W.body(18, W.Muted)) }
}

// ---------- Reader: a recap or preview, full length ----------

/** Up / down scrolls; Back closes. */
@Composable
fun ReaderScreen(title: String, body: String) {
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .width(720.dp)
                .fillMaxHeight()
                .focusRequester(focus)
                .focusable()
                .onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (e.key) {
                        Key.DirectionDown -> { scope.launch { scroll.animateScrollBy(260f) }; true }
                        Key.DirectionUp -> { scope.launch { scroll.animateScrollBy(-260f) }; true }
                        else -> false
                    }
                }
                .verticalScroll(scroll),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel(title, W.Neon)
                Spacer(Modifier.width(10.dp))
                Chip("WRITTEN BY AI FROM LEAGUE STATS", W.Muted, W.Raised)
            }
            BasicText(firstSentence(body), style = W.big(30))
            body.split("\n").map { it.trim() }.filter { it.isNotEmpty() }.forEach { para ->
                BasicText(para, style = W.body(18, Color(0xFFDDE1E8)).copy(lineHeight = 28.sp))
            }
            Spacer(Modifier.height(40.dp))
        }
        Spacer(Modifier.weight(1f))
        BasicText("▲ ▼ to scroll · Back to close", style = W.body(12, W.Dim), modifier = Modifier.align(Alignment.Bottom))
    }
}
