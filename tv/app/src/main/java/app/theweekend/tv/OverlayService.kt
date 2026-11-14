package app.theweekend.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.IBinder
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The score overlay drawn on top of whatever's playing: a score bug in the
 * top-right corner (clear of the network's own score bar at the bottom)
 * and a pop-up when one of your players scores.
 *
 * Everything shown is held back by that streaming app's delay (Settings),
 * so the overlay never spoils a play before your stream shows it. The
 * window can't take focus or touches: the remote keeps driving the app.
 */
class OverlayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var store: Store
    private lateinit var wm: WindowManager
    private var bug: LinearLayout? = null
    private var popup: LinearLayout? = null

    private data class Snapshot(val at: Long, val week: MyWeek, val points: Map<String, Pair<String, Double>>)

    private val snapshots = ArrayDeque<Snapshot>()
    private var shown: Snapshot? = null
    private var lastFetch = 0L

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
        scope.launch { displayLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        scope.cancel()
        removeViews()
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

    private fun wanted(): Boolean = store.overlayOn && frontStreamApp() != null && Settings.canDrawOverlays(this)

    private suspend fun fetchLoop() {
        while (true) {
            val token = store.token
            // Only poll fast while the overlay is actually up; otherwise check in now and then.
            val every = if (wanted()) 20_000L else 120_000L
            if (token != null && System.currentTimeMillis() - lastFetch >= every) {
                lastFetch = System.currentTimeMillis()
                runCatching {
                    val week = League.myWeek(token)
                    if (week != null && week.started) {
                        val points = if (store.popupsOn) {
                            League.roster(token).filter { it.starting && it.points != null }
                                .associate { it.id to (it.name to it.points!!) }
                        } else emptyMap()
                        snapshots.addLast(Snapshot(System.currentTimeMillis(), week, points))
                        while (snapshots.size > 30) snapshots.removeFirst()
                    }
                }
            }
            delay(5_000)
        }
    }

    private suspend fun displayLoop() {
        while (true) {
            render()
            delay(1_000)
        }
    }

    /** Shows the newest data your stream has caught up to, and pops up anything new of yours. */
    private fun render() {
        if (!wanted()) {
            removeViews()
            return
        }
        val delayMs = (frontStreamApp()?.let { store.delaySeconds(it) } ?: 0) * 1000L
        val cutoff = System.currentTimeMillis() - delayMs
        val due = snapshots.lastOrNull { it.at <= cutoff } ?: return removeViews()
        val previous = shown
        if (previous !== due) {
            shown = due
            if (previous != null && store.popupsOn) {
                val gains = due.points.mapNotNull { (id, now) ->
                    val before = previous.points[id]?.second ?: return@mapNotNull null
                    (now.second - before).takeIf { it >= 2.0 }?.let { now.first to it }
                }
                gains.maxByOrNull { it.second }?.let { (name, gain) -> showPopup(name, gain, due.week) }
            }
        }
        showBug(due.week, delayMs / 1000)
    }

    // ---- views (plain Views: lighter than Compose for a window that never takes focus) ----

    private val anton by lazy { ResourcesCompat.getFont(this, R.font.anton) ?: Typeface.DEFAULT_BOLD }
    private val interBold by lazy { ResourcesCompat.getFont(this, R.font.inter_bold) ?: Typeface.DEFAULT_BOLD }
    private val interMedium by lazy { ResourcesCompat.getFont(this, R.font.inter_medium) ?: Typeface.DEFAULT }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).roundToInt()

    private fun text(size: Float, face: Typeface, color: Int = Color.WHITE) = TextView(this).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        typeface = face
        setTextColor(color)
        maxLines = 1
    }

    private fun panel(stroke: Int, strokeWidth: Int) = GradientDrawable().apply {
        setColor(Color.argb(240, 11, 13, 18))
        cornerRadius = dp(14).toFloat()
        setStroke(dp(strokeWidth), stroke)
    }

    private fun params(gravity: Int, x: Int, y: Int) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply {
        this.gravity = gravity
        this.x = x
        this.y = y
    }

    private val neon = Color.rgb(57, 255, 20)
    private val muted = Color.rgb(154, 163, 178)
    private val line = Color.argb(60, 255, 255, 255)

    private fun showBug(w: MyWeek, delaySec: Long) {
        val root = bug ?: LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = panel(line, 1)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            minimumWidth = dp(300)
        }.also {
            bug = it
            wm.addView(it, params(Gravity.TOP or Gravity.END, dp(36), dp(28)))
        }
        root.removeAllViews()
        root.addView(text(11f, interBold, muted).apply { text = "THE WEEKEND · WEEK ${w.week}"; letterSpacing = 0.14f })
        root.addView(scoreLine("You", w.myScore, Color.WHITE))
        root.addView(scoreLine(w.oppOwnerName ?: w.oppTeamName, w.oppScore, Color.rgb(199, 204, 214)))
        val p = w.winProbability
        root.addView(text(12f, interMedium, muted).apply {
            text = listOfNotNull(
                p?.let { "${it.roundToInt()}% win (est.)" },
                "${w.myYetToPlay + w.myInPlay} vs ${w.oppYetToPlay + w.oppInPlay} left",
                if (delaySec > 0) "−${delaySec}s" else null,
            ).joinToString(" · ")
        })
    }

    private fun scoreLine(name: String, score: Double?, color: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(text(17f, interBold, color).apply { text = name }, LinearLayout.LayoutParams(0, -2, 1f))
        addView(text(28f, anton, color).apply { text = fmt(score) })
    }

    private fun showPopup(name: String, gain: Double, w: MyWeek) {
        popup?.let { runCatching { wm.removeView(it) } }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = panel(neon, 2)
            setPadding(dp(20), dp(14), dp(24), dp(14))
            addView(LinearLayout(this@OverlayService).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(11f, interBold, neon).apply { text = "YOUR PLAYER"; letterSpacing = 0.18f })
                addView(text(22f, interBold).apply { text = name })
                addView(text(13f, interMedium, muted).apply {
                    text = "You ${fmt(w.myScore)} · ${w.oppOwnerName ?: w.oppTeamName} ${fmt(w.oppScore)}"
                })
            })
            addView(View(this@OverlayService), LinearLayout.LayoutParams(dp(28), 1))
            addView(text(40f, anton, neon).apply { text = "+" + String.format("%.1f", gain) })
        }
        popup = root
        // Bottom-left, above where networks put their own score bar.
        wm.addView(root, params(Gravity.BOTTOM or Gravity.START, dp(36), dp(96)))
        root.translationX = -dp(600).toFloat()
        root.animate().translationX(0f).setDuration(350).start()
        scope.launch {
            delay(6_000)
            if (popup === root) {
                root.animate().alpha(0f).setDuration(300).withEndAction {
                    runCatching { wm.removeView(root) }
                    if (popup === root) popup = null
                }.start()
            }
        }
    }

    private fun removeViews() {
        bug?.let { runCatching { wm.removeView(it) } }
        bug = null
    }
}
