package app.theweekend.tv

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.ZoneId

/** One ticker entry: the main text, plus a quieter tail (clock, top scorer). */
private data class TickItem(val main: String, val tail: String, val live: Boolean = false, val mine: Boolean = false)

private const val FLIP_MS = 6_000L

/**
 * The home screen's tickers, like the website's: NFL scores on the left,
 * the league's matchups (with each side's top scorer) on the right.
 *
 * They flip to the next few every 6 s rather than scroll: a constant crawl
 * redraws the whole screen 60 times a second, which on the Chromecast
 * would bring back the lag on every remote press. The two halves flip 3 s
 * apart so the screen only ever moves a little at a time.
 */
@Composable
fun TickerBar(d: HomeData, modifier: Modifier = Modifier) {
    val zone = ZoneId.systemDefault()
    val nfl = d.games
        .sortedWith(compareBy({ if (it.live) 0 else if (it.state == "pre") 1 else 2 }, { it.kickoff }))
        .map { g ->
            when (g.state) {
                "pre" -> TickItem("${g.away} @ ${g.home}", g.kickoff?.atZone(zone)?.format(KICK).orEmpty())
                "post" -> TickItem("${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}", "Final")
                else -> TickItem("${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}", g.statusDetail.orEmpty(), live = true)
            }
        }
    val started = d.week?.started == true
    val league = d.matchups
        .sortedBy { if (it.id == d.myMatchupId) 0 else 1 }
        .map { m ->
            fun name(s: Side) = if (m.id == d.myMatchupId && s == d.mine(m)) "You" else short(s)
            fun pts(s: Side) = fmt(if (started) s.score else s.projected)
            // Each side's best starter so far: the website's ⭐ line.
            val best = listOf(m.home, m.away).flatMap { it.roster.filter { p -> p.starting } }
                .filter { (it.points ?: 0.0) > 0 }.maxByOrNull { it.points!! }
            // You first in yours.
            val (a, b) = if (m.id == d.myMatchupId) d.mine(m) to d.theirs(m) else m.away to m.home
            TickItem(
                "${name(a)} ${pts(a)} · ${name(b)} ${pts(b)}",
                if (!started) "proj" else best?.let { "★ ${it.name.substringAfterLast(' ')} ${fmt(it.points)}" }.orEmpty(),
                mine = m.id == d.myMatchupId,
            )
        }
    if (nfl.isEmpty() && league.isEmpty()) return
    Row(
        modifier.fillMaxWidth().height(32.dp).background(W.Surface, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (nfl.isNotEmpty()) {
            SectionLabel("NFL", W.Neon)
            Spacer(Modifier.width(12.dp))
            Pages(nfl, perPage = 2, offsetMs = 0, modifier = Modifier.weight(0.9f))
        }
        if (nfl.isNotEmpty() && league.isNotEmpty()) {
            Box(Modifier.padding(horizontal = 12.dp).width(1.dp).fillMaxHeight().padding(vertical = 7.dp).background(W.Line))
        }
        if (league.isNotEmpty()) {
            SectionLabel("League", W.Orange)
            Spacer(Modifier.width(12.dp))
            Pages(league, perPage = 2, offsetMs = FLIP_MS / 2, modifier = Modifier.weight(1.2f))
        }
    }
}

@Composable
private fun Pages(items: List<TickItem>, perPage: Int, offsetMs: Long, modifier: Modifier) {
    val pages = items.chunked(perPage)
    var page by remember { mutableIntStateOf(0) }
    LaunchedEffect(pages.size) {
        if (pages.size < 2) return@LaunchedEffect
        delay(offsetMs)
        while (true) {
            delay(FLIP_MS)
            page = (page + 1) % pages.size
        }
    }
    AnimatedContent(
        targetState = page.coerceAtMost(pages.lastIndex),
        transitionSpec = {
            (slideInVertically(tween(320)) { it } + fadeIn(tween(320))) togetherWith
                (slideOutVertically(tween(320)) { -it } + fadeOut(tween(200)))
        },
        modifier = modifier,
        label = "ticker",
    ) { i ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.CenterVertically) {
            pages.getOrNull(i).orEmpty().forEach { t ->
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    // The matchup stays whole; the clock or top scorer gives way.
                    BasicText(t.main, style = W.body(12, if (t.mine) W.Orange else W.Text, bold = true), maxLines = 1, softWrap = false)
                    if (t.tail.isNotEmpty()) {
                        Spacer(Modifier.width(6.dp))
                        BasicText(t.tail, style = W.body(11, if (t.live) W.Neon else W.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    }
                }
            }
            repeat(perPage - pages.getOrNull(i).orEmpty().size) { Spacer(Modifier.weight(1f)) }
        }
    }
}
