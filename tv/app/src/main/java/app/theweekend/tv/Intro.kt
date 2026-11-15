package app.theweekend.tv

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.time.LocalDate

/** The Weekend's seasonal emblems, on the website's dates (frontend/src/lib/seasonal.ts). */
object Seasonal {
    private fun season(d: LocalDate = LocalDate.now()): String? {
        val md = d.monthValue * 100 + d.dayOfMonth
        return when {
            md in 1001..1101 -> "halloween"
            md >= 1201 || md <= 102 -> "winter"
            else -> null
        }
    }

    fun emblem(): Int = when (season()) {
        "halloween" -> R.drawable.intro_emblem_halloween
        "winter" -> R.drawable.intro_emblem_winter
        else -> R.drawable.intro_emblem
    }

    /** The same emblem with its lit cell empty; the intro pours it in. */
    fun pour(): Int = when (season()) {
        "halloween" -> R.drawable.intro_pour_halloween
        "winter" -> R.drawable.intro_pour_winter
        else -> R.drawable.intro_pour
    }
}

/**
 * The intro's three sounds, the website's (frontend/public/audio): a
 * light-switch click per word, the can opening, the pour. Loaded once when
 * the app starts so the first click isn't late.
 */
class IntroSounds(context: Context) {
    private val pool = SoundPool.Builder()
        .setMaxStreams(3)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        .build()
    private val loaded = mutableSetOf<Int>()
    private val click = pool.load(context, R.raw.light_switch, 1)
    private val can = pool.load(context, R.raw.can_opening, 1)
    private val pour = pool.load(context, R.raw.intro_pour, 1)

    init {
        pool.setOnLoadCompleteListener { _, id, status -> if (status == 0) synchronized(loaded) { loaded.add(id) } }
    }

    /** Waits (briefly) for the sounds on a cold start; the intro runs either way. */
    suspend fun ready() = withTimeoutOrNull(800) {
        while (synchronized(loaded) { loaded.size } < 3) delay(30)
    }

    fun click() = play(click, 0.8f)
    fun can() = play(can, 1f)
    fun pour() = play(pour, 0.9f)

    private fun play(id: Int, volume: Float) {
        if (synchronized(loaded) { id in loaded }) pool.play(id, volume, volume, 1, 0, 1f)
    }

    fun release() = pool.release()
}

/**
 * "Welcome back": the website's quick open, for when the TV wakes. WELCOME
 * and TO flicker on like stadium lights (a click each), the Hive Mark
 * flips in as the can cracks, its lit cell fills while the pour plays, and
 * "Welcome back, {name}" settles in before it fades into Home. About 3 s;
 * any button skips it (MainActivity). Everything moves on graphicsLayer, so
 * a frame is only ever a redraw of a few layers.
 */
@Composable
fun WelcomeIntro(name: String?, sounds: IntroSounds?, onFading: () -> Unit, onDone: () -> Unit) {
    val emblem = remember { Seasonal.emblem() }
    val pourArt = remember { Seasonal.pour() }
    val welcome = remember { Animatable(0f) }
    val to = remember { Animatable(0f) }
    val words = remember { Animatable(1f) }
    val flip = remember { Animatable(0f) }  // 0 = edge-on and small, 1 = facing you
    val fill = remember { Animatable(0f) }  // the lit cell pouring in
    val hello = remember { Animatable(0f) }
    val out = remember { Animatable(1f) }
    var showEmblem by remember { mutableStateOf(false) }

    // A neon tube catching: two quick flickers, then on.
    val flicker = keyframes<Float> {
        durationMillis = 260
        0f at 0; 0.9f at 40; 0.2f at 80; 1f at 130; 0.5f at 170; 1f at 260
    }

    LaunchedEffect(Unit) {
        sounds?.ready()
        coroutineScope {
            delay(150)
            sounds?.click()
            launch { welcome.animateTo(1f, flicker) }
            delay(550)
            sounds?.click()
            launch { to.animateTo(1f, flicker) }
            delay(550)
            // The words give way to the emblem, which flips in as the can opens.
            sounds?.can()
            launch { words.animateTo(0f, tween(220)) }
            showEmblem = true
            launch { flip.animateTo(1f, tween(650, easing = FastOutSlowInEasing)) }
            delay(380)
            sounds?.pour()
            launch { fill.animateTo(1f, tween(700)) }
            delay(300)
            launch { hello.animateTo(1f, tween(450)) }
            delay(1100)
            onFading()  // Home starts drawing underneath as this fades
            out.animateTo(0f, tween(380))
        }
        onDone()
    }

    Box(
        Modifier.fillMaxSize().graphicsLayer { alpha = out.value }.background(W.Night),
        contentAlignment = Alignment.Center,
    ) {
        // WELCOME / TO
        Column(
            Modifier.graphicsLayer { alpha = words.value },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BasicText("WELCOME", style = W.big(96, W.Neon), modifier = Modifier.graphicsLayer { alpha = welcome.value })
            BasicText("TO", style = W.big(64, W.Orange), modifier = Modifier.graphicsLayer { alpha = to.value })
        }
        if (showEmblem) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(250.dp).graphicsLayer {
                        // A coin toss: two and a half turns, landing face on.
                        val f = flip.value
                        rotationY = (1f - f) * 900f
                        scaleX = 0.55f + 0.45f * f
                        scaleY = 0.55f + 0.45f * f
                        alpha = (f * 3f).coerceAtMost(1f)
                        cameraDistance = 14f * density
                    },
                ) {
                    Image(painterResource(pourArt), null, Modifier.fillMaxSize())
                    Image(painterResource(emblem), "The Weekend", Modifier.fillMaxSize().graphicsLayer { alpha = fill.value })
                }
                Spacer(Modifier.height(18.dp))
                BasicText(
                    if (name.isNullOrBlank()) "Welcome back" else "Welcome back, ${name.substringBefore(' ')}",
                    style = W.body(30, W.Text, bold = true),
                    modifier = Modifier.graphicsLayer {
                        alpha = hello.value
                        translationY = (1f - hello.value) * 14.dp.toPx()
                    },
                )
            }
        }
    }
}
