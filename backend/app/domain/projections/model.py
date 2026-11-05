"""
This app's own projection model — a projected stat line per player for
one week, built the way the big sites build theirs:

1. Team volume. Each team's pass attempts, carries and targets per game
   (recent weeks count most, last season a little), moved by the Vegas
   line: favorites run more and throw less, a high total means more
   plays. The line's implied points set the team's scoring environment.
2. The player's share of that volume — targets, carries, dropbacks —
   from the games he played, recent ones weighted most. When teammates
   are out, their share goes to whoever's left (a backup back steps
   into the starter's carries); an out starting QB hands the job to the
   backup.
3. Efficiency — catch rate, yards per catch and carry, TD rates,
   completion %, interceptions — the player's own numbers pulled toward
   his position's average in proportion to how little he has shown
   (empirical Bayes; TDs pulled hardest, they're the noisiest). TD
   rates also follow the player's red-zone share.
4. The opponent: fantasy points it allows to the position against the
   league average, shrunk for a small sample.
5. Kickers from the team's implied points and the kicker's distance
   mix; a D/ST from the opponent's implied points, its own and the
   opponent's sack/turnover rates; an individual defender (IDP) from his
   own recent per-game tackles, sacks and so on, pulled toward his
   position group's average.

Everything averages out of history (nfl_player_weeks), so it re-fits
itself every week. The result is a stat line in this app's scoring
categories, plus "_why" (the inputs, for the player card) — never points:
each league scores it (scoring.py).
"""
from dataclasses import dataclass, field

from app.domain.roster_slots import fantasy_position
from app.providers.projection_feeds import team_code

HALF_LIFE_WEEKS = 4.0
PRIOR_SEASON_WEIGHT = 0.35
OTHER_TEAM_WEIGHT = 0.5
SKILL = ("QB", "RB", "WR", "TE")
IDP = ("DL", "LB", "DB")
_IDP_STATS = {"idp_tkl": "idp_tackle", "idp_sack": "idp_sack", "idp_int": "idp_int", "idp_pass_def": "idp_pass_def",
              "idp_tkl_loss": "idp_tfl", "idp_qb_hit": "idp_qb_hit", "idp_def_td": "idp_td"}

_OUT = {"Out", "IR", "PUP", "Suspended", "NFI", "COV", "Inactive"}
# Questionable players play most weeks; like ESPN and Sleeper the line
# assumes he plays, shaded a little for the chance he sits or is limited.
_PLAY_SHARE = {"Doubtful": 0.25, "Questionable": 0.96}

# Shrinkage strengths: how many attempts of league-average performance
# a player's own record is blended with.
_K = {
    "catch": 40, "ypr": 30, "ypc": 60, "rec_td": 100, "rush_td": 120,
    "cmp": 150, "ypcmp": 100, "pass_td": 300, "pass_int": 400, "rz": 25,
}


def _g(stats: dict, key: str) -> float:
    return float(stats.get(key) or 0.0)


@dataclass
class _Acc:
    """A weighted running sum."""
    w: float = 0.0
    sums: dict = field(default_factory=dict)

    def add(self, weight: float, values: dict) -> None:
        self.w += weight
        for k, v in values.items():
            if isinstance(v, (int, float)):
                self.sums[k] = self.sums.get(k, 0.0) + weight * v

    def mean(self, key: str, default: float = 0.0) -> float:
        return self.sums.get(key, 0.0) / self.w if self.w else default

    def total(self, key: str) -> float:
        return self.sums.get(key, 0.0)


def _clip(x: float, low: float, high: float) -> float:
    return max(low, min(high, x))


class ProjectionModel:
    def __init__(self, history: list[dict], season: int, week: int):
        """history: nfl_player_weeks rows {season, week, sleeper_player_id,
        position, team, opponent, stats} before (season, week)."""
        self.season, self.week = season, week
        rows = [r for r in history if (r["season"], r["week"]) < (season, week)]
        order = sorted({(r["season"], r["week"]) for r in rows})
        self._age = {sw: len(order) - 1 - i for i, sw in enumerate(order)}
        self.rows = rows
        self._build_teams()
        self._build_league()
        self._build_players()

    def _weight(self, season: int, week: int) -> float:
        w = 0.5 ** (self._age[(season, week)] / HALF_LIFE_WEEKS)
        return w if season == self.season else w * PRIOR_SEASON_WEIGHT

    # ---- teams --------------------------------------------------------

    def _build_teams(self) -> None:
        games: dict[tuple, dict] = {}
        for r in self.rows:
            team = team_code(r["team"])
            if not team:
                continue
            g = games.setdefault((r["season"], r["week"], team), {
                "pass_att": 0.0, "rush_att": 0.0, "tgt": 0.0, "fga": 0.0, "xpa": 0.0,
                "rz_rush": 0.0, "rz_tgt": 0.0,
            })
            s = r["stats"]
            if r["position"] == "DEF":
                # A D/ST row describes the OTHER team's offense too.
                opp = team_code(r["opponent"])
                og = games.setdefault((r["season"], r["week"], opp), {
                    "pass_att": 0.0, "rush_att": 0.0, "tgt": 0.0, "fga": 0.0, "xpa": 0.0,
                    "rz_rush": 0.0, "rz_tgt": 0.0,
                })
                og["points"] = _g(s, "pts_allow")
                og["yards"] = _g(s, "yds_allow")
                og["sacked"] = _g(s, "sack")
                og["int_thrown"] = _g(s, "int")
                og["fum_lost"] = _g(s, "fum_rec")
                g["def_sack"] = _g(s, "sack")
                g["def_int"] = _g(s, "int")
                g["def_fum_rec"] = _g(s, "fum_rec")
                g["def_td"] = _g(s, "def_td") + _g(s, "def_st_td")
                g["def_safety"] = _g(s, "safe")
                g["def_block"] = _g(s, "blk_kick")
                g["opp"] = opp
                for pos in ("qb", "rb", "wr", "te", "k"):
                    g[f"allow_{pos}"] = _g(s, f"fan_pts_allow_{pos}")
                continue
            g["pass_att"] += _g(s, "pass_att")
            g["rush_att"] += _g(s, "rush_att")
            g["tgt"] += _g(s, "rec_tgt")
            g["fga"] += _g(s, "fga")
            g["xpa"] += _g(s, "xpa")
            g["rz_rush"] += _g(s, "rush_rz_att")
            g["rz_tgt"] += _g(s, "rec_rz_tgt")
        self.team_games = games
        self.teams: dict[str, _Acc] = {}
        for (season, week, team), g in games.items():
            if g["pass_att"] + g["rush_att"] == 0:
                continue
            self.teams.setdefault(team, _Acc()).add(self._weight(season, week), g)

    # ---- league averages ---------------------------------------------

    def _build_league(self) -> None:
        tot: dict[str, dict[str, float]] = {}
        for r in self.rows:
            pos = r["position"]
            t = tot.setdefault(pos, {})
            for k, v in r["stats"].items():
                if isinstance(v, (int, float)):
                    t[k] = t.get(k, 0.0) + v
        self.lg_tot = tot

        def ratio(pos, num, den, default):
            t = tot.get(pos, {})
            return t.get(num, 0.0) / t[den] if t.get(den) else default

        self.lg = {}
        for pos in ("RB", "WR", "TE", "QB"):
            self.lg[pos] = {
                "catch": ratio(pos, "rec", "rec_tgt", 0.65),
                "ypr": ratio(pos, "rec_yd", "rec", 10.0),
                "ypc": ratio(pos, "rush_yd", "rush_att", 4.3),
                "rec_td": ratio(pos, "rec_td", "rec_tgt", 0.04),
                "rush_td": ratio(pos, "rush_td", "rush_att", 0.03),
                "rz_tgt": ratio(pos, "rec_rz_tgt", "rec_tgt", 0.1),
                "rz_rush": ratio(pos, "rush_rz_att", "rush_att", 0.12),
                "fum": (tot.get(pos, {}).get("fum_lost", 0.0) / ((tot.get(pos, {}).get("rush_att", 0.0) + tot.get(pos, {}).get("rec", 0.0)) or 1.0)) or 0.006,
                "long_rec_td": ratio(pos, "rec_td_40p", "rec_td", 0.12),
                "long_rush_td": ratio(pos, "rush_td_40p", "rush_td", 0.07),
            }
        self.lg["QB"].update({
            "cmp": ratio("QB", "pass_cmp", "pass_att", 0.645),
            "ypcmp": ratio("QB", "pass_yd", "pass_cmp", 10.9),
            "pass_td": ratio("QB", "pass_td", "pass_att", 0.045),
            "pass_int": ratio("QB", "pass_int", "pass_att", 0.023),
            "long_pass_td": ratio("QB", "pass_td_40p", "pass_td", 0.12),
            "two_pt": ratio("QB", "pass_2pt", "pass_td", 0.03),
        })
        k = tot.get("K", {})
        fgm = {b: k.get(f"fgm_{b}", 0.0) for b in ("0_19", "20_29", "30_39", "40_49", "50p")}
        miss = {b: k.get(f"fgmiss_{b}", 0.0) for b in ("0_19", "20_29", "30_39", "40_49", "50p")}
        att = {
            "short": fgm["0_19"] + fgm["20_29"] + fgm["30_39"] + miss["0_19"] + miss["20_29"] + miss["30_39"],
            "mid": fgm["40_49"] + miss["40_49"], "long": fgm["50p"] + miss["50p"],
        }
        made = {"short": fgm["0_19"] + fgm["20_29"] + fgm["30_39"], "mid": fgm["40_49"], "long": fgm["50p"]}
        total_att = sum(att.values()) or 1.0
        self.lg_kick = {
            "mix": {b: att[b] / total_att for b in att},
            "make": {b: (made[b] / att[b] if att[b] else d) for b, d in (("short", 0.93), ("mid", 0.82), ("long", 0.68))},
            "xp": k["xpm"] / k["xpa"] if k.get("xpa") else 0.95,
        }
        pts, xpa, n = 0.0, 0.0, 0
        allow = {p: [0.0, 0] for p in ("qb", "rb", "wr", "te", "k")}
        dst = {"def_sack": 0.0, "def_int": 0.0, "def_fum_rec": 0.0, "def_td": 0.0, "def_safety": 0.0,
               "def_block": 0.0, "yards": 0.0}
        for g in self.team_games.values():
            if "points" in g:
                pts += g["points"]
                xpa += g["xpa"]
                n += 1
                dst["yards"] += g.get("yards", 0.0)
            if "opp" in g:
                for p in allow:
                    allow[p][0] += g[f"allow_{p}"]
                    allow[p][1] += 1
                for key in ("def_sack", "def_int", "def_fum_rec", "def_td", "def_safety", "def_block"):
                    dst[key] += g.get(key, 0.0)
        self.lg_points = pts / n if n else 22.0
        self.lg_xpa_per_point = xpa / pts if pts else 0.11
        self.lg_allow = {p: (v[0] / v[1] if v[1] else 1.0) for p, v in allow.items()}
        self.lg_dst = {k: v / n if n else 0.0 for k, v in dst.items()}

    # ---- players -----------------------------------------------------

    def _build_players(self) -> None:
        self.players: dict[str, dict] = {}
        self.idp_avg: dict[str, _Acc] = {}
        for r in self.rows:
            group = fantasy_position(r["position"])
            if group not in (*SKILL, "K", *IDP):
                continue
            s = r["stats"]
            if group in IDP:
                if _g(s, "def_snp") <= 0:
                    continue
                self.idp_avg.setdefault(group, _Acc()).add(1.0, {k: _g(s, k) for k in _IDP_STATS})
            active = (_g(s, "off_snp") > 0 or _g(s, "def_snp") > 0
                      or any(_g(s, k) for k in ("pass_att", "rush_att", "rec_tgt", "fga", "xpa")))
            if not active:
                continue
            team = team_code(r["team"])
            g = self.team_games.get((r["season"], r["week"], team), {})
            share = {
                "tgt_share": _g(s, "rec_tgt") / g["tgt"] if g.get("tgt") else 0.0,
                "rush_share": _g(s, "rush_att") / g["rush_att"] if g.get("rush_att") else 0.0,
                "pass_share": _g(s, "pass_att") / g["pass_att"] if g.get("pass_att") else 0.0,
            }
            p = self.players.setdefault(r["sleeper_player_id"], {"games": []})
            p["games"].append((r["season"], r["week"], team, share, s))

    def _player_acc(self, pid: str, team: str) -> tuple[_Acc, _Acc]:
        """(shares, raw stat sums), recency-weighted."""
        shares, raw = _Acc(), _Acc()
        for season, week, game_team, share, s in self.players.get(pid, {}).get("games", []):
            w = self._weight(season, week) * (1.0 if game_team == team else OTHER_TEAM_WEIGHT)
            shares.add(w, share)
            raw.add(w, {k: float(v) for k, v in s.items() if isinstance(v, (int, float))})
        return shares, raw

    def _team_rate(self, team: str, key: str, default: float) -> float:
        acc = self.teams.get(team)
        return acc.mean(key, default) if acc else default

    def _team_points(self, team: str) -> float:
        acc = self.teams.get(team)
        if not acc:
            return self.lg_points
        return (acc.total("points") + 3 * self.lg_points) / (acc.w + 3)

    def _matchup(self, opp: str, pos: str) -> float:
        acc = self.teams.get(opp)
        if not acc or pos.lower() not in self.lg_allow:
            return 1.0
        ratio = acc.mean(f"allow_{pos.lower()}", self.lg_allow[pos.lower()]) / (self.lg_allow[pos.lower()] or 1.0)
        n = acc.w
        # Light: the Vegas line already prices the opponent's defense into
        # the team's points, so this only tilts WHICH position gets them.
        return _clip(1 + 0.35 * (ratio - 1) * n / (n + 4), 0.88, 1.12)

    # ---- the week ------------------------------------------------------

    def project(self, universe: dict[str, dict], lines: dict[str, dict]) -> dict[str, dict]:
        """universe: {pid: {position, team, injury_status}}; lines: Vegas
        {team: {opponent, spread, total, implied_points}}. Returns
        {pid: stat line}. A player on a bye or ruled out is left out."""
        by_team: dict[str, list[str]] = {}
        for pid, info in universe.items():
            team = team_code(info.get("team"))
            if team and team in lines and fantasy_position(info.get("position")) in (*SKILL, "K", "DEF", *IDP):
                by_team.setdefault(team, []).append(pid)

        out: dict[str, dict] = {}
        for team, pids in by_team.items():
            game = lines[team]
            opp = game["opponent"]
            fav = -float(game["spread"]) if game.get("spread") is not None else 0.0
            team_pts = self._team_points(team)
            implied = float(game.get("implied_points") or team_pts)
            env = _clip((implied / team_pts) ** 0.8, 0.72, 1.35) if team_pts else 1.0
            plays = 1 + 0.006 * (float(game.get("total") or 2 * self.lg_points) - 2 * self.lg_points)
            pass_att = self._team_rate(team, "pass_att", 33.0) * _clip(1 - 0.010 * fav, 0.85, 1.12) * plays
            rush_att = self._team_rate(team, "rush_att", 26.0) * _clip(1 + 0.015 * fav, 0.85, 1.2) * plays
            tgt_per_att = (self._team_rate(team, "tgt", 31.0) / self._team_rate(team, "pass_att", 33.0)) or 0.93
            team_tgt = pass_att * tgt_per_att
            context = {"team": team, "opp": opp, "implied": round(implied, 1), "env": round(env, 2),
                       "team_pass_att": round(pass_att, 1), "team_rush_att": round(rush_att, 1)}

            skill = {}
            for pid in pids:
                info = universe[pid]
                pos = info["position"]
                if pos not in SKILL or info.get("injury_status") in _OUT:
                    continue
                shares, raw = self._player_acc(pid, team)
                skill[pid] = (pos, shares, raw, _PLAY_SHARE.get(info.get("injury_status"), 1.0))
            # Shares still on the roster but ruled out this week go to
            # whoever's left, in proportion (capped so nobody doubles).
            out_shares = {"tgt_share": 0.0, "rush_share": 0.0}
            for pid in pids:
                info = universe[pid]
                if info.get("position") in SKILL and info.get("injury_status") in _OUT:
                    shares, _ = self._player_acc(pid, team)
                    if shares.w and self._recent(pid):
                        for k in out_shares:
                            out_shares[k] += shares.mean(k)
            scale = {}
            for k in out_shares:
                active = sum(v[1].mean(k) for v in skill.values() if v[0] != "QB" or k == "rush_share")
                scale[k] = _clip(1 + out_shares[k] / active, 1.0, 1.6) if active else 1.0

            starter = max(
                (pid for pid, v in skill.items() if v[0] == "QB"),
                key=lambda pid: (skill[pid][1].mean("pass_share") * (skill[pid][1].w > 0.05), skill[pid][1].w),
                default=None,
            )
            for pid, (pos, shares, raw, play) in skill.items():
                if pos == "QB" and pid != starter:
                    continue
                line = self._skill_line(pid, pos, shares, raw, team, opp, env, pass_att, rush_att, team_tgt, scale, play)
                line["_why"] = {**context, "matchup": round(self._matchup(opp, pos), 2), "play_share": play}
                out[pid] = line

            for pid in pids:
                info = universe[pid]
                if info.get("injury_status") in _OUT:
                    continue
                group = fantasy_position(info["position"])
                if group in IDP:
                    line = self._idp_line(pid, team, group, _PLAY_SHARE.get(info.get("injury_status"), 1.0))
                    if line:
                        out[pid] = line
                elif info["position"] == "K":
                    out[pid] = self._kicker_line(pid, team, implied, env, opp)
                elif info["position"] == "DEF":
                    out[pid] = self._defense_line(team, opp, lines)
        return out

    def _recent(self, pid: str) -> bool:
        games = self.players.get(pid, {}).get("games", [])
        return any(s == self.season and self._age[(s, w)] <= 6 for s, w, *_ in games)

    def _skill_line(self, pid, pos, shares, raw, team, opp, env, pass_att, rush_att, team_tgt, scale, play) -> dict:
        lg = self.lg[pos]
        # A player with almost no games (rookie, call-up) starts from a
        # small role, not the average starter's.
        prior_w = 0.3
        prior = {"QB": (0.0, 0.08, 0.05), "RB": (0.06, 0.15, 0.0), "WR": (0.08, 0.01, 0.0), "TE": (0.06, 0.0, 0.0)}[pos]
        tgt_share = (shares.total("tgt_share") + prior_w * prior[0]) / (shares.w + prior_w)
        rush_share = (shares.total("rush_share") + prior_w * prior[1]) / (shares.w + prior_w)
        tgt_share *= scale["tgt_share"] if pos != "QB" else 1.0
        rush_share *= scale["rush_share"]
        matchup = self._matchup(opp, pos)
        yard_adj = matchup * (1 + 0.3 * (env - 1))
        td_adj = (1 + 0.5 * (matchup - 1)) * env

        line: dict[str, float] = {}
        targets = tgt_share * team_tgt * play
        if targets > 0.05:
            catch = (raw.total("rec") + _K["catch"] * lg["catch"]) / (raw.total("rec_tgt") + _K["catch"])
            ypr = (raw.total("rec_yd") + _K["ypr"] * lg["ypr"]) / (raw.total("rec") + _K["ypr"])
            td_rate = (raw.total("rec_td") + _K["rec_td"] * lg["rec_td"]) / (raw.total("rec_tgt") + _K["rec_td"])
            rz = (raw.total("rec_rz_tgt") + _K["rz"] * lg["rz_tgt"]) / (raw.total("rec_tgt") + _K["rz"])
            td_rate *= _clip(0.5 + 0.5 * rz / (lg["rz_tgt"] or 0.1), 0.7, 1.5)
            line["_tgt"] = targets
            line["rec"] = targets * catch
            line["rec_yd"] = line["rec"] * ypr * yard_adj
            line["rec_td"] = targets * td_rate * td_adj
            line["rec_td_40"] = line["rec_td"] * lg["long_rec_td"]
        carries = rush_share * rush_att * play
        if carries > 0.05:
            ypc = (raw.total("rush_yd") + _K["ypc"] * lg["ypc"]) / (raw.total("rush_att") + _K["ypc"])
            td_rate = (raw.total("rush_td") + _K["rush_td"] * lg["rush_td"]) / (raw.total("rush_att") + _K["rush_td"])
            rz = (raw.total("rush_rz_att") + _K["rz"] * lg["rz_rush"]) / (raw.total("rush_att") + _K["rz"])
            td_rate *= _clip(0.5 + 0.5 * rz / (lg["rz_rush"] or 0.1), 0.7, 1.6)
            line["rush_att"] = carries
            line["rush_yd"] = carries * ypc * yard_adj
            line["rush_td"] = carries * td_rate * td_adj
            line["rush_td_40"] = line["rush_td"] * lg["long_rush_td"]
        touches = line.get("rush_att", 0.0) + line.get("rec", 0.0)
        if touches:
            line["fum_lost"] = touches * lg["fum"]
        if pos == "QB":
            attempts = 0.97 * pass_att * play
            cmp = (raw.total("pass_cmp") + _K["cmp"] * lg["cmp"]) / (raw.total("pass_att") + _K["cmp"])
            ypcmp = (raw.total("pass_yd") + _K["ypcmp"] * lg["ypcmp"]) / (raw.total("pass_cmp") + _K["ypcmp"])
            td_rate = (raw.total("pass_td") + _K["pass_td"] * lg["pass_td"]) / (raw.total("pass_att") + _K["pass_td"])
            int_rate = (raw.total("pass_int") + _K["pass_int"] * lg["pass_int"]) / (raw.total("pass_att") + _K["pass_int"])
            line["_pass_att"] = attempts
            line["pass_cmp"] = attempts * cmp
            line["pass_yd"] = line["pass_cmp"] * ypcmp * yard_adj
            line["pass_td"] = attempts * td_rate * td_adj
            line["pass_td_40"] = line["pass_td"] * lg["long_pass_td"]
            line["pass_int"] = attempts * int_rate / (1 + 0.3 * (env - 1))
            line["two_pt_pass"] = line["pass_td"] * lg["two_pt"]
        tds = line.get("rush_td", 0.0) + line.get("rec_td", 0.0)
        if pos != "QB" and tds:
            line["two_pt_rec" if pos in ("WR", "TE") else "two_pt_rush"] = tds * 0.03
        return {k: round(v, 3) for k, v in line.items()}

    def _idp_line(self, pid: str, team: str, group: str, play: float) -> dict | None:
        """Per-game averages over the games he played, pulled toward the
        group's average by 1.5 games' worth. A defender with no snaps on
        record gets nothing (most are deep backups)."""
        _, raw = self._player_acc(pid, team)
        if raw.w < 0.05:
            return None
        lg = self.idp_avg.get(group)
        line = {}
        for key, category in _IDP_STATS.items():
            league = lg.mean(key) if lg else 0.0
            value = (raw.total(key) + 1.5 * league) / (raw.w + 1.5) * play
            if value:
                line[category] = round(value, 3)
        return line or None

    def _kicker_line(self, pid: str, team: str, implied: float, env: float, opp: str) -> dict:
        _, raw = self._player_acc(pid, team)
        games = raw.w
        fga = (raw.total("fga") + 2 * self._team_rate(team, "fga", 1.8)) / (games + 2) if games else self._team_rate(team, "fga", 1.8)
        fga *= _clip(env, 0.75, 1.3) ** 0.6
        made_k = {"short": raw.total("fgm_0_19") + raw.total("fgm_20_29") + raw.total("fgm_30_39"),
                  "mid": raw.total("fgm_40_49"), "long": raw.total("fgm_50p")}
        miss_k = {"short": raw.total("fgmiss_0_19") + raw.total("fgmiss_20_29") + raw.total("fgmiss_30_39"),
                  "mid": raw.total("fgmiss_40_49"), "long": raw.total("fgmiss_50p")}
        att_k = {b: made_k[b] + miss_k[b] for b in made_k}
        total_k = sum(att_k.values())
        line: dict[str, float] = {}
        for bucket, made_cat, miss_cats in (
            ("short", "fg_made_0_39", (("fg_miss_0_29", 0.35), ("fg_miss_30_39", 0.65))),
            ("mid", "fg_made_40_49", (("fg_miss_40_49", 1.0),)),
            ("long", "fg_made_50_plus", (("fg_miss_50_plus", 1.0),)),
        ):
            mix = (att_k[bucket] + 10 * self.lg_kick["mix"][bucket]) / (total_k + 10)
            make = (made_k[bucket] + 15 * self.lg_kick["make"][bucket]) / (att_k[bucket] + 15)
            line[made_cat] = fga * mix * make
            for cat, part in miss_cats:
                line[cat] = fga * mix * (1 - make) * part
        line["xp_made"] = implied * self.lg_xpa_per_point * self.lg_kick["xp"]
        line["fg_yds"] = line["fg_made_0_39"] * 31.0 + line["fg_made_40_49"] * 44.5 + line["fg_made_50_plus"] * 53.0
        out = {k: round(v, 3) for k, v in line.items()}
        out["_why"] = {"team": team, "opp": opp, "implied": round(implied, 1), "fga": round(fga, 2)}
        return out

    def _defense_line(self, team: str, opp: str, lines: dict) -> dict:
        mine, theirs = self.teams.get(team), self.teams.get(opp)
        lg = self.lg_dst

        def blend(key_mine: str, key_theirs: str, league: float) -> float:
            a = (mine.total(key_mine) + 3 * league) / (mine.w + 3) if mine else league
            b = (theirs.total(key_theirs) + 3 * league) / (theirs.w + 3) if theirs else league
            return (a + b) / 2

        opp_implied = float(lines.get(opp, {}).get("implied_points") or self._team_points(opp))
        opp_avg = self._team_points(opp)
        yards = (theirs.mean("yards", 330.0) if theirs else 330.0) * _clip(opp_implied / opp_avg, 0.7, 1.4) ** 0.5
        line = {
            "_pts_allow": opp_implied,
            "_yds_allow": yards,
            "def_sack": blend("def_sack", "sacked", lg["def_sack"]),
            "def_int": blend("def_int", "int_thrown", lg["def_int"]),
            "def_fum_rec": blend("def_fum_rec", "fum_lost", lg["def_fum_rec"]),
            "def_return_td": (mine.total("def_td") + 8 * lg["def_td"]) / (mine.w + 8) if mine else lg["def_td"],
            "def_safety": lg["def_safety"],
            "def_block": lg["def_block"],
        }
        out = {k: round(v, 3) for k, v in line.items()}
        out["_why"] = {"team": team, "opp": opp, "opp_implied": round(opp_implied, 1)}
        return out
