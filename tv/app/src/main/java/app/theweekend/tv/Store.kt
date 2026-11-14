package app.theweekend.tv

import android.content.Context
import android.content.SharedPreferences

/**
 * Everything the TV remembers, in app-private storage (backups are off in
 * the manifest). The TV's session token is watch-only on the server side
 * (backend app/auth/tv_session.py), so a leaked one can't change anything.
 */
class Store(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("weekend_tv", Context.MODE_PRIVATE)

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    /** The remote button that opens the overlay, learned by pressing it once. -1 = not set. */
    var hotkey: Int
        get() = prefs.getInt("hotkey", -1)
        set(v) = prefs.edit().putInt("hotkey", v).apply()

    /** True while Settings is waiting for "press the button you want". */
    var learningHotkey: Boolean
        get() = prefs.getBoolean("learning_hotkey", false)
        set(v) = prefs.edit().putBoolean("learning_hotkey", v).apply()

    var overlayOn: Boolean
        get() = prefs.getBoolean("overlay_on", true)
        set(v) = prefs.edit().putBoolean("overlay_on", v).apply()

    var popupsOn: Boolean
        get() = prefs.getBoolean("popups_on", true)
        set(v) = prefs.edit().putBoolean("popups_on", v).apply()

    /** Set by the "Google TV home" tile so the next visit to Google's home isn't redirected. */
    var allowGoogleHome: Boolean
        get() = prefs.getBoolean("allow_google_home", false)
        set(v) = prefs.edit().putBoolean("allow_google_home", v).apply()

    /** Package of the app in front, written by RemoteService. */
    var foregroundPackage: String?
        get() = prefs.getString("fg_pkg", null)
        set(v) = prefs.edit().putString("fg_pkg", v).apply()

    fun delaySeconds(app: StreamApp): Int = prefs.getInt("delay_${app.key}", app.defaultDelay)
    fun setDelaySeconds(app: StreamApp, seconds: Int) =
        prefs.edit().putInt("delay_${app.key}", seconds.coerceIn(0, 180)).apply()

    fun listen(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.registerOnSharedPreferenceChangeListener(listener)

    fun unlisten(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.unregisterOnSharedPreferenceChangeListener(listener)
}

/**
 * The apps games are watched in, matched by the app's name on the TV
 * (package names differ by region and version). Each one runs a different
 * distance behind the live data; defaults are a starting guess the
 * Settings screen tunes. The overlay shows up over any of these.
 */
enum class StreamApp(val key: String, val label: String, val nameHints: List<String>, val defaultDelay: Int) {
    PARAMOUNT("paramount", "Paramount+", listOf("paramount"), 40),
    PEACOCK("peacock", "Peacock", listOf("peacock"), 45),
    ESPN("espn", "ESPN", listOf("espn"), 30),
    HULU("hulu", "Hulu", listOf("hulu"), 45),
    DISNEY("disney", "Disney+", listOf("disney"), 40),
    PRIME("prime", "Prime Video", listOf("prime video", "amazon"), 40),
    NETFLIX("netflix", "Netflix", listOf("netflix"), 40),
    YOUTUBE_TV("youtubetv", "YouTube TV", listOf("youtube tv"), 40);

    fun matches(appLabel: String): Boolean = nameHints.any { appLabel.lowercase().contains(it) }

    companion object {
        /**
         * The apps that carry a network's games, best first, from ESPN's
         * broadcast name. FOX lives in Hulu + Live TV; ESPN/ABC games also
         * stream on Disney+ and Hulu.
         */
        fun forBroadcast(broadcast: String?): List<StreamApp> {
            val b = broadcast?.uppercase() ?: return emptyList()
            return when {
                "CBS" in b || "PARAMOUNT" in b -> listOf(PARAMOUNT, YOUTUBE_TV)
                "NBC" in b || "PEACOCK" in b -> listOf(PEACOCK, YOUTUBE_TV)
                "ESPN" in b || "ABC" in b -> listOf(ESPN, DISNEY, HULU, YOUTUBE_TV)
                "FOX" in b -> listOf(HULU, YOUTUBE_TV)
                "PRIME" in b || "AMAZON" in b -> listOf(PRIME)
                "NFL NET" in b || "NFLN" in b -> listOf(HULU, YOUTUBE_TV)
                "NETFLIX" in b -> listOf(NETFLIX)
                "YOUTUBE" in b -> listOf(YOUTUBE_TV)
                else -> emptyList()
            }
        }

        fun forLabel(appLabel: String): StreamApp? = entries.firstOrNull { it.matches(appLabel) }
    }
}
