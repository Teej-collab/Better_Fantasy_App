package app.theweekend.tv

import android.graphics.Bitmap
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * First run: show a code, wait for someone to type it at
 * <web>/tv, then keep the TV's own watch-only session
 * (backend app/routers/tv.py). No password ever touches the TV.
 */
@Composable
fun PairingScreen(onPaired: (String) -> Unit) {
    val context = LocalContext.current
    var code by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("Getting a code…") }
    var attempt by remember { mutableIntStateOf(0) }
    val deviceName = remember {
        Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
            ?: Build.MODEL
    }

    LaunchedEffect(attempt) {
        code = null
        val start = try {
            Api.post("/tv/pair/start", JSONObject().put("device_name", deviceName.take(60)), null)
        } catch (e: Exception) {
            status = "Can't reach The Weekend. Retrying…"
            delay(10_000)
            attempt++
            return@LaunchedEffect
        }
        code = start.getString("code")
        status = "Waiting for you to enter it…"
        val deviceCode = start.getString("device_code")
        val interval = start.optLong("interval", 5) * 1000
        val deadline = System.currentTimeMillis() + start.optLong("expires_in", 600) * 1000
        while (System.currentTimeMillis() < deadline) {
            delay(interval)
            try {
                val r = Api.post("/tv/pair/token", JSONObject().put("device_code", deviceCode), null)
                if (r.optString("status") == "ok") {
                    onPaired(r.getString("token"))
                    return@LaunchedEffect
                }
            } catch (e: ApiError) {
                break  // expired or already used: get a fresh code
            } catch (_: Exception) {
                // network blip: keep polling
            }
        }
        attempt++
    }

    Box(Modifier.fillMaxSize().background(W.Night).padding(horizontal = 72.dp, vertical = 48.dp)) {
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(end = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Image(painterResource(R.drawable.emblem), contentDescription = "The Weekend", modifier = Modifier.size(170.dp))
                BasicText("YOUR LEAGUE. YOUR BROADCAST. YOUR RULES.", style = W.label(W.Neon), maxLines = 1)
                Spacer(Modifier.height(8.dp))
                Step("1", "On your phone or computer, go to")
                BasicText(
                    BuildConfig.WEB_BASE.removePrefix("https://") + "/tv",
                    style = W.body(18, W.Neon, bold = true),
                    maxLines = 1,
                    modifier = Modifier.padding(start = 46.dp),
                )
                Step("2", "Type the code on the right and tap Connect")
                Step("3", "This screen goes live by itself")
            }
            Column(
                Modifier
                    .width(400.dp)
                    .background(W.Surface, RoundedCornerShape(24.dp))
                    .border(1.dp, W.Line, RoundedCornerShape(24.dp))
                    .padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                BasicText("YOUR CODE", style = W.label())
                val c = code
                BasicText(
                    if (c == null) "· · · ·" else "${c.take(4)}-${c.drop(4)}",
                    style = W.big(60),
                )
                if (c != null) {
                    // Scanning opens Connect a TV with this code filled in: the
                    // iPhone app if it's installed, else the website.
                    val qr = remember(c) { qrBitmap("${BuildConfig.WEB_BASE}/tv?c=$c", 512) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            qr, "QR code to connect this TV",
                            Modifier.size(132.dp).background(Color.White, RoundedCornerShape(10.dp)).padding(8.dp),
                        )
                        Spacer(Modifier.width(16.dp))
                        BasicText("Or scan with your phone's camera", style = W.body(15, W.Muted))
                    }
                }
                BasicText(status, style = W.body(16, W.Muted))
                BasicText("No passwords on the TV. Disconnect it from the website anytime.", style = W.body(13, W.Dim))
            }
        }
    }
}

/** A QR code as a bitmap: black modules on white, with the standard quiet zone. */
private fun qrBitmap(text: String, size: Int): ImageBitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
    val pixels = IntArray(size * size) { i -> if (matrix[i % size, i / size]) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888).asImageBitmap()
}

@Composable
private fun Step(n: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(32.dp).border(2.dp, W.Neon, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) { BasicText(n, style = W.body(15, W.Neon, bold = true)) }
        Spacer(Modifier.width(14.dp))
        BasicText(text, style = W.body(17))
    }
}
