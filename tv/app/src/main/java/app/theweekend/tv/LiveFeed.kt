package app.theweekend.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/** Something the backend told us the moment it happened (backend app/tv_live.py). */
sealed interface LiveEvent {
    data object Scores : LiveEvent
    data class Touchdown(
        val playerName: String,
        val position: String?,
        val proTeam: String?,
        val teamName: String,
        val pointsDelta: Double?,
    ) : LiveEvent

    /** A starter named inactive ~90 min before kickoff (backend app/notifications/inactives.py). */
    data class Inactive(val playerName: String, val teamName: String, val kickoff: String?) : LiveEvent
}

/**
 * The TV's live line: one long-lived GET /tv/live (Server-Sent Events).
 * Reconnects on its own with backoff (2, 4, 8 … 60 s); `onConnected`
 * reports whether it's up so the screen can poll as a fallback when it isn't.
 */
object LiveFeed {
    /**
     * Every event the home screen hears, for the rest of the app too: the
     * overlay (same process) shows inactive starters over a stream.
     */
    val events = kotlinx.coroutines.flow.MutableSharedFlow<LiveEvent>(extraBufferCapacity = 16)

    suspend fun run(token: () -> String?, onConnected: (Boolean) -> Unit, onEvent: (LiveEvent) -> Unit) =
        stream("/tv/live", token, onConnected) { j ->
            val e = when (j.optString("type")) {
                "scores" -> LiveEvent.Scores
                "touchdown" -> LiveEvent.Touchdown(
                    playerName = j.optString("player_name"),
                    position = j.optStringOrNull("position"),
                    proTeam = j.optStringOrNull("pro_team"),
                    teamName = j.optString("team_name"),
                    pointsDelta = j.optDoubleOrNull("points_delta"),
                )
                "inactive" -> LiveEvent.Inactive(j.optString("player_name"), j.optString("team_name"), j.optStringOrNull("kickoff"))
                else -> null
            }
            if (e != null) {
                events.tryEmit(e)
                onEvent(e)
            }
        }

    /** Holds one Server-Sent Events line open (GET `path`), handing each `data:` object to `onJson`. */
    suspend fun stream(path: String, token: () -> String?, onConnected: (Boolean) -> Unit, onJson: (JSONObject) -> Unit) {
        var backoff = 2_000L
        while (coroutineContext.isActive) {
            val t = token() ?: return
            val ok = runCatching { listen(path, t, onConnected, onJson) }.isSuccess
            onConnected(false)
            if (ok) backoff = 2_000L
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(60_000L)
        }
    }

    private suspend fun listen(path: String, token: String, onConnected: (Boolean) -> Unit, onJson: (JSONObject) -> Unit) =
        withContext(Dispatchers.IO) {
            val conn = URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = 15_000
                conn.readTimeout = 45_000  // the server pings every 15 s; silence this long means it's gone
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Accept", "text/event-stream")
                if (conn.responseCode != 200) throw ApiError(conn.responseCode, "live line refused")
                onConnected(true)
                conn.inputStream.bufferedReader().useLines { lines ->
                    for (line in lines) {
                        if (!line.startsWith("data:")) continue
                        val j = runCatching { JSONObject(line.removePrefix("data:").trim()) }.getOrNull() ?: continue
                        withContext(Dispatchers.Main) { onJson(j) }
                    }
                }
            } finally {
                conn.disconnect()
            }
        }
}
