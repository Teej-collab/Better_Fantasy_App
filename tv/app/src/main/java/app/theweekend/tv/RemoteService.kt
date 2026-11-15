package app.theweekend.tv

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The jobs that need an accessibility service on Android TV:
 *  - the overlay button: one remote button (learned in Settings) opens the
 *    overlay's menu from inside any app;
 *  - which app is in front, so the overlay knows to show up over
 *    Paramount+/ESPN/Peacock and which stream delay to use;
 *  - the phone: "Send to TV" and the phone remote (GET /tv/remote) press
 *    buttons and open screens, in any app.
 * It never reads what's on screen (canRetrieveWindowContent is off).
 */
class RemoteService : AccessibilityService() {
    private lateinit var store: Store
    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onServiceConnected() {
        store = Store(this)
        scope.launch { LiveFeed.stream("/tv/remote", { store.token }, {}) { j -> fromPhone(j) } }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun fromPhone(j: org.json.JSONObject) {
        when (j.optString("type")) {
            "key" -> if (j.optString("key") == "menu") openOverlayMenu() else KEYS[j.optString("key")]?.let { performGlobalAction(it) }
            "open" -> startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(MainActivity.EXTRA_SCREEN, j.optString("screen"))
                    .putExtra(MainActivity.EXTRA_GAME, j.optStringOrNull("game_id")),
            )
        }
    }

    /** The overlay (main process) opens or closes its menu. */
    private fun openOverlayMenu() {
        runCatching { startService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_MENU)) }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg in IGNORED) return
        // Our own overlay windows (the menu, sync) aren't an app coming to the front.
        if (pkg == packageName && event.className?.toString()?.endsWith("Activity") != true) return
        if (store.foregroundPackage != pkg) store.foregroundPackage = pkg
        // Google TV keeps the Home button for its own home screen, so when
        // that comes up we put ours in front instead. Its home stays installed
        // (the "Google TV home" tile still opens it), so nothing can lock you out.
        if (pkg == GOOGLE_HOME) {
            if (store.allowGoogleHome) return
            // Google's home finishes the other tasks as its Home transition
            // settles, so going straight back loses the race. Wait for it,
            // then check again once more in case it wasn't done.
            handler.removeCallbacksAndMessages(null)
            for (wait in longArrayOf(450, 1300)) {
                handler.postDelayed({
                    if (store.foregroundPackage == GOOGLE_HOME && !store.allowGoogleHome) {
                        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }, wait)
            }
        } else if (pkg != packageName && store.allowGoogleHome) {
            store.allowGoogleHome = false
        }
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code in NAVIGATION) return false
        if (store.learningHotkey) {
            if (event.action == KeyEvent.ACTION_UP) {
                store.hotkey = code
                store.learningHotkey = false
            }
            return true
        }
        if (code == store.hotkey) {
            // The overlay (main process) opens or closes its menu.
            if (event.action == KeyEvent.ACTION_UP) openOverlayMenu()
            return true
        }
        return false
    }

    override fun onInterrupt() {}

    companion object {
        // Never claimable: you'd lose the ability to move around.
        private val NAVIGATION = setOf(
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_HOME, KeyEvent.KEYCODE_POWER,
            KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE,
        )
        const val GOOGLE_HOME = "com.google.android.apps.tv.launcherx"

        // The phone remote's buttons, as the system's own presses (Android 13+ D-pad actions).
        private val KEYS = mapOf(
            "up" to GLOBAL_ACTION_DPAD_UP, "down" to GLOBAL_ACTION_DPAD_DOWN,
            "left" to GLOBAL_ACTION_DPAD_LEFT, "right" to GLOBAL_ACTION_DPAD_RIGHT,
            "ok" to GLOBAL_ACTION_DPAD_CENTER, "back" to GLOBAL_ACTION_BACK, "home" to GLOBAL_ACTION_HOME,
            "playpause" to GLOBAL_ACTION_KEYCODE_HEADSETHOOK,
        )

        // System surfaces that flash in front of the real app (volume, keyboard).
        private val IGNORED = setOf("com.android.systemui", "com.google.android.inputmethod.latin", "com.google.android.tvrecommendations")
    }
}
