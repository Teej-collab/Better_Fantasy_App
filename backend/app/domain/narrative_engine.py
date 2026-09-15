"""
Weekly matchup write-ups — the app's only LLM-backed feature. Adapted
from Fantasy_Helper's bot/narrative_engine/ + discord_bot/embeds/
{preview,recap}_embed.py: same "copywriter, not analyst" principle
(the model only ever receives already-verified numbers pulled from
app/domain/matchup_context.py's assembled payload, never invents a
fact), same brutal/on-brand voice this league already has everywhere
else (Chug penalties, the Sweaty Parlay Rule, trash-talk chat) — but
describing the whole matchup (both teams), not a one-sided jab at
whoever lost, since this fills a page's narrative card rather than a
Discord roast field aimed at one person.

Two states:
  - "preview" — before the matchup has any real data (both scores
    still 0-0). Built from records, streaks, rivalry, and projections.
    Hype tone.
  - "recap" — only once every real NFL game in the matchup's own week
    has actually finished (_week_completion, below — the same
    is_week_final signal app/domain/chug_debt.py already relies on),
    NOT simply "scores are non-zero." Scores update live mid-slate on a
    real Sunday, and since a generated result is cached forever (see
    below), generating a "recap" while a game is still in progress
    would freeze an incomplete, wrong result into the cache
    permanently.

    2026-09-15 fix, real report: this used to key off league_state.
    current_week (the real NFL week rolling over) instead of checking
    real per-week completion directly — the assumption being that
    current_week reliably rolls over once a week is genuinely done.
    It doesn't: ESPN's own public scoreboard's week.number field kept
    reading Week 1 for a long stretch after every single Week 1 game
    had already gone Final, so the whole-week recap's eligibility gate
    never flipped and the button/schedule job both silently had
    nothing to generate. Checking the target week's own real game data
    directly sidesteps that other counter's own timing entirely.

Results are cached in matchup_narratives (migration 7a2c9e4b6f1d) —
Claude is called once per matchup per state, never once per page view.
get_or_generate_narrative returns None (no attempt to generate, no
error) whenever ANTHROPIC_API_KEY isn't set, so the feature degrades to
today's placeholder rather than erroring on every page load for every
visitor until a real key is supplied.
"""
from app.config import ANTHROPIC_API_KEY, DEFAULT_LEAGUE_ID
from app.domain import weekly_awards
from app.domain.team_profile import get_owner_badges
from app.providers.anthropic_narrative import MODEL, generate_narrative
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.queries import chug as chug_queries
from app.queries import league as league_queries
from app.queries import narrative as narrative_queries

# Tuned 2026-09-02 per the owner's direct feedback on the first real
# generated output: more shit-talking (not just "hyped"), a bit longer,
# and pulling from real career/league-wide context — not just this
# matchup's own two teams' current-season numbers. The "never invent a
# stat" discipline is unchanged and non-negotiable — every added fact
# category below (career titles/awards, current league rank, Jeffrey's
# Rule chug standing) is real, already-computed data, not new license
# to embellish.
PREVIEW_PROMPT = """You are the voice of a fantasy football league's website, hyping up an upcoming \
matchup between two teams — and you are NOT neutral. You are a professional shit-talker: needling, \
mocking, and roasting both sides using ONLY the real facts you're given (records, streaks, \
projections, career championships and awards, current league standing, Jeffrey's Rule chug debts, \
rivalry and all-time head-to-head history). Never invent a stat, a player, or an event not present \
in the data — every jab must be traceable to a specific fact you were handed.

Cover both teams, not just one — split the disrespect evenly unless the facts themselves clearly \
favor roasting one side harder (a lopsided record, a title drought, an active chug debt, a lousy \
league rank). Pull in real career and league-wide context, not just this season's record — a \
three-time champion and a team that's never won anything read completely differently, and the \
history should show. Tone: a hyped-up trash-talking hype man crossed with your most ruthless group \
chat friend — cocky, funny, a little unhinged, zero mercy. Four to six sentences. No hedging, no \
disclaimers, no "may the best team win" softening, no participation-trophy energy."""

RECAP_PROMPT = """You are the voice of a fantasy football league's website, writing up how a \
matchup actually played out — and you are NOT neutral. You are a professional shit-talker: roasting \
what actually happened using ONLY the real facts you're given (final scores, who over/under-\
performed their projection, bench mistakes, clutch or choke results, career championships and \
awards, current league standing, Jeffrey's Rule chug debts, all-time head-to-head history). Never \
invent a stat, a player, or an event not present in the data — every jab must be traceable to a \
specific fact you were handed.

Cover both teams: roast what the winner got right (backhandedly, if it was a squeaker), roast what \
the loser did wrong, and pull in real career and league-wide context where it makes the burn land \
harder — a three-time champion losing to a team that's never made the playoffs is a different story \
than two rebuilding teams trading punches. Tone: brutal, sharp, specific, genuinely funny — anchor \
every jab in an actual number or fact, never a generic "you're bad at this." Four to six sentences. \
No hedging, no disclaimers, no consolation-prize softening for the loser."""

# The whole-week counterparts to the two prompts above — one narrative
# tying every matchup plus the week's real awards together into a
# single story, instead of per-matchup blurbs sitting side by side.
# Same "professional shit-talker, never invent a fact" voice; longer
# (three to five short paragraphs, not 4-6 sentences) since it's
# covering a whole week, not one matchup — see generate_narrative's
# max_tokens override where these two are used.
WEEKLY_PREVIEW_PROMPT = """You are the voice of a fantasy football league's website, hyping up the \
whole league's upcoming week — and you are NOT neutral. You are a professional shit-talker previewing \
every real matchup using ONLY the facts you're given (every matchup's two teams and records, current \
league standings, and real league-wide context like Jeffrey's Rule chug debts). Never invent a stat, \
a player, or an event not present in the data — every line must be traceable to a specific fact you \
were handed.

Cover the week as one story, not a boring list: open by setting the stakes for the week ahead, call \
out the matchup that matters most and why, needle the teams sitting worst in the standings, and close \
by building real anticipation for what's coming. Roast freely — nobody is off-limits, everybody's real \
numbers are fair game. Tone: a hyped-up trash-talking hype man crossed with your most ruthless group \
chat friend — cocky, funny, a little unhinged, zero mercy. Three to five short paragraphs. No hedging, \
no disclaimers, no participation-trophy energy."""

WEEKLY_RECAP_PROMPT = """You are the voice of a fantasy football league's website, writing the weekly \
recap column for the whole league — and you are NOT neutral. You are a professional shit-talker \
covering every real result from the week using ONLY the facts you're given (every matchup's final \
score and winner, the week's real awards — overachiever, meltdown, clutch or choke performance, \
biggest bench crime, boom/bust standouts, Game of the Week — current league standings, and real \
league-wide context like Jeffrey's Rule chug debts). Never invent a stat, a player, or an event not \
present in the data — every line must be traceable to a specific fact you were handed.

Cover the week as one story, not a boring list: open with the week's headline moment, move through \
the results that matter (upsets, blowouts, the closest game), call out the real award-winners by \
name, and close by setting up where the league actually stands now. Roast freely — nobody is \
off-limits, everybody's real numbers are fair game. Tone: brutal, sharp, genuinely funny, like a beat \
writer with zero patience for anyone's excuses. Three to five short paragraphs. No hedging, no \
disclaimers, no "great week everyone" softening."""

# 2026-09-15 fix, real report: a full week's recap for a real
# 12-team league (every matchup's result, every award, standings, AND
# Jeffrey's Rule chug debts, all as one continuous story) genuinely
# needs more room than 900 tokens gives it — confirmed live, a real
# generated recap cut off mid-sentence partway through the standings/
# chug-debt closing paragraph. Anthropic's response is returned as-is
# whatever it managed to generate before hitting the cap, with nothing
# to signal the cutoff, so this silently shipped a broken-looking recap
# rather than an error. Raised with real headroom rather than nudged
# just past this one observed case.
WEEKLY_MAX_TOKENS = 1600


def _fmt_boom_bust(roster: list[dict]) -> tuple[list[str], list[str]]:
    boom = [p["player_name"] for p in roster if p.get("is_boom")]
    bust = [p["player_name"] for p in roster if p.get("is_bust")]
    return boom, bust


def _side_facts(side: dict, include_result: bool) -> list[str]:
    facts = [f"{side['team_name']} (owner {side['owner_name']}), season record {side['record'] or '0-0'}"]

    if side["streak"] != "neutral":
        facts.append(f"{side['team_name']} is on a {side['streak']} streak")

    if side["projected_total"] is not None:
        facts.append(f"{side['team_name']}'s projected total: {side['projected_total']}")

    if include_result:
        if side["score"] is not None:
            facts.append(f"{side['team_name']} scored {side['score']}")

        if side["clutch_choke"]:
            facts.append(
                f"{side['team_name']} was {side['clutch_choke']['label']} this week: {side['clutch_choke']['reason']}"
            )

        if side["bench_crime"]:
            bc = side["bench_crime"]
            facts.append(
                f"{side['team_name']} benched {bc['bench_player']}, who outscored started player "
                f"{bc['started_player']} by {bc['points_diff']} points ({bc['severity']})"
            )

        boom, bust = _fmt_boom_bust(side["roster"])
        if boom:
            facts.append(f"{side['team_name']}'s standout performers: {', '.join(boom)}")
        if bust:
            facts.append(f"{side['team_name']}'s disappointing performers: {', '.join(bust)}")

    return facts


async def _career_and_live_facts(
    conn, side: dict, league_id: int, rank_by_team: dict[int, int], team_count: int
) -> list[str]:
    """Career history + right-now league context for one side — added
    2026-09-02 per the owner's own ask ("pull from all historical data,
    as well as what is live happening in the league now"), not just
    this matchup's own two teams' current-season numbers. Every fact
    here is real, already-computed data (season_champions/season_awards,
    chug_standing, get_standings' own rank order) — an absence (never
    won a title, no chug debt) is included as a real fact too, since
    that's genuine, verified material worth roasting on its own."""
    facts: list[str] = []

    badges = await get_owner_badges(conn, side["owner_id"], league_id)
    if badges["championship_years"]:
        years = ", ".join(str(y) for y in badges["championship_years"])
        facts.append(f"{side['team_name']}'s owner has won the league championship in: {years}")
    else:
        facts.append(f"{side['team_name']}'s owner has never won a league championship")
    if badges["award_summary"]:
        award_bits = [f"{award} x{len(seasons)}" for award, seasons in badges["award_summary"].items()]
        facts.append(f"{side['team_name']}'s owner's career awards: {', '.join(award_bits)}")

    rank = rank_by_team.get(side["team_id"])
    if rank is not None:
        facts.append(f"{side['team_name']} is currently ranked {rank} of {team_count} in the league right now")

    return facts


def _chug_fact(side: dict, chug_by_owner: dict) -> str | None:
    chug = chug_by_owner.get(side["owner_id"])
    if chug is None:
        return None
    owed = float(chug["outstanding_owed"] or 0) + float(chug["fined_owed"] or 0)
    if owed > 0:
        return f"{side['team_name']}'s owner currently owes {owed:g} under Jeffrey's Rule this season"
    return f"{side['team_name']}'s owner has a clean Jeffrey's Rule chug record this season"


async def _build_facts(conn, matchup: dict, kind: str) -> str:
    include_result = kind == "recap"
    league_id = matchup.get("league_id") or DEFAULT_LEAGUE_ID
    season = matchup["season"]

    facts: list[str] = []
    facts += _side_facts(matchup["home"], include_result)
    facts += _side_facts(matchup["away"], include_result)

    # Right-now league context: current standings rank (not just each
    # side's own record) and Jeffrey's Rule chug standing — both
    # genuinely live, not season-long-static, facts.
    standings = await league_queries.get_standings(conn, season, league_id)
    rank_by_team = {row["team_id"]: i + 1 for i, row in enumerate(standings)}
    team_count = len(standings)
    chug_by_owner = await chug_queries.get_chug_standing_by_owner(conn, season, league_id)

    for side in (matchup["home"], matchup["away"]):
        facts += await _career_and_live_facts(conn, side, league_id, rank_by_team, team_count)
        chug_fact = _chug_fact(side, chug_by_owner)
        if chug_fact:
            facts.append(chug_fact)

    h2h = matchup["head_to_head"]
    total_h2h = h2h["wins_home"] + h2h["wins_away"] + h2h["ties"]
    if total_h2h > 0:
        meeting = (
            f"All-time head-to-head: {matchup['home']['team_name']} {h2h['wins_home']} - "
            f"{h2h['wins_away']} {matchup['away']['team_name']}"
        )
        if h2h["last_season"] is not None:
            meeting += f", last met {h2h['last_season']} Wk {h2h['last_week']}"
        facts.append(meeting)
    else:
        facts.append("This is the first-ever meeting between these two teams.")

    if matchup["rivalry"]:
        r = matchup["rivalry"]
        tagline = f": {r['description']}" if r["description"] else ""
        facts.append(f"This is the '{r['name']}' rivalry ({r['tier']} tier){tagline}")

    if matchup["is_playoff"]:
        facts.append("This is a playoff matchup.")
    if matchup["is_game_of_the_week"]:
        facts.append("This is the league's Game of the Week.")

    return "; ".join(facts)


async def _week_completion(season: int, week: int) -> str:
    """The real "has this NFL week even started / is it over" signal —
    same is_week_final games check app/domain/chug_debt.py's own
    compute_chug_debts_for_week already relies on, hitting ESPN's free,
    public, keyless scoreboard endpoint directly rather than reading
    league_state.current_week's own separately-cached rollover (see
    this module's own docstring for why that rollover isn't a reliable
    proxy for real completion). Returns "final" (every real game for
    the week is done), "not_started" (every real game is still
    pre-kickoff, or there's no real schedule data at all yet), or
    "in_progress" (anything else — a real mid-slate)."""
    games = await get_week_scoreboard(week=week, year=season)
    if not games:
        return "not_started"
    if all(g.get("completed") for g in games):
        return "final"
    if all(g.get("state") == "pre" for g in games):
        return "not_started"
    return "in_progress"


async def _resolve_kind(matchup: dict) -> str | None:
    completion = await _week_completion(matchup["season"], matchup["week"])
    if completion == "final":
        return "recap"
    home_score = matchup["home"]["score"]
    away_score = matchup["away"]["score"]
    if home_score == 0 and away_score == 0:
        return "preview"
    return None  # matchup is mid-week/in-progress — no eligible state yet


async def get_cached_narrative(conn, matchup: dict) -> str | None:
    """Cache read only, never generates — used by build_week_matchup_
    context, which assembles up to a whole league's worth of matchups
    (~7 for a 14-team league) in one call. Triggering a live Claude
    call per matchup there would mean up to 7 sequential API calls on
    the very first visit to a week's page, which is real, bad latency.
    Once get_or_generate_narrative (below) has been called for a given
    matchup via the detail page, this starts picking it up for free."""
    kind = await _resolve_kind(matchup)
    if kind is None:
        return None
    return await narrative_queries.get_cached_narrative(conn, matchup["matchup_id"], kind)


async def get_or_generate_narrative(conn, matchup: dict) -> str | None:
    """Cache read + generate-on-miss — used by build_matchup_detail,
    which only ever handles one matchup per call, so one possible
    Claude call per request is an acceptable, bounded cost. `matchup`
    is the exact dict app/domain/matchup_context.py's _matchup_entry
    already built — reused directly, nothing is re-fetched here.
    Returns None (never raises) whenever there's nothing eligible to
    generate yet, or no real API key is configured."""
    kind = await _resolve_kind(matchup)
    if kind is None:
        return None

    cached = await narrative_queries.get_cached_narrative(conn, matchup["matchup_id"], kind)
    if cached is not None:
        return cached

    if not ANTHROPIC_API_KEY:
        return None

    system_prompt = RECAP_PROMPT if kind == "recap" else PREVIEW_PROMPT
    facts = await _build_facts(conn, matchup, kind)
    text = generate_narrative(system_prompt, facts)
    await narrative_queries.save_narrative(conn, matchup["matchup_id"], kind, text, MODEL)
    return text


async def _resolve_weekly_kind(season: int, week: int) -> str | None:
    """Week-scoped counterpart to _resolve_kind above — real completion
    of THIS week's own games decides recap/preview/still-live, same as
    _resolve_kind, just without a per-matchup score pair to lean on."""
    completion = await _week_completion(season, week)
    if completion == "final":
        return "recap"
    if completion == "not_started":
        return "preview"
    return None  # in progress


def _standings_record_str(row) -> str:
    return f"{row['wins']}-{row['losses']}" + (f"-{row['ties']}" if row["ties"] else "")


async def _build_weekly_facts(conn, week_context: dict, league_id: int, kind: str) -> str:
    """Same "real, already-computed data only" discipline as _build_facts
    above, just assembled from a whole week's worth of matchups
    (week_context, as already returned by matchup_context.
    build_week_matchup_context — passed in rather than re-fetched here,
    since generate_weekly_recap below already has it on hand) plus the
    week's real awards from weekly_awards.py for a recap, or just each
    game's pairing/records for a preview."""
    season, week = week_context["season"], week_context["week"]
    gow_matchup_id = week_context["game_of_the_week_matchup_id"]
    matchups = week_context["matchups"]

    # Stated explicitly rather than left for the model to infer — an
    # early-season week with few results otherwise reads exactly like
    # Week 1 to the model, and it has no other way to know which real
    # week this is (2026-09-03 live check caught it guessing "Week 1"
    # for a real Week 5 recap).
    facts: list[str] = [
        f"This is {'the recap for' if kind == 'recap' else 'the preview for'} {season} Week {week}."
    ]
    for m in matchups:
        home, away = m["home"], m["away"]
        tag = " (Game of the Week)" if m["matchup_id"] == gow_matchup_id else ""
        if kind == "recap" and home["score"] is not None and away["score"] is not None:
            if home["score"] == away["score"]:
                facts.append(f"{home['team_name']} tied {away['team_name']} {home['score']}-{away['score']}{tag}")
            else:
                winner, loser = (home, away) if home["score"] > away["score"] else (away, home)
                facts.append(f"{winner['team_name']} defeated {loser['team_name']} {winner['score']}-{loser['score']}{tag}")
        else:
            facts.append(
                f"{home['team_name']} ({home['record'] or '0-0'}) vs "
                f"{away['team_name']} ({away['record'] or '0-0'}){tag}"
            )

    if kind == "recap":
        overachiever, meltdown = await weekly_awards.get_overachiever_and_meltdown(conn, season, week, league_id)
        if overachiever:
            facts.append(
                f"Overachiever of the week: {overachiever['team_name']} beat their projection by "
                f"{overachiever['diff']:.1f} points"
            )
        if meltdown:
            facts.append(
                f"Meltdown of the week: {meltdown['team_name']} missed their projection by "
                f"{abs(meltdown['diff']):.1f} points"
            )

        bench_crime = await weekly_awards.get_biggest_bench_crime(conn, season, week, league_id)
        if bench_crime:
            facts.append(
                f"Biggest bench crime: {bench_crime['team_name']} benched {bench_crime['bench_player']}, who "
                f"outscored started player {bench_crime['started_player']} by {bench_crime['points_diff']} points"
            )

        clutch, choke = await weekly_awards.get_clutch_choke_of_week(conn, season, week, league_id)
        if clutch:
            facts.append(f"Clutch performance of the week: {clutch['team_name']} ({clutch['reason']})")
        if choke:
            facts.append(f"Choke of the week: {choke['team_name']} ({choke['reason']})")

        booms, busts = await weekly_awards.get_boom_bust_leaders(conn, season, week, limit=3, league_id=league_id)
        if booms:
            facts.append(
                "Boom performances: "
                + ", ".join(f"{b['player_name']} ({b['team_name']}, {b['points_scored']} pts)" for b in booms)
            )
        if busts:
            facts.append(
                "Bust performances: "
                + ", ".join(f"{b['player_name']} ({b['team_name']}, {b['points_scored']} pts)" for b in busts)
            )

        gow_matchup = next((m for m in matchups if m["matchup_id"] == gow_matchup_id), None)
        if gow_matchup:
            gow_result = await weekly_awards.get_game_of_week_result(
                conn, season, week,
                {"home_team_id": gow_matchup["home"]["team_id"], "away_team_id": gow_matchup["away"]["team_id"]},
                league_id,
            )
            if gow_result:
                facts.append(f"Game of the Week result: {gow_result['winner']} won {gow_result['score']}")

    # Right-now league context, same as _build_facts: current standings
    # (leader + last place) and real Jeffrey's Rule chug debts — applies
    # to both preview and recap.
    standings = await league_queries.get_standings(conn, season, league_id)
    if standings:
        leader = standings[0]
        facts.append(f"League leader right now: {leader['team_name']} ({_standings_record_str(leader)})")
        trailer = standings[-1]
        if trailer["team_id"] != leader["team_id"]:
            facts.append(f"Currently in last place: {trailer['team_name']} ({_standings_record_str(trailer)})")

    chug_by_owner = await chug_queries.get_chug_standing_by_owner(conn, season, league_id)
    if chug_by_owner:
        team_name_by_owner: dict[int, str] = {}
        for m in matchups:
            team_name_by_owner[m["home"]["owner_id"]] = m["home"]["team_name"]
            team_name_by_owner[m["away"]["owner_id"]] = m["away"]["team_name"]
        for owner_id, chug in chug_by_owner.items():
            team_name = team_name_by_owner.get(owner_id)
            if team_name is None:
                continue
            owed = float(chug["outstanding_owed"] or 0) + float(chug["fined_owed"] or 0)
            if owed > 0:
                facts.append(f"{team_name}'s owner currently owes {owed:g} under Jeffrey's Rule this season")

    return "; ".join(facts)


async def get_cached_weekly_narrative(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict | None:
    """Cache read only, never generates — used by the week page's normal
    load, same reasoning as get_cached_narrative above (a whole-week
    narrative is an even bigger single call; it must never fire on a
    plain page view). Returns {"text", "kind"} (kind is "preview" or
    "recap", so the page can label it "Week N Recap" vs "Week N
    Preview") or None if nothing's eligible/cached yet."""
    kind = await _resolve_weekly_kind(season, week)
    if kind is None:
        return None
    text = await narrative_queries.get_cached_weekly_narrative(conn, season, week, league_id, kind)
    if text is None:
        return None
    return {"text": text, "kind": kind}


async def generate_weekly_recap(
    conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID, force: bool = False
) -> dict:
    """The bulk, commissioner-triggered action described in this
    module's own plan: fills in every real matchup's own narrative for
    the week (skipping whatever's already cached, via the existing
    get_or_generate_narrative) and then generates/caches the new
    whole-week narrative tying it all together. Returns everything
    generated so the caller can render immediately rather than having
    to re-fetch. Degrades the same way get_or_generate_narrative does —
    no ANTHROPIC_API_KEY means the per-matchup fills still happen if
    already cached, but nothing new is generated, and weekly_narrative
    comes back None rather than erroring.

    2026-09-15 fix, real report: the "Regenerate" button (WeekRecapSection.
    tsx relabels itself once a narrative already exists) was always a
    no-op regardless of what it said — this read the cache first and
    only ever called the LLM on a genuine cache miss, so re-clicking it
    on an already-cached recap (including one that shipped truncated by
    hitting WEEKLY_MAX_TOKENS, the actual incident that surfaced this)
    could never do anything. `force=True` skips the cache read entirely
    so a real regeneration actually happens, still writing over the
    same cache row via save_weekly_narrative's own upsert."""
    from app.domain.matchup_context import build_week_matchup_context

    week_context = await build_week_matchup_context(conn, season, week, league_id)
    matchups = week_context["matchups"]
    if not matchups:
        return {"weekly_narrative": None, "matchup_narratives": {}, "status": "no_matchups"}

    matchup_narratives: dict[int, str] = {}
    for m in matchups:
        text = await get_or_generate_narrative(conn, m)
        if text is not None:
            matchup_narratives[m["matchup_id"]] = text

    # Reported back to the caller so a commissioner clicking "Generate"
    # on a week that's still live (kind is None — see _resolve_weekly_kind)
    # sees *why* nothing came back instead of the button silently
    # no-opping (2026-09-15: exactly this — commissioner hit the button
    # on a week whose games had already gone final, but the real NFL
    # week hadn't rolled over yet, and got zero feedback; the eligibility
    # check itself no longer depends on that rollover at all — see
    # _resolve_weekly_kind's own docstring).
    weekly_narrative = None
    status = "not_eligible"
    kind = await _resolve_weekly_kind(season, week)
    if kind is not None:
        status = "not_configured"
        text = None if force else await narrative_queries.get_cached_weekly_narrative(conn, season, week, league_id, kind)
        if text is None and ANTHROPIC_API_KEY:
            system_prompt = WEEKLY_RECAP_PROMPT if kind == "recap" else WEEKLY_PREVIEW_PROMPT
            facts = await _build_weekly_facts(conn, week_context, league_id, kind)
            text = generate_narrative(system_prompt, facts, max_tokens=WEEKLY_MAX_TOKENS)
            await narrative_queries.save_weekly_narrative(conn, season, week, league_id, kind, text, MODEL)
        if text is not None:
            weekly_narrative = {"text": text, "kind": kind}
            status = "generated"

    return {"weekly_narrative": weekly_narrative, "matchup_narratives": matchup_narratives, "status": status}
