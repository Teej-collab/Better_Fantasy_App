package app.theweekend.tv

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val CLOCK = DateTimeFormatter.ofPattern("h:mm", Locale.US)
private val AMPM = DateTimeFormatter.ofPattern("a", Locale.US)
private val DAY = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)
private val KICK = DateTimeFormatter.ofPattern("EEE h:mm a", Locale.US)

/**
 * The TV's home screen. Switches between the game-day look and the calm
 * weekday look on its own, off the real NFL schedule (HomeData.isGameDay).
 */
@Composable
fun HomeScreen(store: Store, onSignedOut: () -> Unit, onOpenSettings: () -> Unit) {
    val context = LocalContext.current
    val zone = ZoneId.systemDefault()
    var data by remember { mutableStateOf<HomeData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableStateOf(Instant.now()) }
    val apps = remember { Apps.installed(context) }
    val firstFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        while (true) {
            val token = store.token ?: return@LaunchedEffect onSignedOut()
            try {
                data = League.home(token)
                error = null
            } catch (e: ApiError) {
                if (e.status == 401) {
                    store.token = null
                    return@LaunchedEffect onSignedOut()
                }
                error = e.message
            } catch (e: Exception) {
                error = "Can't reach The Weekend right now"
            }
            delay(if (data?.isGameDay() == true) 30_000L else 300_000L)
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(15_000)
        }
    }
    LaunchedEffect(Unit) { runCatching { firstFocus.requestFocus() } }

    val d = data
    val gameDay = d?.isGameDay(now, zone) == true

    Box(Modifier.fillMaxSize().background(W.Night)) {
        // The light behind the emblem: brighter on game day.
        Box(
            Modifier
                .size(760.dp, 460.dp)
                .background(
                    Brush.radialGradient(
                        listOf(W.Neon.copy(alpha = if (gameDay) 0.16f else 0.06f), Color.Transparent),
                    ),
                ),
        )
        Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 27.dp)) {
            if (gameDay && d != null) GameDayTop(d, apps, now, zone, store, firstFocus)
            else WeekdayTop(d, apps, now, zone, error)
            Spacer(Modifier.weight(1f))
            AppRow(apps, if (gameDay) null else firstFocus, onOpenSettings)
        }
        val stale = error != null && d != null
        if (stale) {
            BasicText(
                "Not updating · last good ${d!!.fetchedAt.atZone(zone).format(DateTimeFormatter.ofPattern("h:mm a"))}",
                style = W.body(13, W.Stale, bold = true),
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 48.dp),
            )
        }
    }
}

@Composable
private fun Header(gameDay: Boolean, now: Instant, zone: ZoneId) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.emblem), "The Weekend", Modifier.size(54.dp))
        Spacer(Modifier.width(10.dp))
        if (gameDay) {
            BasicText(
                "GAME DAY",
                style = W.label(W.Night),
                modifier = Modifier.background(W.Neon, RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
        Spacer(Modifier.weight(1f))
        val t = now.atZone(zone)
        BasicText("${t.format(DateTimeFormatter.ofPattern("EEEE", Locale.US))} · ${t.format(CLOCK)} ${t.format(AMPM)}", style = W.body(17, W.Muted))
    }
}

@Composable
private fun GameDayTop(d: HomeData, apps: List<TvApp>, now: Instant, zone: ZoneId, store: Store, firstFocus: FocusRequester) {
    val context = LocalContext.current
    Header(gameDay = true, now = now, zone = zone)
    Spacer(Modifier.height(14.dp))
    Row(Modifier.fillMaxWidth().height(250.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        MatchupCard(d, Modifier.weight(1.55f).fillMaxHeight(), live = true)
        // Where to watch: the games your starters are in, and which of your apps has each one.
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BasicText("YOUR PLAYERS' GAMES · WHERE TO WATCH", style = W.label())
            val starters = d.roster.filter { it.starting }
            val games = d.games
                .filter { g -> starters.any { g.has(it.proTeam) } && g.state != "post" }
                .sortedWith(compareBy({ if (it.live) 0 else 1 }, { it.kickoff }))
                .take(4)
            if (games.isEmpty()) BasicText("None of your starters play again today.", style = W.body(15, W.Muted))
            games.forEachIndexed { i, g ->
                val stream = StreamApp.forBroadcast(g.broadcast)
                val app = Apps.find(apps, stream)
                val mine = starters.filter { g.has(it.proTeam) }.joinToString(" · ") { it.name.substringAfterLast(' ') }
                Focusable(
                    modifier = Modifier.fillMaxWidth().height(52.dp).then(if (i == 0) Modifier.focusRequester(firstFocus) else Modifier),
                    onClick = { app?.let { Apps.launch(context, it.packageName) } },
                ) { focused ->
                    val fg = if (focused) W.Night else W.Text
                    Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            val score = if (g.state == "pre") "${g.away} @ ${g.home}" else "${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}"
                            BasicText("$score  ${g.statusDetail.orEmpty()}", style = W.body(15, fg, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            BasicText(mine, style = W.body(12, if (focused) W.Dim else W.Muted), maxLines = 1)
                        }
                        BasicText(
                            when {
                                app != null -> if (g.live) "WATCH · ${app.label}" else app.label
                                g.broadcast != null -> "${g.broadcast} · not in your apps"
                                else -> ""
                            },
                            style = W.body(12, if (app != null) (if (focused) W.Night else W.Neon) else W.Stale, bold = true),
                        )
                    }
                }
            }
        }
    }
    Spacer(Modifier.height(12.dp))
    LeagueStrip(d.ticker)
}

@Composable
private fun MatchupCard(d: HomeData, modifier: Modifier, live: Boolean) {
    val w = d.week
    Column(
        modifier
            .background(Brush.verticalGradient(listOf(Color(0xFF151A22), Color(0xFF0F1218))), RoundedCornerShape(20.dp))
            .border(1.dp, Color(0xFF2C3442), RoundedCornerShape(20.dp))
            .padding(horizontal = 22.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (w == null) {
            BasicText("YOUR MATCHUP", style = W.label())
            BasicText("No matchup this week.", style = W.body(18, W.Muted))
            return@Column
        }
        BasicText(
            if (live && w.started) "WEEK ${w.week} · YOUR MATCHUP · LIVE" else "WEEK ${w.week} · YOUR NEXT MATCHUP",
            style = W.label(if (live && w.started) W.Neon else W.Muted),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                BasicText(w.teamName, style = W.body(20, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                BasicText(listOfNotNull("You", w.record, if (w.started) "${w.myYetToPlay + w.myInPlay} left" else null).joinToString(" · "), style = W.body(13, W.Muted))
            }
            if (w.started) {
                BasicText(fmt(w.myScore), style = W.big(56))
                BasicText("  –  ", style = W.big(22, W.Dim))
                BasicText(fmt(w.oppScore), style = W.big(56, Color(0xFFC7CCD6)))
            } else {
                BasicText("vs", style = W.big(28, W.Dim))
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                BasicText(w.oppTeamName, style = W.body(20, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis)
                BasicText(listOfNotNull(w.oppOwnerName, w.oppRecord, if (w.started) "${w.oppYetToPlay + w.oppInPlay} left" else null).joinToString(" · "), style = W.body(13, W.Muted))
            }
        }
        Spacer(Modifier.weight(1f))
        val p = w.winProbability
        Row {
            BasicText(if (p != null) "${p.toInt()}% win chance (estimate)" else "", style = W.body(13, W.Muted))
            Spacer(Modifier.weight(1f))
            BasicText("Proj ${fmt(w.myProjected)} – ${fmt(w.oppProjected)}", style = W.body(13, W.Muted))
        }
        Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(W.Line)) {
            if (p != null) Box(Modifier.fillMaxWidth((p / 100).toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(W.Neon))
        }
    }
}

@Composable
private fun LeagueStrip(ticker: List<TickerMatchup>) {
    if (ticker.isEmpty()) return
    Row(
        Modifier.fillMaxWidth().height(40.dp).background(W.Surface, RoundedCornerShape(12.dp))
            .border(1.dp, W.Line, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        BasicText("LEAGUE", style = W.label(W.Neon))
        ticker.take(6).forEach { m ->
            val homeWins = (m.homeScore ?: 0.0) >= (m.awayScore ?: 0.0)
            BasicText(
                "${m.home.take(14)} ${fmt(m.homeScore)} · ${m.away.take(14)} ${fmt(m.awayScore)}",
                style = W.body(13, if (homeWins) W.Text else W.Muted),
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun WeekdayTop(d: HomeData?, apps: List<TvApp>, now: Instant, zone: ZoneId, error: String?) {
    val t = now.atZone(zone)
    Row(verticalAlignment = Alignment.Top) {
        Column {
            Row(verticalAlignment = Alignment.Bottom) {
                BasicText(t.format(CLOCK), style = W.big(76))
                Spacer(Modifier.width(8.dp))
                BasicText(t.format(AMPM), style = W.big(24, W.Muted), modifier = Modifier.padding(bottom = 12.dp))
            }
            BasicText(t.format(DAY), style = W.body(18, W.Muted))
        }
        Spacer(Modifier.weight(1f))
        Image(painterResource(R.drawable.emblem), "The Weekend", Modifier.size(96.dp))
    }
    Spacer(Modifier.height(20.dp))
    if (d == null) {
        BasicText(error ?: "Loading your league…", style = W.body(16, W.Muted))
        return
    }
    Row(Modifier.fillMaxWidth().height(190.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        MatchupCard(d, Modifier.weight(1.4f).fillMaxHeight(), live = false)
        // The next kickoff, and whether it's on one of your apps.
        val next = d.games.filter { it.state == "pre" && it.kickoff?.isAfter(now) == true }.minByOrNull { it.kickoff!! }
        Column(
            Modifier.weight(1f).fillMaxHeight().background(W.Surface, RoundedCornerShape(18.dp))
                .border(1.dp, W.Line, RoundedCornerShape(18.dp)).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            BasicText("NEXT KICKOFF", style = W.label())
            if (next == null) {
                BasicText("Schedule's not out yet.", style = W.body(16, W.Muted))
            } else {
                BasicText("${next.away} @ ${next.home}", style = W.big(34))
                BasicText(next.kickoff!!.atZone(zone).format(KICK), style = W.body(16))
                val app = Apps.find(apps, StreamApp.forBroadcast(next.broadcast))
                BasicText(
                    when {
                        app != null -> "On ${app.label}"
                        next.broadcast != null -> "${next.broadcast} · not in your apps"
                        else -> ""
                    },
                    style = W.body(14, if (app != null) W.Neon else W.Stale, bold = true),
                )
            }
        }
    }
}

@Composable
private fun AppRow(apps: List<TvApp>, firstFocus: FocusRequester?, onOpenSettings: () -> Unit) {
    val context = LocalContext.current
    BasicText("APPS", style = W.label())
    Spacer(Modifier.height(8.dp))
    LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
        items(apps, key = { it.packageName }) { app ->
            val isFirst = firstFocus != null && app == apps.firstOrNull()
            Focusable(
                modifier = Modifier.size(176.dp, 99.dp).then(if (isFirst) Modifier.focusRequester(firstFocus!!) else Modifier),
                corner = 10.dp,
                onClick = { Apps.launch(context, app.packageName) },
            ) { focused ->
                if (app.banner != null) {
                    Image(app.banner, app.label, Modifier.fillMaxSize().padding(if (focused) 2.dp else 0.dp).clip(RoundedCornerShape(9.dp)), contentScale = ContentScale.Crop)
                } else {
                    BasicText(app.label, style = W.body(15, if (focused) W.Night else W.Text, bold = true), modifier = Modifier.align(Alignment.Center))
                }
            }
        }
        item(key = "settings") {
            Focusable(modifier = Modifier.size(176.dp, 99.dp), corner = 10.dp, background = W.Raised, onClick = onOpenSettings) { focused ->
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    BasicText("The Weekend", style = W.body(15, if (focused) W.Night else W.Text, bold = true))
                    BasicText("Overlay & settings", style = W.body(12, if (focused) W.Dim else W.Muted))
                }
            }
        }
    }
}
