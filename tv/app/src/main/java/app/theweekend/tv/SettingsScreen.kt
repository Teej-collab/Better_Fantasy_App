package app.theweekend.tv

import android.content.Context
import android.provider.Settings
import android.view.KeyEvent
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import android.content.SharedPreferences
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.type

/** What a remote button is called on the Chromecast remote, where we know it. */
fun buttonName(code: Int): String = when (code) {
    KeyEvent.KEYCODE_BUTTON_4 -> "Netflix button"
    else -> KeyEvent.keyCodeToString(code).removePrefix("KEYCODE_").replace('_', ' ').lowercase()
}

fun overlayAllowed(context: Context) = Settings.canDrawOverlays(context)

fun remoteServiceOn(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    return enabled.contains("${context.packageName}/") && enabled.contains("RemoteService")
}

/** Overlay, remote button, stream delays. Left/right changes a delay; OK toggles. */
@Composable
fun SettingsScreen(store: Store, apps: List<TvApp>, open: Boolean, onForget: () -> Unit) {
    val context = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }  // re-read the store after any change
    val first = remember { FocusRequester() }
    DisposableEffect(Unit) {
        val l = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> tick++ }
        store.listen(l)
        onDispose { store.unlisten(l) }
    }
    val gameApps = apps.mapNotNull { it.streamApp }.distinct()
    val scope = rememberCoroutineScope()
    var update by remember { mutableStateOf<Release?>(null) }
    var updateStatus by remember { mutableStateOf("Checking…") }
    // Kept built in the background (KeptTabs), so check each time it's opened.
    LaunchedEffect(open) {
        if (!open) return@LaunchedEffect
        update = runCatching { Updater.latest() }.getOrNull()
        updateStatus = if (update == null) "Up to date" else "Version ${update!!.versionName} · OK to install"
    }
    // The remote-button service learns the button in its own process; check back until it has.
    LaunchedEffect(store.learningHotkey, tick) {
        while (store.learningHotkey) {
            delay(400)
            tick++
        }
    }

    Column(Modifier.fillMaxSize()) {
        BasicText("Down to move through. OK switches a setting; left / right changes a delay.", style = W.body(13, W.Muted))
        Spacer(Modifier.height(10.dp))
        tick.let { _ ->
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.width(640.dp)) {
                item {
                    SettingRow(
                        label = "Score overlay",
                        value = if (store.overlayOn) "On" else "Off",
                        onClick = {
                            store.overlayOn = !store.overlayOn
                            tick++
                        },
                    )
                }
                item { SettingRow("Scoring pop-ups", if (store.popupsOn) "On" else "Off", onClick = { store.popupsOn = !store.popupsOn }) }
                item {
                    SettingRow(
                        "Overlay button",
                        when {
                            store.learningHotkey -> "Press the button you want…"
                            store.hotkey < 0 -> "Not set · OK to pick"
                            else -> buttonName(store.hotkey)
                        },
                        onClick = {
                            store.learningHotkey = true
                            tick++
                        },
                    )
                }
                gameApps.forEach { app ->
                    item {
                        SettingRow(
                            "Stream delay · ${app.label}",
                            "◀  ${store.delaySeconds(app)} s  ▶",
                            onClick = {},
                            onLeftRight = { dir -> store.setDelaySeconds(app, store.delaySeconds(app) + dir * 2) },
                        )
                    }
                }
                item {
                    SettingRow(
                        "Overlay permission",
                        if (overlayAllowed(context)) "Allowed" else "Not allowed yet (set up from the Mac)",
                        onClick = {},
                    )
                }
                item {
                    SettingRow(
                        "Remote button service",
                        if (remoteServiceOn(context)) "On" else "Off (set up from the Mac)",
                        onClick = {},
                    )
                }
                item { SettingRow("Welcome back intro", if (store.introOn) "When the TV wakes" else "Off", onClick = { store.introOn = !store.introOn }) }
                item { SettingRow("Intro sound", if (store.introSound) "On" else "Off", onClick = { store.introSound = !store.introSound }) }
                item {
                    SettingRow("Preview screensaver", "Any button closes it", onClick = {
                        context.startActivity(android.content.Intent(context, ScreensaverPreview::class.java))
                    })
                }
                item { SettingRow("Forget this TV's sign-in", "", onClick = onForget, danger = true) }
                item {
                    SettingRow("Updates", updateStatus, onClick = {
                        val r = update ?: return@SettingRow
                        scope.launch {
                            updateStatus = "Downloading…"
                            runCatching {
                                Updater.install(context, r) { pct -> updateStatus = "Downloading $pct%" }
                            }.onSuccess { updateStatus = "Confirm on screen" }
                                .onFailure { updateStatus = "Couldn't download · OK to retry" }
                        }
                    })
                }
                item { SettingRow("Version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", onClick = {}) }
            }
        }
    }
}

@Composable
private fun SettingRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    onLeftRight: ((Int) -> Unit)? = null,
    onClick: () -> Unit,
) {
    Focusable(
        modifier = modifier
            .fillMaxWidth()
            .height(44.dp)
            .onPreviewKeyEvent { e ->
                if (onLeftRight == null || e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.DirectionLeft -> { onLeftRight(-1); true }
                    Key.DirectionRight -> { onLeftRight(1); true }
                    else -> false
                }
            },
        onClick = onClick,
    ) { focused ->
        Row(Modifier.fillMaxSize().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            BasicText(label, style = W.body(17, if (focused) W.Night else if (danger) W.Orange else W.Text, bold = true))
            Spacer(Modifier.weight(1f))
            BasicText(value, style = W.body(15, if (focused) W.Night else W.Muted, bold = true))
        }
    }
}
