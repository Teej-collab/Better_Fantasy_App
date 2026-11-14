package app.theweekend.tv

import android.accessibilityservice.AccessibilityService
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Two small jobs, both needing an accessibility service on Android TV:
 *  - the overlay button: one remote button (learned in Settings) turns the
 *    score overlay on and off from inside any app;
 *  - which app is in front, so the overlay knows to show up over
 *    Paramount+/ESPN/Peacock and which stream delay to use.
 * It never reads what's on screen (canRetrieveWindowContent is off).
 */
class RemoteService : AccessibilityService() {
    private lateinit var store: Store

    override fun onServiceConnected() {
        store = Store(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg in IGNORED) return
        if (store.foregroundPackage != pkg) store.foregroundPackage = pkg
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
            if (event.action == KeyEvent.ACTION_UP) store.overlayOn = !store.overlayOn
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
        // System surfaces that flash in front of the real app (volume, keyboard).
        private val IGNORED = setOf("com.android.systemui", "com.google.android.inputmethod.latin", "com.google.android.tvrecommendations")
    }
}
