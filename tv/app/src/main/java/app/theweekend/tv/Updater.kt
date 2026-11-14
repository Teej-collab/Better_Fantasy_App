package app.theweekend.tv

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** A newer build of The Weekend TV, published as a GitHub release tagged tv-v<versionCode>. */
data class Release(val versionCode: Int, val versionName: String, val apkUrl: String, val notes: String)

/**
 * Updates without the Mac: tv/scripts/release.sh publishes each build as a
 * GitHub release; the TV checks for a newer one, downloads it, and hands it
 * to Android's own installer, which asks "Update The Weekend?" — you press OK.
 * Same signing key every build, so your sign-in and settings carry over.
 */
object Updater {
    private const val RELEASES = "https://api.github.com/repos/Teej-collab/Better_Fantasy_App/releases?per_page=20"

    suspend fun latest(): Release? = withContext(Dispatchers.IO) {
        val conn = URL(RELEASES).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            if (conn.responseCode != 200) return@withContext null
            val releases = JSONArray(conn.inputStream.bufferedReader().use { it.readText() })
            (0 until releases.length()).asSequence()
                .mapNotNull { releases.optJSONObject(it) }
                .filter { !it.optBoolean("draft") && it.optString("tag_name").startsWith("tv-v") }
                .mapNotNull { r ->
                    val code = r.optString("tag_name").removePrefix("tv-v").toIntOrNull() ?: return@mapNotNull null
                    val assets = r.optJSONArray("assets") ?: return@mapNotNull null
                    val apk = (0 until assets.length()).mapNotNull { assets.optJSONObject(it) }
                        .firstOrNull { it.optString("name").endsWith(".apk") } ?: return@mapNotNull null
                    Release(code, r.optString("name").removePrefix("The Weekend TV "), apk.optString("browser_download_url"), r.optString("body"))
                }
                .maxByOrNull { it.versionCode }
                ?.takeIf { it.versionCode > BuildConfig.VERSION_CODE }
        } finally {
            conn.disconnect()
        }
    }

    /** Downloads the APK (reporting 0–100) and opens Android's update prompt. */
    suspend fun install(context: Context, release: Release, onProgress: (Int) -> Unit) = withContext(Dispatchers.IO) {
        val apk = File(context.cacheDir, "update.apk")
        var url = URL(release.apkUrl)
        var conn: HttpURLConnection
        // GitHub hands the file off to its download host; follow that by hand to be sure.
        while (true) {
            conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            if (conn.responseCode in 300..399) {
                url = URL(url, conn.getHeaderField("Location"))
                conn.disconnect()
            } else {
                break
            }
        }
        if (conn.responseCode != 200) throw ApiError(conn.responseCode, "Download failed")
        val total = conn.contentLengthLong
        conn.inputStream.use { input ->
            apk.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                var done = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    if (total > 0) onProgress((done * 100 / total).toInt())
                }
            }
        }
        conn.disconnect()

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("app.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val callback = PendingIntent.getBroadcast(
                context, id,
                Intent(context, InstallResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(callback.intentSender)
        }
    }
}

/** Shows Android's "Update The Weekend?" prompt when the installer asks for it. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
