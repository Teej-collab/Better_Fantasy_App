package app.theweekend.tv

import android.service.dreams.DreamService
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.activity.compose.setContent
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.random.Random

/**
 * The Weekend as the TV's screensaver (pick it under TV settings → Screen
 * saver, or it's set from the Mac). Mostly dark: a big clock, your matchup
 * (live on game day), and one card that rotates between standings, last
 * week's recap and the next kickoff. Everything drifts to a new spot every
 * minute so nothing burns into the screen.
 */
class WeekendDream : DreamService(), LifecycleOwner, SavedStateRegistryOwner {
    private val registry = LifecycleRegistry(this)
    private val saved = SavedStateRegistryController.create(this)
    override val lifecycle: Lifecycle get() = registry
    override val savedStateRegistry: SavedStateRegistry get() = saved.savedStateRegistry

    override fun onCreate() {
        super.onCreate()
        saved.performRestore(null)
        registry.currentState = Lifecycle.State.CREATED
        Api.cacheDir = java.io.File(cacheDir, "api")
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false  // any button wakes the TV
        isFullscreen = true
        val store = Store(this)
        setContentView(
            ComposeView(this).apply {
                setViewTreeLifecycleOwner(this@WeekendDream)
                setViewTreeSavedStateRegistryOwner(this@WeekendDream)
                setContent { Screensaver(store) }
            },
        )
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        registry.currentState = Lifecycle.State.RESUMED
    }

    override fun onDreamingStopped() {
        registry.currentState = Lifecycle.State.CREATED
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        registry.currentState = Lifecycle.State.DESTROYED
        super.onDetachedFromWindow()
    }
}

private val DREAM_CLOCK = DateTimeFormatter.ofPattern("h:mm", Locale.US)
private val DREAM_DAY = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)

@Composable
fun Screensaver(store: Store) {
    var data by remember { mutableStateOf<HomeData?>(null) }
    var now by remember { mutableStateOf(Instant.now()) }
    var card by remember { mutableIntStateOf(0) }
    var spot by remember { mutableStateOf(0 to 0) }
    val zone = ZoneId.systemDefault()

    LaunchedEffect(Unit) {
        val token = store.token ?: return@LaunchedEffect
        runCatching { League.home(token, fromCache = true) }.onSuccess { data = it }
        while (true) {
            runCatching { League.home(token) }.onSuccess { data = it }
            delay(if (data?.isGameDay() == true) 60_000L else 600_000L)
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            now = Instant.now()
            delay(10_000)
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(20_000)
            card++
        }
    }
    // Burn-in: the whole block wanders to a new spot every minute.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            spot = Random.nextInt(-120, 121) to Random.nextInt(-60, 61)
        }
    }
    val dx by animateDpAsState(spot.first.dp, tween(8_000), label = "dx")
    val dy by animateDpAsState(spot.second.dp, tween(8_000), label = "dy")
    val d = data
    val gameDay = d?.isGameDay(now, zone) == true

    HiveBackground(gameDay = false) {
        Box(Modifier.align(Alignment.Center).offset(dx, dy)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    BasicText(now.atZone(zone).format(DREAM_CLOCK), style = W.big(96, Color(0xFFE6E9EF)))
                    Spacer(Modifier.width(14.dp))
                    BasicText(now.atZone(zone).format(DREAM_DAY), style = W.body(18, W.Muted), modifier = Modifier.padding(bottom = 18.dp))
                }
                if (d?.week != null) DreamMatchup(d, gameDay)
                if (d != null) {
                    AnimatedContent(card % 3, transitionSpec = { fadeIn(tween(1200)) togetherWith fadeOut(tween(1200)) }, label = "card") { which ->
                        when (which) {
                            0 -> DreamStandings(d)
                            1 -> DreamRecap(d)
                            else -> DreamKickoff(d, now, zone)
                        }
                    }
                }
                Image(painterResource(R.drawable.emblem), "The Weekend", Modifier.size(64.dp).alpha(0.55f))
            }
        }
    }
}

@Composable
private fun DreamMatchup(d: HomeData, live: Boolean) {
    val w = d.week ?: return
    Panel(Modifier.width(620.dp), lit = live, padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionLabel(if (live && w.started) "Week ${w.week} · live" else "Week ${w.week} · your matchup", if (live && w.started) W.Neon else W.Muted)
            Row(verticalAlignment = Alignment.CenterVertically) {
                BasicText(w.teamName, style = W.body(18, bold = true), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (w.started) {
                    AnimatedScore(w.myScore, W.big(40))
                    BasicText("  –  ", style = W.big(20, W.Dim))
                    AnimatedScore(w.oppScore, W.big(40, Color(0xFFC7CCD6)))
                } else {
                    BasicText("vs", style = W.big(24, W.Dim))
                }
                BasicText(w.oppTeamName, style = W.body(18, bold = true).end(), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            }
            Row {
                BasicText(w.winProbability?.let { "${it.toInt()}% win chance (estimate)" } ?: "", style = W.body(12, W.Muted))
                Spacer(Modifier.weight(1f))
                BasicText("Proj ${fmt(w.myProjected)} – ${fmt(w.oppProjected)}", style = W.body(12, W.Muted))
            }
            WinBar(w.winProbability, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun DreamStandings(d: HomeData) {
    Panel(Modifier.width(620.dp), padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SectionLabel("Standings")
            d.standings.take(4).forEachIndexed { i, s ->
                val mine = s.teamName == d.week?.teamName
                Row(verticalAlignment = Alignment.CenterVertically) {
                    HexBadge("${i + 1}", 26.dp, mine = mine)
                    Spacer(Modifier.width(10.dp))
                    BasicText(s.teamName, style = W.body(15, bold = mine), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    BasicText(s.record, style = W.big(16))
                }
            }
        }
    }
}

@Composable
private fun DreamRecap(d: HomeData) {
    val text = d.lastRecap ?: return DreamStandings(d)
    Panel(Modifier.width(620.dp), padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row {
                SectionLabel("Last week's recap")
                Spacer(Modifier.weight(1f))
                Chip("WRITTEN BY AI", W.Muted, W.Raised)
            }
            BasicText(firstSentence(text), style = W.body(17, bold = true), maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DreamKickoff(d: HomeData, now: Instant, zone: ZoneId) {
    val next = d.games.filter { it.state == "pre" && it.kickoff?.isAfter(now) == true }.minByOrNull { it.kickoff!! }
        ?: return DreamStandings(d)
    Panel(Modifier.width(620.dp), padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                SectionLabel("Next kickoff", W.Neon)
                Spacer(Modifier.height(4.dp))
                BasicText("${next.away} @ ${next.home}", style = W.big(30))
            }
            Column(horizontalAlignment = Alignment.End) {
                BasicText(next.kickoff!!.atZone(zone).format(KICK), style = W.body(16))
                BasicText(next.broadcast ?: "", style = W.body(13, W.Muted))
            }
        }
    }
}

/** The screensaver on demand (Settings → Preview screensaver); any button closes it. */
class ScreensaverPreview : androidx.activity.ComponentActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        Api.cacheDir = java.io.File(cacheDir, "api")
        val store = Store(this)
        setContent { Screensaver(store) }
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (event.action == android.view.KeyEvent.ACTION_UP) finish()
        return true
    }
}
