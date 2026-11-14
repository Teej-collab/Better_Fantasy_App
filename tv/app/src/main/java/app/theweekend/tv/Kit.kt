@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package app.theweekend.tv

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.draw.scale
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The Weekend's room: night background, a faint honeycomb, and the neon
 * light pooling behind the top-left (brighter on game day).
 *
 * The honeycomb is painted once into a bitmap and then just blitted: the
 * Chromecast's GPU can't redraw hundreds of hex outlines every frame (that
 * made the remote feel like it skipped, since key presses queued up behind
 * slow frames).
 */
@Composable
fun HiveBackground(gameDay: Boolean, content: @Composable BoxScope.() -> Unit) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    val art = remember(size, gameDay) { if (size == IntSize.Zero) null else paintHive(size.width, size.height, gameDay) }
    Box(Modifier.fillMaxSize().background(W.Night).onSizeChanged { size = it }) {
        if (art != null) {
            Image(art, null, Modifier.fillMaxSize().graphicsLayer(), contentScale = ContentScale.FillBounds)
        }
        content()
    }
}

private fun paintHive(width: Int, height: Int, gameDay: Boolean): ImageBitmap {
    val bmp = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(bmp)
    val density = width / 960f
    val r = 46f * density
    val w = sqrt(3f) * r
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = 1f * density
    }
    var row = 0
    var y = 0f
    while (y < height + r) {
        var x = if (row % 2 == 0) 0f else w / 2
        while (x < width + w) {
            // Fades out away from the light, so it reads as texture, not wallpaper.
            val dx = x - width * 0.15f
            val d = sqrt(dx * dx + y * y) / width
            val a = (0.075f - d * 0.06f).coerceAtLeast(0.012f)
            paint.color = android.graphics.Color.argb((a * 255).toInt(), 57, 255, 20)
            val path = android.graphics.Path()
            for (i in 0 until 6) {
                val ang = Math.toRadians((60.0 * i) - 90.0)
                val px = x + r * 0.94f * cos(ang).toFloat()
                val py = y + r * 0.94f * sin(ang).toFloat()
                if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
            }
            path.close()
            c.drawPath(path, paint)
            x += w
        }
        y += r * 1.5f
        row++
    }
    val glow = android.graphics.Paint().apply {
        shader = android.graphics.RadialGradient(
            width * 0.12f, height * 0.05f, width * 0.55f,
            android.graphics.Color.argb(if (gameDay) 43 else 20, 57, 255, 20), android.graphics.Color.TRANSPARENT,
            android.graphics.Shader.TileMode.CLAMP,
        )
    }
    c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), glow)
    return bmp.asImageBitmap()
}

fun hexPath(c: Offset, r: Float): Path = Path().apply {
    for (i in 0 until 6) {
        val a = Math.toRadians((60.0 * i) - 90.0)
        val p = Offset(c.x + r * cos(a).toFloat(), c.y + r * sin(a).toFloat())
        if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
    }
    close()
}

/** A neon hex seed with a number in it: ranks, seeds. Orange for the one that's yours. */
@Composable
fun HexBadge(text: String, size: Dp = 34.dp, mine: Boolean = false) {
    val color = if (mine) W.Orange else W.Neon
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val path = hexPath(center, this.size.minDimension / 2 * 0.98f)
            drawPath(path, color.copy(alpha = 0.16f))
            drawPath(path, color, style = Stroke(width = 2.dp.toPx()))
        }
        BasicText(text, style = W.big((size.value * 0.42f).toInt(), if (mine) W.Orange else W.Text))
    }
}

private val logoCache = HashMap<String, ImageBitmap?>()

/** A team's logo, or its initials in a hex when there isn't one (or it won't load). */
@Composable
fun TeamLogo(url: String?, name: String, size: Dp, mine: Boolean = false) {
    var bmp by remember(url) { mutableStateOf(url?.let { logoCache[it] }) }
    LaunchedEffect(url) {
        if (url == null || logoCache.containsKey(url)) return@LaunchedEffect
        // Saved next to the API cache, so logos are there the instant the TV wakes too.
        val loaded = withContext(Dispatchers.IO) {
            runCatching {
                val file = Api.cacheDir?.let { java.io.File(it.parentFile, "logos/${url.hashCode().toUInt()}") }
                val bytes = file?.takeIf { it.exists() }?.readBytes()
                    ?: URL(url).openStream().use { it.readBytes() }.also { b -> file?.let { it.parentFile?.mkdirs(); it.writeBytes(b) } }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
        logoCache[url] = loaded
        bmp = loaded
    }
    val b = bmp
    if (b != null) {
        Image(
            b, name,
            Modifier.size(size).clip(RoundedCornerShape(size * 0.22f))
                .border(2.dp, if (mine) W.Orange else W.Line, RoundedCornerShape(size * 0.22f)),
            contentScale = ContentScale.Crop,
        )
    } else {
        val initials = name.split(' ', '-').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }
        HexBadge(initials.ifEmpty { "?" }, size, mine)
    }
}

/**
 * A dark glass card with a hairline edge; `lit` gives it the one neon edge a
 * screen gets. With `onClick` it's selectable: focus brightens the edge to
 * full neon and lifts it a touch, but keeps the dark face so the text reads.
 */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    lit: Boolean = false,
    padding: Dp = 18.dp,
    focusRequester: FocusRequester? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    var focused by remember { mutableStateOf(false) }
    val view = androidx.compose.ui.platform.LocalView.current
    val lift by androidx.compose.animation.core.animateFloatAsState(if (focused) 1.015f else 1f, androidx.compose.animation.core.tween(140), label = "lift")
    val selectable = if (onClick == null) Modifier else Modifier
        .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
        .onFocusChanged {
            if (it.isFocused && !focused) view.playSoundEffect(android.view.SoundEffectConstants.CLICK)
            focused = it.isFocused
        }
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
    Box(
        modifier
            .graphicsLayer { scaleX = lift; scaleY = lift }
            .then(selectable)
            .background(
                Brush.verticalGradient(
                    if (focused) listOf(Color(0xFF1B2330), Color(0xFF121820)) else listOf(Color(0xF0151A22), Color(0xF00E1117)),
                ),
                shape,
            )
            .border(
                if (focused) 3.dp else if (lit) 1.5.dp else 1.dp,
                if (focused) W.Neon else if (lit) W.Neon.copy(alpha = 0.7f) else W.Line,
                shape,
            )
            .padding(padding),
    ) { content() }
}

@Composable
fun Chip(text: String, fg: Color, bg: Color) {
    BasicText(
        text, style = W.label(fg),
        modifier = Modifier.background(bg, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

val TABS = listOf("home" to "Home", "matchup" to "Matchup", "league" to "League", "scores" to "Scores", "settings" to "Settings")

/**
 * The top menu. Resting on a tab opens it (the way TV apps work), so you
 * just slide left and right; Down drops into that screen. OK opens it at once.
 */
@Composable
fun NavBar(
    current: String,
    gameDay: Boolean,
    clock: String,
    onPick: (String) -> Unit,
    onHover: (String) -> Unit,
    firstTab: FocusRequester? = null,
    live: Boolean = false,
) {
    Row(Modifier.height(48.dp), verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.emblem), "The Weekend", Modifier.size(46.dp))
        Spacer(Modifier.width(10.dp))
        // Coming back up to the menu lands on the tab you're on, not whichever is above.
        Row(
            Modifier.focusProperties { if (firstTab != null) onEnter = { firstTab.requestFocus() } }.focusGroup(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TABS.forEachIndexed { i, (key, label) ->
                val on = key == current
                Focusable(
                    modifier = Modifier.height(34.dp).then(if (on && firstTab != null) Modifier.focusRequester(firstTab) else Modifier),
                    corner = 17.dp,
                    background = if (on) W.Raised else Color.Transparent,
                    onClick = { onPick(key) },
                    onFocus = { onHover(key) },
                ) { focused ->
                    BasicText(
                        label.uppercase(),
                        style = W.label(if (focused) W.Night else if (on) W.Text else W.Muted),
                        modifier = Modifier.align(Alignment.Center).padding(horizontal = 14.dp),
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        if (gameDay) {
            if (live) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(W.Neon))
                Spacer(Modifier.width(6.dp))
                BasicText("LIVE", style = W.label(W.Neon))
                Spacer(Modifier.width(12.dp))
            }
            Chip("GAME DAY", W.Night, W.Neon)
            Spacer(Modifier.width(12.dp))
        }
        BasicText(clock, style = W.body(16, W.Muted).end())
    }
}

/** Win-chance bar: always labeled an estimate. */
@Composable
fun WinBar(pct: Double?, modifier: Modifier = Modifier) {
    Box(modifier.height(8.dp).clip(CircleShape).background(W.Line)) {
        if (pct != null) {
            Box(
                Modifier.fillMaxHeight()
                    .fillMaxWidth((pct / 100).toFloat().coerceIn(0.02f, 1f))
                    .background(Brush.horizontalGradient(listOf(W.Neon.copy(alpha = 0.6f), W.Neon)), CircleShape),
            )
        }
    }
}

@Composable
fun SectionLabel(text: String, color: Color = W.Muted) {
    BasicText(text.uppercase(), style = W.label(color))
}

@Composable
fun Stack(gap: Dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(gap)) { content() }
}

/** A score that counts up (or down) to its new value instead of jumping. */
@Composable
fun AnimatedScore(value: Double?, style: androidx.compose.ui.text.TextStyle) {
    if (value == null) {
        BasicText("–", style = style)
        return
    }
    val shown by androidx.compose.animation.core.animateFloatAsState(
        value.toFloat(), androidx.compose.animation.core.tween(1200), label = "score",
    )
    BasicText(fmt(shown.toDouble()), style = style)
}

/**
 * The touchdown moment on the TV's own screens: whose player, how many
 * points, and whether it's yours (orange), your opponent's, or elsewhere
 * in the league. The overlay does the same over a streaming app.
 */
@Composable
fun TouchdownBanner(td: LiveEvent.Touchdown, d: HomeData?, modifier: Modifier = Modifier) {
    val w = d?.week
    val mine = w != null && td.teamName == w.teamName
    val theirs = w != null && td.teamName == w.oppTeamName
    val accent = if (mine) W.Orange else W.Neon
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .background(W.Night.copy(alpha = 0.96f), shape)
            .border(2.dp, accent, shape)
            .clip(shape),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.background(accent).padding(horizontal = 18.dp, vertical = 12.dp)) {
            BasicText("TOUCHDOWN", style = W.big(28, W.Night))
            BasicText(
                when { mine -> "YOUR PLAYER"; theirs -> "YOUR OPPONENT"; else -> "AROUND THE LEAGUE" },
                style = W.label(W.Night),
            )
        }
        Column(Modifier.padding(horizontal = 18.dp)) {
            BasicText(td.playerName, style = W.body(20, bold = true))
            BasicText(listOfNotNull(td.position, td.proTeam, td.teamName).joinToString(" · "), style = W.body(13, W.Muted))
        }
        td.pointsDelta?.let {
            BasicText("+" + String.format("%.1f", it), style = W.big(34, accent), modifier = Modifier.padding(end = 18.dp))
        }
    }
}
