package app.theweekend.tv

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The home screen (this activity is the TV's HOME), plus pairing and the other tabs. */
class MainActivity : ComponentActivity() {
    private lateinit var store: Store
    private var sounds: IntroSounds? = null

    // The intro plays on a cold start and when the TV wakes from standby,
    // not when you come back from YouTube: so it's only re-armed when we
    // were stopped with the screen off.
    private var intro by mutableStateOf(false)
    private var stoppedAsleep = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        Api.cacheDir = java.io.File(cacheDir, "api")
        ensureRemoteService()
        sounds = IntroSounds(this)
        intro = store.introOn && store.token != null
        setContent {
            var paired by remember { mutableStateOf(store.token != null) }
            if (!paired) {
                PairingScreen(onPaired = { token ->
                    store.token = token
                    startOverlay()
                    paired = true
                })
            } else {
                Box(Modifier.fillMaxSize()) {
                    // Home is built under the intro but not drawn (alpha 0 skips it), so it's ready the moment the intro fades.
                    Box(Modifier.fillMaxSize().graphicsLayer { alpha = if (intro && !introFading) 0f else 1f }) {
                        Shell(store, onSignedOut = { paired = false }, open = openRequest, onOpened = { openRequest = null })
                    }
                    if (intro) {
                        WelcomeIntro(store.accountName, sounds.takeIf { store.introSound }, onFading = { introFading = true }) {
                            intro = false
                            introFading = false
                        }
                    }
                }
            }
        }
        if (store.token != null) startOverlay()
        takeOpen(intent)
    }

    private var introFading by mutableStateOf(false)

    // "Send to TV" from the phone (RemoteService): a screen, and a game for Gamecast.
    private var openRequest by mutableStateOf<Pair<String, String?>?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeOpen(intent)
    }

    private fun takeOpen(intent: Intent?) {
        val screen = intent?.getStringExtra(EXTRA_SCREEN) ?: return
        openRequest = screen to intent.getStringExtra(EXTRA_GAME)
        intro = false  // the phone asked for something; show it
    }

    override fun onStart() {
        super.onStart()
        ensureRemoteService()
        if (stoppedAsleep && store.introOn && store.token != null) intro = true
        stoppedAsleep = false
    }

    override fun onStop() {
        super.onStop()
        stoppedAsleep = !(getSystemService(POWER_SERVICE) as android.os.PowerManager).isInteractive
    }

    override fun onDestroy() {
        sounds?.release()
        super.onDestroy()
    }

    /**
     * Drops an arrow press that's gone stale before reaching us: if the TV was
     * busy, presses queue up and then land in a burst, which reads as focus
     * skipping past where you meant to stop. A held key (repeats) still scrolls.
     * Each press is logged under "WeekendKeys" so skips can be diagnosed.
     */
    companion object {
        const val EXTRA_SCREEN = "screen"
        const val EXTRA_GAME = "game_id"
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Any button skips the intro (and isn't also acted on behind it).
        if (intro) {
            if (event.action == KeyEvent.ACTION_UP) {
                intro = false
                introFading = false
            }
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode in ARROWS) {
            val age = SystemClock.uptimeMillis() - event.eventTime
            Log.d("WeekendKeys", "key=${KeyEvent.keyCodeToString(event.keyCode)} repeat=${event.repeatCount} age=${age}ms")
            if (event.repeatCount == 0 && age > STALE_MS) return true
        }
        return super.dispatchKeyEvent(event)
    }

    /**
     * Android switches an accessibility service off whenever its app is
     * stopped for an update or reinstall, which would quietly kill the
     * overlay button and the phone remote. With WRITE_SECURE_SETTINGS
     * (granted once over adb) the app puts it back; without it, nothing.
     */
    private fun ensureRemoteService() {
        runCatching {
            val me = "$packageName/${RemoteService::class.java.name}"
            val cr = contentResolver
            val on = android.provider.Settings.Secure.getString(cr, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
                ?.takeIf { it.isNotBlank() && it != "null" }
            if (on?.split(':')?.contains(me) == true) return
            android.provider.Settings.Secure.putString(cr, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, listOfNotNull(on, me).joinToString(":"))
            android.provider.Settings.Secure.putInt(cr, android.provider.Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        }
    }

    private fun startOverlay() {
        runCatching { startForegroundService(Intent(this, OverlayService::class.java)) }
    }
}

private val ARROWS = setOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT)
private const val STALE_MS = 250

private val NAV_CLOCK = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

/** The top menu and whichever screen is open under it, all fed by one refresh loop. */
@Composable
private fun Shell(store: Store, onSignedOut: () -> Unit, open: Pair<String, String?>? = null, onOpened: () -> Unit = {}) {
    val context = LocalContext.current
    var tab by remember { mutableStateOf("home") }
    var hovered by remember { mutableStateOf<String?>(null) }
    var data by remember { mutableStateOf<HomeData?>(null) }
    var lastGood by remember { mutableStateOf<Instant?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableStateOf(Instant.now()) }
    val apps = remember { Apps.installed(context, store.appOrder).toMutableStateList() }
    val firstFocus = remember { FocusRequester() }
    val navFocus = remember { FocusRequester() }
    var reader by remember { mutableStateOf<Pair<String, String>?>(null) }
    // The game whose Gamecast is open (from Scores), and its card to land back on.
    var gamecast by remember { mutableStateOf<NflGame?>(null) }
    var lastGame by remember { mutableStateOf<String?>(null) }
    val gameCard = remember { FocusRequester() }
    // Where focus should land after a screen change we caused: "nav" (the
    // tab you just opened) or "content" (Home's main card).
    var focusTarget by remember { mutableStateOf<String?>(null) }
    val zone = ZoneId.systemDefault()

    var live by remember { mutableStateOf(false) }
    var touchdown by remember { mutableStateOf<LiveEvent.Touchdown?>(null) }
    // Your starters named inactive today (the live line); the roster's injury report covers the rest.
    var inactive by remember { mutableStateOf(emptySet<String>()) }
    val refreshNow = remember { Channel<Unit>(Channel.CONFLATED) }

    LaunchedEffect(Unit) {
        // Who's signed in, for the intro's "Welcome back, …" next time.
        // Same name the website's Welcome Back uses: your owner name, else the account's.
        store.token?.let { t -> runCatching { Api.get("/auth/me", t) }.onSuccess { store.accountName = it.optStringOrNull("display_name") } }
    }
    LaunchedEffect(Unit) {
        // The last known league first, so waking the TV is instant; then the real thing.
        store.token?.let { t -> runCatching { League.home(t, fromCache = true) }.onSuccess { if (data == null) data = it } }
        while (true) {
            val token = store.token ?: return@LaunchedEffect onSignedOut()
            try {
                val fresh = League.home(token)
                // A refresh that changed nothing leaves the screen alone; swapping in
                // an equal copy rebuilt every card, and could land mid-press.
                if (fresh.copy(fetchedAt = Instant.EPOCH) != data?.copy(fetchedAt = Instant.EPOCH)) data = fresh
                lastGood = fresh.fetchedAt
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
            // The live line says when something moved; polling is the backstop.
            val wait = when {
                data?.isGameDay() != true -> 300_000L
                live -> 120_000L
                else -> 30_000L
            }
            withTimeoutOrNull(wait) { refreshNow.receive() }
        }
    }
    LaunchedEffect(Unit) {
        LiveFeed.run(
            token = { store.token },
            onConnected = { live = it },
            onEvent = { e ->
                when (e) {
                    LiveEvent.Scores -> refreshNow.trySend(Unit)
                    is LiveEvent.Touchdown -> {
                        touchdown = e
                        refreshNow.trySend(Unit)
                    }
                    is LiveEvent.Inactive -> if (e.teamName == data?.week?.teamName) inactive = inactive + e.playerName
                }
            },
        )
    }
    LaunchedEffect(touchdown) {
        if (touchdown != null) {
            delay(8_000)
            touchdown = null
        }
    }
    LaunchedEffect(Unit) {
        // On the minute, so the clocks turn over on time without rebuilding the screen every few seconds.
        while (true) {
            now = Instant.now()
            delay(60_000 - System.currentTimeMillis() % 60_000 + 50)
        }
    }
    // Land in the content on Home (a game to watch, or the first app), not the menu.
    LaunchedEffect(data != null) { if (tab == "home") runCatching { firstFocus.requestFocus() } }

    // Sliding across the menu opens a screen only once you stop on its tab, so
    // passing over League on the way to Scores doesn't build League.
    LaunchedEffect(hovered) {
        val h = hovered ?: return@LaunchedEffect
        delay(250)
        tab = h
    }

    LaunchedEffect(tab, focusTarget, reader, gamecast) {
        val target = focusTarget ?: return@LaunchedEffect
        delay(60)
        runCatching {
            when (target) {
                "nav" -> navFocus.requestFocus()
                "game" -> gameCard.requestFocus()
                else -> firstFocus.requestFocus()
            }
        }
        focusTarget = null
    }

    fun openTab(t: String) {
        hovered = null
        tab = t
        focusTarget = "nav"
    }

    // Moving to another tab closes whatever was opened over the last one (Gamecast belongs to Scores).
    LaunchedEffect(tab) {
        reader = null
        if (tab != "scores") gamecast = null
    }

    // The phone sent a screen (Send to TV). Gamecast waits for the league to load to find the game.
    LaunchedEffect(open, data != null) {
        val (screen, gameId) = open ?: return@LaunchedEffect
        hovered = null
        reader = null
        if (screen == "gamecast") {
            val games = data?.games ?: return@LaunchedEffect
            val g = games.firstOrNull { it.id == gameId }
                ?: NflGame(gameId ?: return@LaunchedEffect, "", "", null, null, "in", null, null, null)
            tab = "scores"
            lastGame = g.id
            gamecast = g
            focusTarget = null
        } else {
            gamecast = null
            tab = screen
            focusTarget = if (screen == "home") "content" else "nav"
        }
        onOpened()
    }

    // Back closes the reader or Gamecast, then goes Home; on Home it has nowhere to go (this is the TV's home).
    BackHandler {
        hovered = null
        when {
            gamecast != null -> {
                gamecast = null
                focusTarget = "game"
            }
            reader != null -> {
                reader = null
                focusTarget = if (tab == "home") "content" else "nav"
            }
            tab != "home" -> {
                tab = "home"
                focusTarget = "content"
            }
        }
    }

    val gameDay = data?.isGameDay(now, zone) == true
    HiveBackground(gameDay) {
        Column(Modifier.fillMaxSize().padding(start = 48.dp, end = 48.dp, top = 20.dp, bottom = 16.dp)) {
            val alerts = data?.let { lineupAlerts(it.roster, it.games, inactive) }.orEmpty()
            val alert = when (alerts.size) {
                0 -> null
                1 -> alerts[0].let { a -> a.short + (a.kickoff?.let { " · swap by " + it.atZone(zone).format(NAV_CLOCK) } ?: "") }
                else -> "${alerts.size} starters can't play"
            }
            NavBar(tab, gameDay, now.atZone(zone).format(NAV_CLOCK), onPick = { hovered = null; tab = it }, onHover = { hovered = it }, firstTab = navFocus, live = live, alert = alert)
            Spacer(Modifier.height(12.dp))
            Box(Modifier.weight(1f)) {
                val r = reader
                val gc = gamecast
                val shown = if (r != null) "reader" else if (gc != null) "gamecast" else tab
                KeptTabs(shown, warm = data != null) { key ->
                    when (key) {
                        "reader" -> if (r != null) ReaderScreen(r.first, r.second)
                        "gamecast" -> if (gc != null) GamecastScreen(gc, data, apps, store.token)
                        "matchup" -> MatchupScreen(data, onRead = { t, b -> reader = t to b })
                        "redzone" -> RedZoneScreen(data, apps, touchdown)
                        "league" -> LeagueScreen(data)
                        "lounge" -> LoungeScreen(data, store.token, onRead = { t, b -> reader = t to b })
                        "scores" -> ScoresScreen(data, apps, lastGame, gameCard, onOpen = { g ->
                            lastGame = g.id
                            gamecast = g
                        })
                        "settings" -> SettingsScreen(store, apps, open = shown == "settings", onForget = {
                            store.token = null
                            onSignedOut()
                        })
                        else -> HomeScreen(
                            data, error, apps, store, now, gameDay, firstFocus,
                            onOpenTab = ::openTab,
                            onRead = { t, b -> reader = t to b },
                        )
                    }
                }
            }
        }
        // On Red Zone the scoring team's tile lights up instead.
        touchdown?.takeIf { tab != "redzone" || reader != null }?.let { td -> TouchdownBanner(td, data, Modifier.align(Alignment.BottomStart).padding(start = 48.dp, bottom = 110.dp)) }
        val d = data
        if (error != null && d != null) {
            BasicText(
                "Not updating · last good ${(lastGood ?: d.fetchedAt).atZone(zone).format(DateTimeFormatter.ofPattern("h:mm a", Locale.US))}",
                style = W.body(12, W.Stale, bold = true),
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = 4.dp),
            )
        }
    }
}

/** Tabs kept built in the background, so opening one only has to show it. */
private val KEPT = listOf("home", "matchup", "redzone", "league", "lounge", "scores", "settings")

/**
 * Shows one screen, but keeps every tab built (and
 * laid out) behind it: building a screen the first time you stopped on its
 * tab took ~100 ms on the Chromecast, a visible hitch in the menu. They're
 * built a moment after the league loads, then only shown or hidden. Hidden
 * ones aren't placed, so they don't draw and focus can't wander into them.
 * The reader and Gamecast are built when opened.
 */
@Composable
private fun KeptTabs(shown: String, warm: Boolean, screen: @Composable (String) -> Unit) {
    var built by remember { mutableStateOf(setOf(shown)) }
    LaunchedEffect(warm) {
        if (!warm) return@LaunchedEffect
        delay(1_500)  // after Home has drawn and settled
        for (k in KEPT) {
            if (k !in built) built = built + k
            delay(400)  // one at a time, so a press in the meantime still gets a frame
        }
    }
    if (shown !in built) built = built + shown
    val keys = (built.filter { it in KEPT } + shown).distinct()
    androidx.compose.ui.layout.Layout(
        content = {
            keys.forEach { k ->
                androidx.compose.runtime.key(k) {
                    Box(Modifier.fillMaxSize()) { screen(k) }
                }
            }
        },
    ) { measurables, constraints ->
        val placeables = measurables.map { it.measure(constraints) }
        layout(constraints.maxWidth, constraints.maxHeight) {
            placeables[keys.indexOf(shown)].place(0, 0)
        }
    }
}
