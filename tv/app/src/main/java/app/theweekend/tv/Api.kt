package app.theweekend.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.security.MessageDigest
import java.net.URL

class ApiError(val status: Int, message: String) : Exception(message)

/** The Weekend's backend. Plain HttpURLConnection + org.json: no extra libraries on a 2 GB box. */
object Api {
    private const val TIMEOUT_MS = 15_000

    /**
     * Every good GET is also written here, so the home screen can show the
     * last known league the instant the TV wakes (no "Loading…"), then
     * refresh behind it. Set once at startup.
     */
    var cacheDir: File? = null

    private fun cacheFile(path: String): File? = cacheDir?.let { dir ->
        val name = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        File(dir, "$name.json")
    }

    /** The last good copy of a GET, or throws if there isn't one. */
    suspend fun cached(path: String): JSONObject = withContext(Dispatchers.IO) {
        val f = cacheFile(path)?.takeIf { it.exists() } ?: throw ApiError(0, "Not cached")
        JSONObject(f.readText())
    }

    /** When the cached copy of this GET was saved. */
    fun cachedAt(path: String): Long? = cacheFile(path)?.takeIf { it.exists() }?.lastModified()

    suspend fun get(path: String, token: String?, fromCache: Boolean = false): JSONObject =
        if (fromCache) cached(path) else request("GET", path, null, token)

    suspend fun post(path: String, body: JSONObject?, token: String?): JSONObject =
        request("POST", path, body, token)

    private suspend fun request(method: String, path: String, body: JSONObject?, token: String?): JSONObject =
        withContext(Dispatchers.IO) {
            val conn = URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = method
                conn.connectTimeout = TIMEOUT_MS
                conn.readTimeout = TIMEOUT_MS
                conn.setRequestProperty("Accept", "application/json")
                if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val json = if (text.isBlank()) JSONObject() else JSONObject(text)
                if (status !in 200..299) throw ApiError(status, json.optString("detail", "HTTP $status"))
                if (method == "GET") runCatching {
                    cacheFile(path)?.let { f ->
                        f.parentFile?.mkdirs()
                        val tmp = File(f.path + ".tmp")
                        tmp.writeText(text)
                        tmp.renameTo(f)
                    }
                }
                json
            } finally {
                conn.disconnect()
            }
        }
}
