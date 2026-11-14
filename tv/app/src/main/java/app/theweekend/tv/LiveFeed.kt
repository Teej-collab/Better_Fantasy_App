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
}

/**
 * The TV's live line: one long-lived GET /tv/live (Server-Sent Events).
 * Reconnects on its own with backoff (2, 4, 8 … 60 s); `onConnected`
 * reports whether it's up so the screen can poll as a fallback when it isn't.
 */
object LiveFeed {
    suspend fun run(token: () -> String?, onConnected: (Boolean) -> Unit, onEvent: (LiveEvent) -> Unit) {
        var backoff = 2_000L
        while (coroutineContext.isActive) {
            val t = token() ?: return
            val ok = runCatching { listen(t, onConnected, onEvent) }.isSuccess
            onConnected(false)
            if (ok) backoff = 2_000L
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(60_000L)
        }
    }

    private suspend fun listen(token: String, onConnected: (Boolean) -> Unit, onEvent: (LiveEvent) -> Unit) =
        withContext(Dispatchers.IO) {
            val conn = URL(BuildConfig.API_BASE + "/tv/live").openConnection() as HttpURLConnection
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
                        when (j.optString("type")) {
                            "scores" -> onEvent(LiveEvent.Scores)
                            "touchdown" -> onEvent(
                                LiveEvent.Touchdown(
                                    playerName = j.optString("player_name"),
                                    position = j.optStringOrNull("position"),
                                    proTeam = j.optStringOrNull("pro_team"),
                                    teamName = j.optString("team_name"),
                                    pointsDelta = j.optDoubleOrNull("points_delta"),
                                ),
                            )
                        }
                    }
                }
            } finally {
                conn.disconnect()
            }
        }
}
