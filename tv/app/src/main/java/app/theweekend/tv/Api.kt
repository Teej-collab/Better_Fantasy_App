package app.theweekend.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiError(val status: Int, message: String) : Exception(message)

/** The Weekend's backend. Plain HttpURLConnection + org.json: no extra libraries on a 2 GB box. */
object Api {
    private const val TIMEOUT_MS = 15_000

    suspend fun get(path: String, token: String?): JSONObject = request("GET", path, null, token)

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
                json
            } finally {
                conn.disconnect()
            }
        }
}
