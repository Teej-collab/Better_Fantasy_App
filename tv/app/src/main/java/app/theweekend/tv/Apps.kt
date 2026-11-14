package app.theweekend.tv

import android.content.Context
import android.content.Intent
import android.graphics.drawable.Drawable
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap

/** An app installed on the TV, for the home screen's app row. */
data class TvApp(val label: String, val packageName: String, val banner: ImageBitmap?) {
    val streamApp: StreamApp? get() = StreamApp.entries.firstOrNull { label.lowercase().contains(it.nameHint) }
}

object Apps {
    fun installed(context: Context): List<TvApp> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .filter { it.activityInfo.packageName != context.packageName }
            .distinctBy { it.activityInfo.packageName }
            .map { info ->
                val ai = info.activityInfo
                val art: Drawable? = ai.loadBanner(pm) ?: ai.applicationInfo.loadBanner(pm)
                TvApp(
                    label = info.loadLabel(pm).toString(),
                    packageName = ai.packageName,
                    banner = art?.let { runCatching { it.toBitmap(320, 180).asImageBitmap() }.getOrNull() },
                )
            }
            // The game apps first, in the order games are usually on them; then A–Z.
            .sortedWith(compareBy<TvApp> { it.streamApp?.ordinal ?: Int.MAX_VALUE }.thenBy { it.label.lowercase() })
    }

    fun launch(context: Context, packageName: String): Boolean {
        val pm = context.packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(packageName) ?: pm.getLaunchIntentForPackage(packageName)
            ?: return false
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    fun find(apps: List<TvApp>, stream: StreamApp?): TvApp? = stream?.let { s -> apps.firstOrNull { it.streamApp == s } }
}
