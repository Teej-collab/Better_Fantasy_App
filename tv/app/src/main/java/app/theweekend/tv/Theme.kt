package app.theweekend.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The Weekend's look: night background, white type, neon green, one orange spark. */
fun TextStyle.end(): TextStyle = copy(textAlign = androidx.compose.ui.text.style.TextAlign.End)

object W {
    val Night = Color(0xFF0B0D12)
    val Surface = Color(0xFF12161D)
    val Raised = Color(0xFF1C222C)
    val Line = Color(0xFF232A35)
    val Text = Color.White
    val Muted = Color(0xFF9AA3B2)
    val Dim = Color(0xFF5C6575)
    val Neon = Color(0xFF39FF14)
    val Orange = Color(0xFFFF8A1F)
    val Stale = Color(0xFFFFB020)

    val Anton = FontFamily(Font(R.font.anton))
    val Inter = FontFamily(Font(R.font.inter_medium, FontWeight.Medium), Font(R.font.inter_bold, FontWeight.Bold))

    fun big(size: Int, color: Color = Text) = TextStyle(fontFamily = Anton, fontSize = size.sp, color = color)
    fun body(size: Int, color: Color = Text, bold: Boolean = false) = TextStyle(
        fontFamily = Inter, fontSize = size.sp, color = color,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
    )
    fun label(color: Color = Muted) = TextStyle(
        fontFamily = Inter, fontSize = 12.sp, color = color, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp,
    )
}

/**
 * Anything you can land on with the D-pad: white edge + green glow and a
 * small lift when focused, so there's never any doubt where you are.
 */
@Composable
fun Focusable(
    modifier: Modifier = Modifier,
    corner: Dp = 14.dp,
    background: Color = W.Surface,
    onFocus: (() -> Unit)? = null,
    onClick: () -> Unit,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(corner)
    Box(
        modifier
            .scale(if (focused) 1.04f else 1f)
            .then(if (focused) Modifier.shadow(18.dp, shape, ambientColor = W.Neon, spotColor = W.Neon) else Modifier)
            .background(if (focused) Color.White else background, shape)
            .border(if (focused) 2.dp else 1.dp, if (focused) W.Neon else if (background == Color.Transparent) Color.Transparent else W.Line, shape)
            .onFocusChanged {
                if (it.isFocused && !focused) onFocus?.invoke()
                focused = it.isFocused
            }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick),
    ) { content(focused) }
}
