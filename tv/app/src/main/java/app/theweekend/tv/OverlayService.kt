package app.theweekend.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.IBinder
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Everything drawn on top of whatever's playing:
 *  - the score bug (top right, clear of the network's own score bar), or
 *    instead the Gamecast panel down the right side;
 *  - a pop-up when one of your players scores, and a lineup alert when a
 *    starter is out, doubtful or named inactive before his game;
 *  - league chat, one message at a time, top left;
 *  - the menu (the overlay button): what to show, which game, the stream
 *    delay, sync to the snap, pop-ups, chat.
 *
 * Everything from a game is held back by that streaming app's delay
 * (Settings, or synced to the snap), so nothing spoils a play before your
 * stream shows it. Only the menu and the sync prompt take the remote; the
 * rest can't take focus, so the remote keeps driving the app.
 */
class OverlayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var store: Store
    private lateinit var wm: WindowManager

    // ---- data ----

    private data class Snapshot(val at: Long, val week: MyWeek, val points: Map<String, Pair<String, Double>>)

    private val snapshots = ArrayDeque<Snapshot>()
    private var shown: Snapshot? = null
    private var lastFetch = 0L
    private var games: List<NflGame> = emptyList()
    private var roster: List<RosterPlayer> = emptyList()
    private var inactive = emptySet<String>()
    private val alerted = mutableSetOf<String>()

    /** The Gamecast panel's game, on the server's clock: (server time seen, state). */
    private var timeline: List<Pair<Double, GcGame>> = emptyList()
    private var timelineGame: String? = null
    private var serverOffset = 0.0  // server epoch seconds minus ours
    private val impacts = HashMap<String, GcImpact?>()
    private val impactHistory = ArrayDeque<Pair<Long, List<Pair<String, Double?>>>>()  // (fetched at, your players)

    private var chatConversation: Int? = null
    private var myOwnerId: Int? = null
    private var lastChatId = 0
    private val chatQueue = ArrayDeque<Triple<Long, String, String>>()  // (fetched at, who, text)

    // ---- windows ----

    private var bug: LinearLayout? = null
    private var panel: LinearLayout? = null
    private var popup: LinearLayout? = null
    private var chat: LinearLayout? = null
    private var menu: MenuView? = null
    private var sync: SyncView? = null
    private var syncJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("overlay", "Score overlay", NotificationManager.IMPORTANCE_MIN))
        val note = Notification.Builder(this, "overlay")
            .setContentTitle("The Weekend")
            .setContentText("Score overlay is ready")
            .setSmallIcon(R.mipmap.ic_launcher)
            .build()
        startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        scope.launch { fetchLoop() }
        scope.launch { panelLoop() }
        scope.launch { chatLoop() }
        scope.launch { displayLoop() }
        scope.launch {
            // Inactive starters come over the home screen's live line (same process).
            LiveFeed.events.collect { e ->
                if (e is LiveEvent.Inactive && e.teamName == snapshots.lastOrNull()?.week?.teamName) inactive = inactive + e.playerName
            }
        }
    }

    /** The overlay button (RemoteService) sends "menu": open it, or close it if it's up. */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_MENU) {
            when {
                sync != null -> closeSync()
                menu != null -> closeMenu()
                else -> openMenu()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        listOf(bug, panel, popup, chat, menu, sync).forEach { v -> v?.let { runCatching { wm.removeView(it) } } }
        super.onDestroy()
    }

    /** Which of the game apps is in front, if any (matched by the app's name). */
    private fun frontStreamApp(): StreamApp? {
        val pkg = store.foregroundPackage ?: return null
        if (pkg == packageName) return null
        val label = runCatching {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
        }.getOrNull() ?: return null
        return StreamApp.forLabel(label)
    }

    private fun watching(): Boolean = frontStreamApp() != null && Settings.canDrawOverlays(this)
    private fun wanted(): Boolean = store.overlayOn && watching()
    private fun delayMs(): Long = (frontStreamApp()?.let { store.delaySeconds(it) } ?: 0) * 1000L

    // ---- loops ----

    private suspend fun fetchLoop() {
        while (true) {
            val token = store.token
            // Only poll fast while you're watching something; otherwise check in now and then.
            val every = if (watching()) 20_000L else 120_000L
            if (token != null && System.currentTimeMillis() - lastFetch >= every) {
                lastFetch = System.currentTimeMillis()
                runCatching { games = League.games() }
                runCatching {
                    roster = League.roster(token)
                    val week = League.myWeek(token)
                    if (week != null && week.started) {
                        val points = roster.filter { it.starting && it.points != null }.associate { it.id to (it.name to it.points!!) }
                        snapshots.addLast(Snapshot(System.currentTimeMillis(), week, points))
                        while (snapshots.size > 30) snapshots.removeFirst()
                    }
                }
            }
            delay(5_000)
        }
    }

    /** The game the panel (and sync) follows: yours if picked, else the live one with most of your starters. */
    private fun followed(): NflGame? {
        store.followGame?.let { id -> games.firstOrNull { it.id == id }?.let { return it } }
        val starters = roster.filter { it.starting }
        fun mine(g: NflGame) = starters.count { g.has(it.proTeam) }
        return games.filter { it.live }.maxByOrNull { mine(it) }
            ?: games.filter { it.state == "pre" }.minByOrNull { it.kickoff ?: java.time.Instant.MAX }
    }

    private suspend fun refreshTimeline(id: String) {
        runCatching {
            val sent = System.currentTimeMillis()
            val j = Api.get("/nfl/games/$id/timeline", null)
            val local = (sent + System.currentTimeMillis()) / 2000.0
            serverOffset = j.optDouble("server_now", local) - local
            if (timelineGame != id) impacts.clear()
            timelineGame = id
            timeline = j.optJSONArray("snapshots").objects().map { it.optDouble("at") to Gamecast.parse(it.getJSONObject("game")) }
        }
    }

    private suspend fun panelLoop() {
        var round = 0
        while (true) {
            val g = followed()
            if (g != null && ((wanted() && store.overlayPanel) || sync != null)) {
                refreshTimeline(g.id)
                if (round % 10 == 0) {
                    runCatching {
                        val j = Api.get("/nfl/games/${g.id}/fantasy-impact", store.token)
                        val mine = j.optJSONArray("your_players").objects().map { "${it.optString("player_name")}|you" to it.optDoubleOrNull("points_scored") } +
                            j.optJSONArray("opponent_players").objects().map { "${it.optString("player_name")}|opp" to it.optDoubleOrNull("points_scored") }
                        impactHistory.addLast(System.currentTimeMillis() to mine)
                        while (impactHistory.size > 20) impactHistory.removeFirst()
                    }
                }
                dueGame()?.plays?.take(3)?.forEach { p ->
                    if (p.id !in impacts) impacts[p.id] = runCatching { Gamecast.impact(g.id, p.id, store.token) }.getOrNull()
                }
                round++
                delay(3_000)
            } else {
                round = 0
                delay(2_000)
            }
        }
    }

    /** The newest state of the followed game that your stream has caught up to. */
    private fun dueGame(): GcGame? {
        val serverNow = System.currentTimeMillis() / 1000.0 + serverOffset
        val cutoff = serverNow - delayMs() / 1000.0
        return timeline.lastOrNull { it.first <= cutoff }?.second ?: timeline.firstOrNull()?.second?.takeIf { it.status != "in_progress" }
    }

    private suspend fun chatLoop() {
        while (true) {
            val token = store.token
            if (token != null && store.chatOn && wanted()) {
                runCatching {
                    if (myOwnerId == null) myOwnerId = Api.get("/auth/me", token).let { if (it.isNull("owner_id")) null else it.optInt("owner_id") }
                    val conv = chatConversation ?: Api.get("/chat/conversations", token).optJSONArray("conversations").objects()
                        .firstOrNull { it.optString("type") == "league" }?.optInt("id")?.also { chatConversation = it }
                    if (conv != null) {
                        val msgs = Api.get("/chat/conversations/$conv/messages?limit=20", token).optJSONArray("messages").objects()
                        val now = System.currentTimeMillis()
                        val fresh = msgs.filter { it.optInt("id") > lastChatId }
                        // The first look only sets where "new" starts; old messages don't replay.
                        if (lastChatId > 0) {
                            fresh.filter { !it.optBoolean("deleted") && (myOwnerId == null || it.optInt("owner_id") != myOwnerId) }.forEach { m ->
                                val body = m.optStringOrNull("body") ?: if (!m.isNull("image_url")) "📷 Photo" else null
                                if (body != null) chatQueue.addLast(Triple(now, m.optString("owner_name").substringBefore(' '), body))
                            }
                        }
                        msgs.maxOfOrNull { it.optInt("id") }?.let { if (it > lastChatId) lastChatId = it }
                    }
                }
                delay(10_000)
            } else {
                delay(5_000)
            }
        }
    }

    private suspend fun displayLoop() {
        while (true) {
            render()
            delay(1_000)
        }
    }

    // ---- what's on screen ----

    private fun render() {
        if (!wanted()) {
            removeBug(); removePanel(); removeChat()
            return
        }
        lineupAlert()
        val cutoff = System.currentTimeMillis() - delayMs()
        val due = snapshots.lastOrNull { it.at <= cutoff }
        val previous = shown
        if (due != null && previous !== due) {
            shown = due
            if (previous != null && store.popupsOn) {
                val gains = due.points.mapNotNull { (id, now) ->
                    val before = previous.points[id]?.second ?: return@mapNotNull null
                    (now.second - before).takeIf { it >= 2.0 }?.let { now.first to it }
                }
                gains.maxByOrNull { it.second }?.let { (name, gain) -> showPopup("YOUR PLAYER", name, "You ${fmt(due.week.myScore)} · ${due.week.oppOwnerName ?: due.week.oppTeamName} ${fmt(due.week.oppScore)}", "+" + String.format("%.1f", gain), neon) }
            }
        }
        if (store.overlayPanel) {
            removeBug()
            showPanel(due?.week)
        } else {
            removePanel()
            if (due != null) showBug(due.week, delayMs() / 1000) else removeBug()
        }
        if (store.chatOn) showChat() else removeChat()
    }

    /** Once per starter per day: he's out and his game hasn't started. */
    private fun lineupAlert() {
        val a = lineupAlerts(roster, games, inactive).firstOrNull { "${it.playerName}-${it.why}" !in alerted } ?: return
        alerted += "${a.playerName}-${a.why}"
        val kick = a.kickoff?.atZone(ZoneId.systemDefault())?.format(TIME)
        showPopup("LINEUP ALERT", "${a.playerName} is ${a.why.lowercase()}", listOfNotNull(kick?.let { "Kickoff $it" }, "swap him on your phone").joinToString(" · "), "⚠", orange)
    }

    // ---- views (plain Views: lighter than Compose for windows over someone else's app) ----

    private val anton by lazy { ResourcesCompat.getFont(this, R.font.anton) ?: Typeface.DEFAULT_BOLD }
    private val interBold by lazy { ResourcesCompat.getFont(this, R.font.inter_bold) ?: Typeface.DEFAULT_BOLD }
    private val interMedium by lazy { ResourcesCompat.getFont(this, R.font.inter_medium) ?: Typeface.DEFAULT }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).roundToInt()

    private fun text(size: Float, face: Typeface, color: Int = Color.WHITE) = TextView(this).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        typeface = face
        setTextColor(color)
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }

    private fun box(stroke: Int, strokeWidth: Int, fill: Int = Color.argb(240, 11, 13, 18), radius: Int = 14) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(radius).toFloat()
        setStroke(dp(strokeWidth), stroke)
    }

    private fun params(gravity: Int, x: Int, y: Int, focusable: Boolean = false) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        (if (focusable) 0 else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE) or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply {
        this.gravity = gravity
        this.x = x
        this.y = y
    }

    private val neon = Color.rgb(57, 255, 20)
    private val orange = Color.rgb(255, 138, 31)
    private val muted = Color.rgb(154, 163, 178)
    private val dim = Color.rgb(92, 101, 117)
    private val soft = Color.rgb(199, 204, 214)
    private val line = Color.argb(60, 255, 255, 255)

    private fun vertical() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun row(vararg views: Pair<View, Float>) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        views.forEach { (v, w) -> addView(v, if (w > 0) LinearLayout.LayoutParams(0, -2, w) else LinearLayout.LayoutParams(-2, -2)) }
    }

    private fun label(t: String, color: Int = muted) = text(11f, interBold, color).apply { text = t; letterSpacing = 0.14f }

    // -- score bug --

    private fun showBug(w: MyWeek, delaySec: Long) {
        val root = bug ?: vertical().apply {
            background = box(line, 1)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            minimumWidth = dp(300)
        }.also {
            bug = it
            wm.addView(it, params(Gravity.TOP or Gravity.END, dp(36), dp(28)))
        }
        root.removeAllViews()
        root.addView(label("THE WEEKEND · WEEK ${w.week}"))
        root.addView(scoreLine("You", w.myScore, Color.WHITE))
        root.addView(scoreLine(w.oppOwnerName ?: w.oppTeamName, w.oppScore, soft))
        val p = w.winProbability
        root.addView(text(12f, interMedium, muted).apply {
            text = listOfNotNull(
                p?.let { "${it.roundToInt()}% win (est.)" },
                "${w.myYetToPlay + w.myInPlay} vs ${w.oppYetToPlay + w.oppInPlay} left",
                if (delaySec > 0) "−${delaySec}s" else null,
            ).joinToString(" · ")
        })
    }

    private fun scoreLine(name: String, score: Double?, color: Int) = row(
        text(17f, interBold, color).apply { text = name } to 1f,
        text(28f, anton, color).apply { text = fmt(score) } to 0f,
    )

    private fun removeBug() {
        bug?.let { runCatching { wm.removeView(it) } }
        bug = null
    }

    // -- Gamecast panel --

    private fun showPanel(week: MyWeek?) {
        val root = panel ?: vertical().apply {
            background = box(line, 1, radius = 18)
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }.also {
            panel = it
            wm.addView(it, params(Gravity.TOP or Gravity.END, dp(28), dp(24)).apply { width = dp(400) })
        }
        root.removeAllViews()
        val g = dueGame()
        val followed = followed()
        root.addView(row(
            label("GAMECAST", neon) to 1f,
            label(week?.let { "YOU ${fmt(it.myScore)} · ${(it.oppOwnerName ?: it.oppTeamName).substringBefore(' ').uppercase()} ${fmt(it.oppScore)}" } ?: "", soft) to 0f,
        ))
        if (g == null) {
            root.addView(text(15f, interMedium, muted).apply {
                text = if (followed == null) "No game to follow right now." else "Loading ${followed.away} @ ${followed.home}…"
            })
            return
        }
        root.addView(spacer(8))
        val situation = when (g.status) {
            "final" -> "Final"
            "scheduled" -> "Not started"
            "halftime" -> "Halftime"
            else -> listOfNotNull(g.periodLabel, g.clock).joinToString(" ")
        }
        root.addView(row(
            text(22f, anton).apply { text = "${g.away.abbr} ${g.away.score}" } to 0f,
            vertical().apply {
                gravity = Gravity.CENTER_HORIZONTAL
                addView(text(13f, interBold, Color.WHITE).apply { text = situation })
                if (g.live && g.down != null && g.down > 0 && g.distance != null) {
                    addView(text(12f, interBold, if (g.redZone) orange else neon).apply {
                        val dist = if (g.yardsToGoal != null && g.distance >= g.yardsToGoal) "Goal" else "${g.distance}"
                        text = "${g.possession} · ${ordinal(g.down)} & $dist" + (g.fieldLabel?.let { " · $it" } ?: "")
                    })
                }
            } to 1f,
            text(22f, anton).apply { text = "${g.home.score} ${g.home.abbr}" } to 0f,
        ))
        root.addView(spacer(8))
        root.addView(FieldView(this, g), LinearLayout.LayoutParams(-1, dp(64)))
        g.drive?.let { d ->
            root.addView(text(11f, interMedium, muted).apply {
                text = (if (g.live) "Drive" else "Last drive · ${d.team}") + " · ${d.plays} plays · ${d.yards} yds · ${d.duration}"
            })
        }
        // Your players and your opponent's in this game, as of what your stream has shown.
        val cutoff = System.currentTimeMillis() - delayMs()
        val players = impactHistory.lastOrNull { it.first <= cutoff }?.second.orEmpty()
        if (players.isNotEmpty()) {
            root.addView(spacer(10))
            root.addView(label("YOUR MATCHUP IN THIS GAME"))
            players.take(4).forEach { (key, pts) ->
                val (name, side) = key.split('|')
                root.addView(row(
                    text(14f, interBold, if (side == "you") orange else Color.WHITE).apply { text = name } to 1f,
                    text(11f, interMedium, muted).apply { text = if (side == "you") "YOU  " else "OPP  " } to 0f,
                    text(18f, anton, if (side == "you") orange else soft).apply { text = fmt(pts) } to 0f,
                ))
            }
        }
        root.addView(spacer(10))
        root.addView(label("LAST PLAYS"))
        g.plays.take(3).forEach { p ->
            val impact = impacts[p.id]
            root.addView(row(
                text(12f, interMedium, if (p.scoring) neon else Color.rgb(230, 233, 239)).apply { text = p.text } to 1f,
                text(12f, interBold, if (impact?.mine == true) orange else muted).apply { text = impact?.let { "  ${it.text}" } ?: "" } to 0f,
            ))
        }
        root.addView(spacer(8))
        val app = frontStreamApp()
        root.addView(text(10f, interMedium, dim).apply {
            text = listOfNotNull(app?.let { "${it.label} −${store.delaySeconds(it)}s" }, "Overlay button: menu").joinToString(" · ")
        })
    }

    private fun spacer(h: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(h)) }

    private fun removePanel() {
        panel?.let { runCatching { wm.removeView(it) } }
        panel = null
    }

    // -- pop-ups --

    private fun showPopup(tag: String, title: String, sub: String, big: String, accent: Int) {
        popup?.let { runCatching { wm.removeView(it) } }
        val root = row(
            vertical().apply {
                addView(text(11f, interBold, accent).apply { text = tag; letterSpacing = 0.18f })
                addView(text(22f, interBold).apply { text = title })
                addView(text(13f, interMedium, muted).apply { text = sub })
            } to 0f,
            View(this).apply { minimumWidth = dp(28) } to 0f,
            text(40f, anton, accent).apply { text = big } to 0f,
        ).apply {
            background = box(accent, 2)
            setPadding(dp(20), dp(14), dp(24), dp(14))
        }
        popup = root
        // Bottom-left, above where networks put their own score bar.
        wm.addView(root, params(Gravity.BOTTOM or Gravity.START, dp(36), dp(96)))
        root.translationX = -dp(600).toFloat()
        root.animate().translationX(0f).setDuration(350).start()
        scope.launch {
            delay(if (tag == "LINEUP ALERT") 10_000 else 6_000)
            if (popup === root) {
                root.animate().alpha(0f).setDuration(300).withEndAction {
                    runCatching { wm.removeView(root) }
                    if (popup === root) popup = null
                }.start()
            }
        }
    }

    // -- chat --

    private var chatUntil = 0L

    private fun showChat() {
        val now = System.currentTimeMillis()
        if (chat != null && now < chatUntil) return
        removeChat()
        // Held back like everything else: nobody's "TD!!!" beats your stream.
        val next = chatQueue.firstOrNull()?.takeIf { it.first + delayMs() <= now } ?: return
        chatQueue.removeFirst()
        val root = row(
            text(13f, interBold, neon).apply { text = next.second.uppercase() + "  " } to 0f,
            text(15f, interMedium).apply { text = next.third; maxWidth = dp(420) } to 0f,
        ).apply {
            background = box(line, 1, Color.argb(225, 11, 13, 18), radius = 12)
            setPadding(dp(14), dp(9), dp(16), dp(9))
        }
        chat = root
        chatUntil = now + 7_000
        wm.addView(root, params(Gravity.TOP or Gravity.START, dp(36), dp(28)))
        root.alpha = 0f
        root.animate().alpha(1f).setDuration(250).start()
    }

    private fun removeChat() {
        chat?.let { runCatching { wm.removeView(it) } }
        chat = null
    }

    // -- menu --

    private fun openMenu() {
        if (!Settings.canDrawOverlays(this)) return
        val m = MenuView(this)
        menu = m
        wm.addView(m, params(Gravity.CENTER_VERTICAL or Gravity.START, dp(36), 0, focusable = true))
        m.requestFocus()
    }

    private fun closeMenu() {
        menu?.let { runCatching { wm.removeView(it) } }
        menu = null
    }

    /** Up/down to move, left/right to change, OK to pick; Back or the overlay button closes. */
    private inner class MenuView(context: Context) : LinearLayout(context) {
        private var at = 0
        private val app = frontStreamApp()

        private inner class Item(val name: () -> String, val value: () -> String, val change: ((Int) -> Unit)? = null, val pick: (() -> Unit)? = null)

        private val items = buildList {
            add(Item({ "Show" }, {
                when { !store.overlayOn -> "Nothing"; store.overlayPanel -> "Gamecast panel"; else -> "Score bug" }
            }, change = { dir -> cycleShow(dir) }, pick = { cycleShow(1) }))
            add(Item({ "Game" }, {
                val g = followed()
                (if (store.followGame == null) "Auto · " else "") + (g?.let { "${it.away} @ ${it.home}" } ?: "none on")
            }, change = { dir -> cycleGame(dir) }))
            if (app != null) {
                add(Item({ "Stream delay · ${app.label}" }, { "◀ ${store.delaySeconds(app)} s ▶" },
                    change = { dir -> store.setDelaySeconds(app, store.delaySeconds(app) + dir) }))
                add(Item({ "Sync to the snap" }, { "OK" }, pick = { closeMenu(); startSync() }))
            }
            add(Item({ "Scoring pop-ups" }, { if (store.popupsOn) "On" else "Off" }, pick = { store.popupsOn = !store.popupsOn }))
            add(Item({ "League chat" }, { if (store.chatOn) "On" else "Off" }, pick = { store.chatOn = !store.chatOn }))
            add(Item({ "Open The Weekend" }, { "" }, pick = {
                closeMenu()
                startActivity(Intent(this@OverlayService, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }))
        }

        init {
            orientation = VERTICAL
            isFocusable = true
            isFocusableInTouchMode = true
            background = box(neon, 2, radius = 18)
            setPadding(dp(18), dp(16), dp(18), dp(14))
            minimumWidth = dp(420)
            draw()
        }

        private fun cycleShow(dir: Int) {
            val modes = listOf("off", "bug", "panel")
            val now = when { !store.overlayOn -> 0; store.overlayPanel -> 2; else -> 1 }
            val next = modes[(now + dir + modes.size) % modes.size]
            store.overlayOn = next != "off"
            store.overlayPanel = next == "panel"
        }

        private fun cycleGame(dir: Int) {
            // Auto, then every game today: live first.
            val options = listOf<String?>(null) + games.filter { it.state != "post" }
                .sortedWith(compareBy({ if (it.live) 0 else 1 }, { it.kickoff })).map { it.id }
            val i = options.indexOf(store.followGame).coerceAtLeast(0)
            store.followGame = options[(i + dir + options.size) % options.size]
        }

        fun draw() {
            removeAllViews()
            addView(label("THE WEEKEND · OVERLAY", neon))
            addView(spacer(8))
            items.forEachIndexed { i, item ->
                val on = i == at
                addView(row(
                    text(16f, interBold, if (on) Color.rgb(11, 13, 18) else Color.WHITE).apply { text = item.name() } to 1f,
                    text(15f, interBold, if (on) Color.rgb(11, 13, 18) else muted).apply { text = item.value() } to 0f,
                ).apply {
                    background = if (on) box(neon, 2, Color.WHITE, radius = 10) else null
                    setPadding(dp(12), dp(8), dp(12), dp(8))
                })
            }
            addView(spacer(8))
            addView(text(11f, interMedium, dim).apply { text = "◀ ▶ change · OK pick · Back or the overlay button closes" })
        }

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action != KeyEvent.ACTION_DOWN) return true
            val item = items[at]
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> at = (at - 1 + items.size) % items.size
                KeyEvent.KEYCODE_DPAD_DOWN -> at = (at + 1) % items.size
                KeyEvent.KEYCODE_DPAD_LEFT -> item.change?.invoke(-1)
                KeyEvent.KEYCODE_DPAD_RIGHT -> item.change?.invoke(1)
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> item.pick?.invoke()
                KeyEvent.KEYCODE_BACK -> { closeMenu(); return true }
                else -> return false
            }
            if (menu === this) {
                draw()
                render()
            }
            return true
        }
    }

    // -- sync to the snap --

    /**
     * Press OK the moment a play ends on your screen. The feed already has
     * that play (it runs ahead of every stream), so the gap between when
     * the server first saw it and your press is this app's delay.
     */
    private fun startSync() {
        val app = frontStreamApp() ?: return
        val g = followed() ?: return showPopup("SYNC", "No live game to sync to", "Try again once a game's on", "–", muted)
        val v = SyncView(this, app, g)
        sync = v
        wm.addView(v, params(Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL, 0, dp(140), focusable = true))
        v.requestFocus()
        syncJob = scope.launch {
            while (true) {
                refreshTimeline(g.id)
                delay(2_000)
            }
        }
    }

    private fun closeSync() {
        syncJob?.cancel()
        sync?.let { runCatching { wm.removeView(it) } }
        sync = null
    }

    private inner class SyncView(context: Context, val app: StreamApp, val game: NflGame) : LinearLayout(context) {
        init {
            orientation = VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true
            isFocusableInTouchMode = true
            background = box(neon, 2, radius = 16)
            setPadding(dp(22), dp(14), dp(22), dp(14))
            addView(label("SYNC TO THE SNAP · ${app.label.uppercase()} · ${game.away} @ ${game.home}", neon))
            addView(text(20f, interBold).apply { text = "Press OK the moment the next play ends" })
            addView(text(12f, interMedium, muted).apply { text = "Watch for the whistle on your screen · Back cancels" })
        }

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action != KeyEvent.ACTION_DOWN) return true
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> finish()
                KeyEvent.KEYCODE_BACK -> closeSync()
                else -> return false
            }
            return true
        }

        private fun finish() {
            val pressed = System.currentTimeMillis() / 1000.0 + serverOffset
            // When the server first saw each play.
            val firstSeen = LinkedHashMap<String, Double>()
            for ((at, state) in timeline) state.plays.firstOrNull()?.let { p -> firstSeen.putIfAbsent(p.id, at) }
            val seen = firstSeen.values.filter { it <= pressed }.maxOrNull()
            closeSync()
            val gap = seen?.let { (pressed - it).roundToInt() }
            if (gap == null || gap > 150) {
                showPopup("SYNC", "Couldn't match that to a play", "Try again on the next one", "–", muted)
            } else {
                store.setDelaySeconds(app, gap)
                showPopup("SYNCED", "${app.label} runs ${gap} s behind", "Scores, pop-ups and chat now wait that long", "${gap}s", neon)
            }
        }
    }

    companion object {
        const val ACTION_MENU = "app.theweekend.tv.MENU"
        private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

        private fun ordinal(n: Int) = when (n) { 1 -> "1st"; 2 -> "2nd"; 3 -> "3rd"; else -> "${n}th" }
    }
}

/** The Gamecast panel's field: end zones in team colors, the line of scrimmage and the line to gain. */
private class FieldView(context: Context, val g: GcGame) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val ez = w / 12f
        val yd = (w - 2 * ez) / 100f
        fun x(y: Int) = ez + y * yd
        val r = RectF(0f, 0f, w, h)
        paint.color = Color.rgb(22, 58, 31)
        c.drawRoundRect(r, 18f, 18f, paint)
        paint.color = teamColorInt(g.away.abbr)
        c.drawRect(0f, 0f, ez, h, paint)
        paint.color = teamColorInt(g.home.abbr)
        c.drawRect(w - ez, 0f, w, h, paint)
        paint.color = Color.argb(80, 255, 255, 255)
        paint.strokeWidth = 2f
        for (i in 1..9) c.drawLine(x(i * 10), 0f, x(i * 10), h, paint)
        val pos = g.possession
        val ytg = g.yardsToGoal
        if (g.live && pos != null && ytg != null) {
            val ball = if (pos == g.home.abbr) ytg else 100 - ytg
            val dist = g.distance
            if (dist != null && dist in 1 until ytg) {
                paint.color = Color.rgb(255, 212, 0)
                paint.strokeWidth = 5f
                val gain = if (pos == g.home.abbr) ball - dist else ball + dist
                c.drawLine(x(gain), 0f, x(gain), h, paint)
            }
            paint.color = Color.rgb(77, 163, 255)
            paint.strokeWidth = 5f
            c.drawLine(x(ball), 0f, x(ball), h, paint)
            paint.color = Color.rgb(139, 90, 43)
            c.drawCircle(x(ball), h / 2, h / 7, paint)
        }
    }
}
