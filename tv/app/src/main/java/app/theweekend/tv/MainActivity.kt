package app.theweekend.tv

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/** The home screen (this activity is the TV's HOME), plus pairing and settings. */
class MainActivity : ComponentActivity() {
    private lateinit var store: Store

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        setContent {
            var screen by remember { mutableStateOf(if (store.token == null) "pair" else "home") }
            when (screen) {
                "pair" -> PairingScreen(onPaired = { token ->
                    store.token = token
                    startOverlay()
                    screen = "home"
                })
                "settings" -> {
                    BackHandler { screen = "home" }
                    SettingsScreen(
                        store,
                        onBack = { screen = "home" },
                        onForget = {
                            store.token = null
                            screen = "pair"
                        },
                    )
                }
                else -> {
                    // Home is home: Back has nowhere to go.
                    BackHandler {}
                    HomeScreen(store, onSignedOut = { screen = "pair" }, onOpenSettings = { screen = "settings" })
                }
            }
        }
        if (store.token != null) startOverlay()
    }

    private fun startOverlay() {
        runCatching { startForegroundService(Intent(this, OverlayService::class.java)) }
    }
}
