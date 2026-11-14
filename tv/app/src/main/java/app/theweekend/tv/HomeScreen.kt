@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package app.theweekend.tv

import android.content.Intent
import android.view.KeyEvent
import android.provider.Settings
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.border
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val CLOCK = DateTimeFormatter.ofPattern("h:mm", Locale.US)
private val AMPM = DateTimeFormatter.ofPattern("a", Locale.US)
private val DAY = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)
val KICK: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE h:mm a", Locale.US)

/**
 * The TV's home screen. Switches between the game-day look and the calm
 * weekday look on its own, off the real NFL schedule (HomeData.isGameDay).
 */
@Composable
fun HomeScreen(
    d: HomeData?,
    error: String?,
    apps: SnapshotStateList<TvApp>,
    store: Store,
    now: Instant,
    gameDay: Boolean,
    firstFocus: FocusRequester,
    onOpenTab: (String) -> Unit,
    onRead: (String, String) -> Unit,
) {
    val zone = ZoneId.systemDefault()
    Column(Modifier.fillMaxSize()) {
        when {
            d == null -> BasicText(error ?: "Loading your league…", style = W.body(18, W.Muted), modifier = Modifier.padding(top = 40.dp))
            gameDay -> GameDay(d, apps, firstFocus, onOpenTab)
            else -> Weekday(d, apps, now, zone, firstFocus, onOpenTab, onRead)
        }
        Spacer(Modifier.weight(1f))
        AppRow(apps, store, if (d == null) firstFocus else null)
    }
}

// ---------- game day ----------

@Composable
private fun GameDay(d: HomeData, apps: List<TvApp>, firstFocus: FocusRequester, onOpenTab: (String) -> Unit) {
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth().height(232.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        LiveHero(d, Modifier.weight(1.55f).fillMaxHeight(), onClick = { onOpenTab("matchup") })
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            SectionLabel("Your players' games · where to watch")
            val starters = d.roster.filter { it.starting }
            val games = d.games
                .filter { g -> starters.any { g.has(it.proTeam) } && g.state != "post" }
                .sortedWith(compareBy({ if (it.live) 0 else 1 }, { it.kickoff }))
                .take(4)
            if (games.isEmpty()) BasicText("None of your starters play again today.", style = W.body(14, W.Muted))
            games.forEachIndexed { i, g ->
                val app = Apps.forBroadcast(apps, g.broadcast)
                val mine = starters.filter { g.has(it.proTeam) }.joinToString(" · ") { it.name.substringAfterLast(' ') }
                Focusable(
                    modifier = Modifier.fillMaxWidth().height(48.dp).then(if (i == 0) Modifier.focusRequester(firstFocus) else Modifier),
                    onClick = { app?.let { Apps.launch(context, it.packageName) } },
                ) { focused ->
                    Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            val score = if (g.state == "pre") "${g.away} @ ${g.home}" else "${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}"
                            BasicText("$score  ${g.statusDetail.orEmpty()}", style = W.body(14, if (focused) W.Night else W.Text, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            BasicText(mine, style = W.body(11, if (focused) W.Dim else W.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        WatchLabel(app, g, focused)
                    }
                }
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    LeagueStrip(d)
}

@Composable
private fun LiveHero(d: HomeData, modifier: Modifier, onClick: () -> Unit) {
    val w = d.week ?: return Panel(modifier) { BasicText("No matchup this week.", style = W.body(18, W.Muted)) }
    val m = d.myMatchup
    Panel(modifier, lit = true, onClick = onClick) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(W.Neon))
                Spacer(Modifier.width(8.dp))
                SectionLabel("Week ${w.week} · your matchup · live", W.Neon)
            }
            ScoreRow(d, w, big = true)
            Row {
                BasicText(w.winProbability?.let { "${it.toInt()}% win chance (estimate)" } ?: "", style = W.body(12, W.Muted))
                Spacer(Modifier.weight(1f))
                BasicText("Proj ${fmt(w.myProjected)} – ${fmt(w.oppProjected)}", style = W.body(12, W.Muted))
            }
            WinBar(w.winProbability, Modifier.fillMaxWidth())
            Spacer(Modifier.weight(1f))
            // Your starters still playing or done today, best first.
            val mine = m?.let { d.mine(it).roster.filter { r -> r.starting } } ?: emptyList()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                mine.sortedByDescending { it.points ?: -1.0 }.take(4).forEach { p ->
                    Column(
                        Modifier.weight(1f).background(W.Night.copy(alpha = 0.7f), RoundedCornerShape(10.dp)).padding(horizontal = 9.dp, vertical = 6.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            BasicText(p.name.substringAfterLast(' '), style = W.body(13, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            BasicText(fmt(p.points), style = W.big(17, if ((p.points ?: 0.0) >= 15) W.Neon else W.Text))
                        }
                        BasicText(listOfNotNull(p.position, p.proTeam).joinToString(" · "), style = W.body(10, W.Muted))
                    }
                }
            }
        }
    }
}

// ---------- weekday ----------

@Composable
private fun Weekday(
    d: HomeData,
    apps: List<TvApp>,
    now: Instant,
    zone: ZoneId,
    firstFocus: FocusRequester,
    onOpenTab: (String) -> Unit,
    onRead: (String, String) -> Unit,
) {
    val t = now.atZone(zone)
    Row(verticalAlignment = Alignment.Bottom) {
        BasicText(t.format(CLOCK), style = W.big(42))
        Spacer(Modifier.width(6.dp))
        BasicText(t.format(AMPM), style = W.big(15, W.Muted), modifier = Modifier.padding(bottom = 7.dp))
        Spacer(Modifier.width(16.dp))
        BasicText(t.format(DAY), style = W.body(16, W.Muted), modifier = Modifier.padding(bottom = 8.dp))
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.fillMaxWidth().height(222.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        NextMatchup(d, Modifier.weight(1.5f).fillMaxHeight(), firstFocus, onClick = { onOpenTab("matchup") })
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            RecapCard(d, Modifier.fillMaxWidth().weight(1.15f), onRead)
            StandingCard(d, Modifier.fillMaxWidth().weight(1f), onClick = { onOpenTab("league") })
        }
    }
    Spacer(Modifier.height(10.dp))
    NextKickoff(d, apps, now, zone, onOpenTab)
}

@Composable
private fun NextMatchup(d: HomeData, modifier: Modifier, focus: FocusRequester, onClick: () -> Unit) {
    val w = d.week ?: return Panel(modifier, focusRequester = focus, onClick = onClick) { BasicText("No matchup this week.", style = W.body(18, W.Muted)) }
    val m = d.myMatchup
    Panel(modifier, lit = true, focusRequester = focus, onClick = onClick) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel(if (w.started) "Week ${w.week} · your matchup" else "Week ${w.week} · your next matchup")
                Spacer(Modifier.weight(1f))
                m?.headline?.let { Chip(it.uppercase(), W.Night, W.Orange) }
                if (m?.isGameOfTheWeek == true) Chip("GAME OF THE WEEK", W.Night, W.Neon)
            }
            ScoreRow(d, w, big = w.started)
            Row {
                BasicText(w.winProbability?.let { "${it.toInt()}% win chance (estimate)" } ?: "", style = W.body(12, W.Muted))
                Spacer(Modifier.weight(1f))
                BasicText("Proj ${fmt(w.myProjected)} – ${fmt(w.oppProjected)}", style = W.body(12, W.Muted))
            }
            WinBar(w.winProbability, Modifier.fillMaxWidth())
            m?.narrative?.let { text ->
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.Top) {
                    Chip("PREVIEW", W.Muted, W.Raised)
                    Spacer(Modifier.width(8.dp))
                    BasicText(text, style = W.body(13, Color(0xFFC7CCD6)), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** Both teams, logos, names that wrap instead of cutting off, and the score or a VS between them. */
@Composable
private fun ScoreRow(d: HomeData, w: MyWeek, big: Boolean) {
    val m = d.myMatchup
    val mine = m?.let { d.mine(it) }
    val theirs = m?.let { d.theirs(it) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        TeamLogo(mine?.logoUrl ?: w.myLogoUrl, w.teamName, 52.dp, mine = true)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            BasicText(w.teamName, style = W.body(17, bold = true), maxLines = 2, overflow = TextOverflow.Ellipsis)
            BasicText(listOfNotNull("You", w.record, if (w.started) "${w.myYetToPlay + w.myInPlay} left" else null).joinToString(" · "), style = W.body(12, W.Muted))
        }
        Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
            if (big) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AnimatedScore(w.myScore, W.big(46))
                    BasicText("–", style = W.big(22, W.Dim), modifier = Modifier.padding(horizontal = 8.dp))
                    AnimatedScore(w.oppScore, W.big(46, Color(0xFFC7CCD6)))
                }
            } else {
                HexBadge("VS", 40.dp)
            }
        }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
            BasicText(w.oppTeamName, style = W.body(17, bold = true).end(), maxLines = 2, overflow = TextOverflow.Ellipsis)
            BasicText(listOfNotNull(w.oppOwnerName, w.oppRecord, if (w.started) "${w.oppYetToPlay + w.oppInPlay} left" else null).joinToString(" · "), style = W.body(12, W.Muted).end())
        }
        Spacer(Modifier.width(10.dp))
        TeamLogo(theirs?.logoUrl ?: w.oppLogoUrl, w.oppTeamName, 52.dp)
    }
}

@Composable
private fun RecapCard(d: HomeData, modifier: Modifier, onRead: (String, String) -> Unit) {
    val w = d.week
    val title = if (w != null && w.week > 1) "Week ${w.week - 1} recap" else "Recap"
    val text = d.lastRecap
    Panel(modifier, padding = 14.dp, onClick = { if (text != null) onRead(title, text) }) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel(title)
                Spacer(Modifier.weight(1f))
                Chip("WRITTEN BY AI", W.Muted, W.Raised)
            }
            if (text == null) {
                BasicText("Last week's recap comes out at the Tuesday flip.", style = W.body(14, W.Muted))
            } else {
                BasicText(firstSentence(text), style = W.body(16, bold = true), maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun StandingCard(d: HomeData, modifier: Modifier, onClick: () -> Unit) {
    val rank = d.myRank
    val me = d.week?.let { w -> d.standings.firstOrNull { it.teamName == w.teamName } }
    Panel(modifier, padding = 14.dp, onClick = onClick) {
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            HexBadge(rank?.toString() ?: "–", 58.dp, mine = true)
            Spacer(Modifier.width(14.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                SectionLabel("Your standing")
                BasicText(me?.let { "${it.record} · ${fmt(it.pointsFor)} PF" } ?: "No games yet", style = W.body(16, bold = true))
                val cut = d.playoffTeams
                if (rank != null && cut != null) {
                    BasicText(
                        if (rank <= cut) "In playoff position (top $cut)" else "${rank - cut} spot${if (rank - cut == 1) "" else "s"} out of the playoffs",
                        style = W.body(12, if (rank <= cut) W.Neon else W.Stale),
                    )
                }
            }
        }
    }
}

@Composable
private fun NextKickoff(d: HomeData, apps: List<TvApp>, now: Instant, zone: ZoneId, onOpenTab: (String) -> Unit) {
    val context = LocalContext.current
    val next = d.games.filter { it.state == "pre" && it.kickoff?.isAfter(now) == true }.sortedBy { it.kickoff }.take(3)
    if (next.isEmpty()) return
    Row(Modifier.focusRestorer(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel("Next up", W.Neon)
        next.forEach { g ->
            val app = Apps.forBroadcast(apps, g.broadcast)
            // OK opens the app that has the game; if none of yours do, the Scores page.
            Focusable(
                modifier = Modifier.height(32.dp),
                corner = 10.dp,
                onClick = { if (app != null) Apps.launch(context, app.packageName) else onOpenTab("scores") },
            ) { focused ->
                Row(Modifier.align(Alignment.Center).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicText("${g.away} @ ${g.home}", style = W.body(13, if (focused) W.Night else W.Text, bold = true))
                    Spacer(Modifier.width(8.dp))
                    BasicText(g.kickoff!!.atZone(zone).format(KICK), style = W.body(12, if (focused) W.Dim else W.Muted))
                    Spacer(Modifier.width(8.dp))
                    BasicText(
                        app?.label ?: (g.broadcast ?: ""),
                        style = W.body(12, if (focused) W.Night else if (app != null) W.Neon else W.Stale, bold = true),
                    )
                }
            }
        }
    }
}

@Composable
fun WatchLabel(app: TvApp?, g: NflGame, focused: Boolean) {
    BasicText(
        when {
            app != null -> if (g.live) "WATCH · ${app.label}" else app.label
            g.broadcast != null -> "${g.broadcast} · not in your apps"
            else -> ""
        },
        style = W.body(11, if (app != null) (if (focused) W.Night else W.Neon) else W.Stale, bold = true),
    )
}

@Composable
private fun LeagueStrip(d: HomeData) {
    val items = d.matchups.filter { it.id != d.myMatchupId }
    if (items.isEmpty()) return
    Row(
        Modifier.fillMaxWidth().height(34.dp).background(W.Surface, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionLabel("League", W.Neon)
        items.take(6).forEach { m ->
            val homeAhead = (m.home.score ?: 0.0) >= (m.away.score ?: 0.0)
            BasicText(
                "${short(m.home)} ${fmt(m.home.score)} · ${short(m.away)} ${fmt(m.away.score)}",
                style = W.body(12, if (homeAhead) W.Text else W.Muted),
                maxLines = 1,
            )
        }
    }
}

fun short(s: Side): String = (s.ownerName?.substringBefore(' ') ?: s.teamName).take(12)

/** Up to the first full stop that ends a sentence — not the dot in "36.2". */
fun firstSentence(text: String): String {
    val end = Regex("""[.!?](\s|$)""").find(text)?.range?.first ?: -1
    return if (end in 20..220) text.substring(0, end + 1) else text.take(200).trimEnd() + "…"
}

// ---------- apps ----------

/**
 * Your apps. Hold OK on one to pick it up, left / right to move it, OK (or
 * Back) to put it down. The order is saved for next time.
 */
@Composable
private fun AppRow(apps: SnapshotStateList<TvApp>, store: Store, firstFocus: FocusRequester?) {
    val context = LocalContext.current
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var moving by remember { mutableStateOf<String?>(null) }
    var swallowUp by remember { mutableStateOf(false) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        SectionLabel("Apps")
        Spacer(Modifier.width(12.dp))
        BasicText(
            if (moving != null) "◀ ▶ to move · OK to put it down" else "Hold OK on an app to move it",
            style = W.body(11, if (moving != null) W.Orange else W.Dim),
        )
    }
    Spacer(Modifier.height(4.dp))
    LazyRow(
        modifier = Modifier.focusRestorer(),
        state = listState,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp),
    ) {
        items(apps, key = { it.packageName }) { app ->
            val isFirst = firstFocus != null && app == apps.firstOrNull()
            val isMoving = moving == app.packageName
            Focusable(
                modifier = Modifier
                    .size(128.dp, 72.dp)
                    .then(if (isFirst) Modifier.focusRequester(firstFocus!!) else Modifier)
                    .onPreviewKeyEvent { e ->
                        val k = e.nativeKeyEvent
                        val ok = k.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || k.keyCode == KeyEvent.KEYCODE_ENTER
                        when {
                            isMoving -> {
                                if (e.type == KeyEventType.KeyDown && (k.keyCode == KeyEvent.KEYCODE_DPAD_LEFT || k.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
                                    val from = apps.indexOf(app)
                                    val to = (from + if (k.keyCode == KeyEvent.KEYCODE_DPAD_LEFT) -1 else 1).coerceIn(0, apps.lastIndex)
                                    if (to != from) {
                                        apps.add(to, apps.removeAt(from))
                                        scope.launch { listState.animateScrollToItem((to - 2).coerceAtLeast(0)) }
                                    }
                                } else if (e.type == KeyEventType.KeyUp && (ok || k.keyCode == KeyEvent.KEYCODE_BACK)) {
                                    moving = null
                                    store.appOrder = apps.map { it.packageName }
                                }
                                true  // while moving, the row keeps every key
                            }
                            ok && e.type == KeyEventType.KeyDown && k.repeatCount > 0 -> {
                                if (moving == null) {
                                    moving = app.packageName
                                    swallowUp = true
                                }
                                true
                            }
                            ok && e.type == KeyEventType.KeyUp && swallowUp -> {
                                swallowUp = false  // the release that ended the hold doesn't open the app
                                true
                            }
                            else -> false
                        }
                    },
                corner = 10.dp,
                onClick = { Apps.launch(context, app.packageName) },
            ) { focused ->
                if (app.banner != null) {
                    Image(app.banner, app.label, Modifier.fillMaxSize().padding(if (focused) 2.dp else 0.dp).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                } else {
                    BasicText(app.label, style = W.body(14, if (focused) W.Night else W.Text, bold = true), modifier = Modifier.align(Alignment.Center))
                }
                if (isMoving) {
                    Box(Modifier.fillMaxSize().border(3.dp, W.Orange, RoundedCornerShape(10.dp)))
                    BasicText(
                        "◀  ▶",
                        style = W.big(18, W.Orange),
                        modifier = Modifier.align(Alignment.BottomCenter).background(W.Night.copy(alpha = 0.8f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp),
                    )
                }
            }
        }
        item(key = "google-home") {
            SystemTile("Google TV home", "Search, inputs") {
                Store(context).allowGoogleHome = true
                context.startActivity(
                    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .setPackage(RemoteService.GOOGLE_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
        item(key = "tv-settings") {
            SystemTile("TV settings", "Wi-Fi, display") {
                context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }
}

@Composable
private fun SystemTile(title: String, sub: String, onClick: () -> Unit) {
    Focusable(modifier = Modifier.size(128.dp, 72.dp), corner = 10.dp, background = W.Raised, onClick = onClick) { focused ->
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            BasicText(title, style = W.body(14, if (focused) W.Night else W.Text, bold = true))
            BasicText(sub, style = W.body(11, if (focused) W.Dim else W.Muted))
        }
    }
}
