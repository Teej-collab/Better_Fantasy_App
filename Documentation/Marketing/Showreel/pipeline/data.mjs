// Demo league for the showreel — every fantasy team, owner, chat message and
// score here is fictional. NFL players/teams are real public figures.
import fs from "node:fs";
const PIDS = JSON.parse(fs.readFileSync(new URL("./pids.json", import.meta.url)));
const STATE_FILE = new URL("./demo-state.json", import.meta.url);
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE)); } catch { return { step: 0 }; } })();
export const SEASON = 2026;
export const WEEK = 4;
export const NOW = Date.parse("2026-09-27T23:42:00Z"); // Sun 6:42 PM CT
const now = NOW;
const iso = (msFromNow) => new Date(now + msFromNow).toISOString();
const MIN = 60_000, HR = 3_600_000;

// ---------------------------------------------------------------- owners/teams
export const TEAMS = [
  { id: 1, owner: "Marcus", name: "Mahomes Alone", color: "#ff1744" },
  { id: 2, owner: "Jordan", name: "Hurts Donut", color: "#0ea5e9" },
  { id: 3, owner: "Tyler", name: "Bijan Mustard", color: "#facc15" },
  { id: 4, owner: "Dre", name: "Kittle Me Elmo", color: "#a855f7" },
  { id: 5, owner: "Chris", name: "Nacua Matata", color: "#39ff14" },
  { id: 6, owner: "Nate", name: "Brock Lobster", color: "#f97316" },
  { id: 7, owner: "Sam", name: "Gibbs Me Liberty", color: "#22d3ee" },
  { id: 8, owner: "Mike", name: "Chase the Bag", color: "#ec4899" },
  { id: 9, owner: "Luis", name: "Saquon & On", color: "#facc15" },
  { id: 10, owner: "Kev", name: "Burrow Me a Title", color: "#0ea5e9" },
  { id: 11, owner: "Derek", name: "Jefferson Airplane", color: "#a855f7" },
  { id: 12, owner: "Ryan", name: "Henry the VIII", color: "#39ff14" },
];
const T = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
const ME = 1;

// ---------------------------------------------------------------- NFL slate
// state: in | post | pre. Scores for the KC@BUF gamecast game move with state.step.
const kcBuf = [
  { away: 27, home: 24, clock: "8:42", period: 4 },
  { away: 27, home: 24, clock: "6:15", period: 4 },
  { away: 34, home: 24, clock: "4:51", period: 4 },
][Math.min(state.step, 2)];
export const NFL = [
  { id: "401800401", away: "KC", home: "BUF", as: kcBuf.away, hs: kcBuf.home, state: "in", detail: `${kcBuf.clock} - 4th`, tv: "CBS" },
  { id: "401800402", away: "DET", home: "GB", as: 21, hs: 17, state: "in", detail: "2:07 - 3rd", tv: "FOX" },
  { id: "401800403", away: "CIN", home: "BAL", as: 28, hs: 31, state: "in", detail: "11:30 - 4th", tv: "CBS" },
  { id: "401800404", away: "DAL", home: "PHI", as: 14, hs: 20, state: "in", detail: "0:44 - 3rd", tv: "FOX" },
  { id: "401800405", away: "LV", home: "LAC", as: 10, hs: 13, state: "in", detail: "Halftime", tv: "CBS" },
  { id: "401800406", away: "ARI", home: "SEA", as: 17, hs: 23, state: "in", detail: "5:12 - 3rd", tv: "FOX" },
  { id: "401800407", away: "HOU", home: "IND", as: 23, hs: 20, state: "post", detail: "Final", tv: "CBS" },
  { id: "401800408", away: "NO", home: "TB", as: 13, hs: 30, state: "post", detail: "Final", tv: "FOX" },
  { id: "401800409", away: "CAR", home: "JAX", as: 16, hs: 19, state: "post", detail: "Final/OT", tv: "CBS" },
  { id: "401800410", away: "NYG", home: "WAS", as: 20, hs: 27, state: "post", detail: "Final", tv: "FOX" },
  { id: "401800411", away: "TEN", home: "NE", as: 9, hs: 24, state: "post", detail: "Final", tv: "CBS" },
  { id: "401800412", away: "CLE", home: "PIT", as: 6, hs: 20, state: "post", detail: "Final", tv: "CBS" },
  { id: "401800413", away: "LAR", home: "SF", as: null, hs: null, state: "pre", detail: "Sun 8:20 PM", tv: "NBC", date: iso(2.2 * HR) },
  { id: "401800414", away: "NYJ", home: "MIA", as: null, hs: null, state: "pre", detail: "Mon 8:15 PM", tv: "ESPN", date: iso(26 * HR) },
  { id: "401800415", away: "MIN", home: "ATL", as: 24, hs: 27, state: "post", detail: "Final", tv: "Prime Video" },
  { id: "401800416", away: "DEN", home: "CHI", as: 31, hs: 17, state: "post", detail: "Final", tv: "CBS" },
];
const gameByTeam = {};
for (const g of NFL) { gameByTeam[g.away] = g; gameByTeam[g.home] = g; }
const nflGame = (g) => ({
  id: g.id, name: `${g.away} @ ${g.home}`, home_team: g.home, away_team: g.away,
  home_score: g.hs == null ? null : String(g.hs), away_score: g.as == null ? null : String(g.as),
  state: g.state, status_detail: g.detail, completed: g.state === "post", date: g.date ?? iso(-3 * HR), broadcast: g.tv, week: WEEK,
});

// ---------------------------------------------------------------- rosters
// [name, pos, slot, pts, proj]
const R = {
  1: [["Patrick Mahomes","QB","QB",26.8,22.1],["Jahmyr Gibbs","RB","RB",24.6,17.8],["James Cook","RB","RB",12.2,13.9],["Puka Nacua","WR","WR",21.3,16.2],["Rashee Rice","WR","WR",14.7,13.5],["Travis Kelce","TE","TE",11.6,11.8],["Tee Higgins","WR","FLEX",15.8,12.4],["Brandon Aubrey","K","K",7.0,8.6],["Chuba Hubbard","RB","BE",12.1,10.2],["Xavier Worthy","WR","BE",6.3,9.1],["Bo Nix","QB","BE",18.2,17.4],["Tucker Kraft","TE","BE",4.1,7.9]],
  2: [["Josh Allen","QB","QB",24.1,23.4],["Saquon Barkley","RB","RB",17.9,17.2],["Derrick Henry","RB","RB",16.4,15.8],["Ja'Marr Chase","WR","WR",24.8,18.1],["Amon-Ra St. Brown","WR","WR",11.0,16.4],["Dalton Kincaid","TE","TE",6.4,9.2],["Jaxon Smith-Njigba","WR","FLEX",13.3,14.0],["Jake Bates","K","K",5.0,8.1],["Jordan Love","QB","BE",15.4,16.9],["Kyle Pitts","TE","BE",3.2,7.3],["Tony Pollard","RB","BE",9.8,10.9],["Chris Olave","WR","BE",11.0,12.2]],
  3: [["Jalen Hurts","QB","QB",21.2,21.0],["Bijan Robinson","RB","RB",23.4,19.5],["Kyren Williams","RB","RB",0,15.1],["CeeDee Lamb","WR","WR",12.9,17.0],["Drake London","WR","WR",16.1,15.3],["Trey McBride","TE","TE",14.2,12.0],["Alvin Kamara","RB","FLEX",8.8,12.1],["Cameron Dicker","K","K",6.0,8.4]],
  4: [["Joe Burrow","QB","QB",19.9,20.8],["Christian McCaffrey","RB","RB",0,18.4],["Josh Jacobs","RB","RB",15.7,15.9],["Garrett Wilson","WR","WR",0,14.4],["Nico Collins","WR","WR",18.3,15.2],["George Kittle","TE","TE",0,11.1],["Zay Flowers","WR","FLEX",11.4,12.2]],
  5: [["Jayden Daniels","QB","QB",22.6,21.9],["De'Von Achane","RB","RB",0,16.7],["Breece Hall","RB","RB",0,14.4],["Malik Nabers","WR","WR",17.4,16.5],["Terry McLaurin","WR","WR",13.1,12.9],["Brock Bowers","TE","TE",9.7,13.1]],
  6: [["Lamar Jackson","QB","QB",27.9,23.6],["Jonathan Taylor","RB","RB",20.3,18.0],["Ashton Jeanty","RB","RB",11.2,15.5],["A.J. Brown","WR","WR",8.6,14.1],["Ladd McConkey","WR","WR",10.4,13.0],["Mark Andrews","TE","TE",12.8,10.2]],
  7: [["C.J. Stroud","QB","QB",18.8,18.6],["Omarion Hampton","RB","RB",9.4,13.2],["Bucky Irving","RB","RB",17.3,14.1],["Brian Thomas","WR","WR",14.9,14.6],["Mike Evans","WR","WR",7.2,12.8],["Sam LaPorta","TE","TE",10.1,10.4]],
  8: [["Baker Mayfield","QB","QB",23.7,19.3],["Chase Brown","RB","RB",13.6,14.0],["Travis Etienne","RB","RB",6.1,11.9],["Marvin Harrison","WR","WR",11.9,13.7],["DK Metcalf","WR","WR",15.5,13.3],["Evan Engram","TE","TE",5.9,8.7]],
  9: [["Drake Maye","QB","QB",20.4,18.2],["Kenneth Walker","RB","RB",12.4,13.8],["David Montgomery","RB","RB",14.0,12.7],["Tetairoa McMillan","WR","WR",13.6,13.1],["Chris Olave","WR","WR",9.2,12.5],["Kyle Pitts","TE","TE",3.2,7.3]],
  10: [["Caleb Williams","QB","QB",13.5,18.9],["Aaron Jones","RB","RB",16.2,13.0],["Tony Pollard","RB","RB",9.8,10.9],["Davante Adams","WR","WR",0,14.8],["Justin Jefferson","WR","WR",21.7,17.9],["Tucker Kraft","TE","TE",4.1,7.9]],
  11: [["Kyler Murray","QB","QB",16.0,19.4],["Chuba Hubbard","RB","RB",12.1,10.2],["Travis Etienne","RB","RB",6.1,11.9],["Justin Jefferson","WR","WR",21.7,17.9],["Terry McLaurin","WR","WR",13.1,12.9],["Dalton Kincaid","TE","TE",6.4,9.2]],
  12: [["Jordan Love","QB","QB",15.4,16.9],["Derrick Henry","RB","RB",22.6,15.8],["Saquon Barkley","RB","RB",17.9,17.2],["Amon-Ra St. Brown","WR","WR",15.2,16.4],["CeeDee Lamb","WR","WR",12.9,17.0],["Travis Kelce","TE","TE",11.6,11.8]],
};
// Step-driven live bumps for the hero matchup (Kelce TD at step 2).
if (state.step >= 1) R[1][4][3] = 17.9;
if (state.step >= 2) R[1][4][3] = 17.9; // Rice catch
if (state.step >= 2) { R[1][5][3] = 22.4; R[1][0][3] = 31.2; }
const PLAYER_TEAM = JSON.parse(fs.readFileSync(new URL("./pteams.json", import.meta.url)));
function rosterFor(teamId) {
  return (R[teamId] ?? []).map(([name, pos, slot, pts, proj], i) => {
    const pro = PLAYER_TEAM[name] ?? null;
    const g = pro ? gameByTeam[pro] : null;
    const gs = !g ? null : g.state === "in" ? "in_progress" : g.state === "post" ? "final" : "scheduled";
    const played = gs !== "scheduled";
    const ptsNow = played ? pts : null;
    return {
      player_name: name, position: pos, lineup_slot: slot,
      points_scored: ptsNow, points_projected: proj,
      live_projected: gs === "in_progress" ? +(pts + proj * 0.28).toFixed(1) : played ? pts : proj,
      in_game_injury: null, player_id: PIDS[name] ?? null, pro_team: pro, injury_status: null,
      next_opponent: g ? (g.home === pro ? g.away : `@${g.home}`) : null,
      game_time: g?.date ?? iso(-2 * HR), opponent_position_rank: { rank: 5 + ((i * 7) % 27), average_allowed: 14.2 },
      is_boom: played && pts > proj * 1.4, is_bust: played && gs === "final" && pts < proj * 0.5,
      raw_stats: null, on_offense: gs === "in_progress" && ["KC", "DET", "BAL"].includes(pro),
      is_redzone: gs === "in_progress" && pro === "KC" && state.step === 1,
      game_status: gs,
    };
  });
}
const score = (teamId) => +rosterFor(teamId).filter((p) => p.lineup_slot !== "BE").reduce((s, p) => s + (p.points_scored ?? 0), 0).toFixed(1);
const proj = (teamId) => +rosterFor(teamId).filter((p) => p.lineup_slot !== "BE").reduce((s, p) => s + (p.live_projected ?? 0), 0).toFixed(1);
const pregame = (teamId) => +rosterFor(teamId).filter((p) => p.lineup_slot !== "BE").reduce((s, p) => s + (p.points_projected ?? 0), 0).toFixed(1);
const inPlay = (teamId) => rosterFor(teamId).filter((p) => p.lineup_slot !== "BE" && p.game_status === "in_progress").length;
const yetToPlay = (teamId) => rosterFor(teamId).filter((p) => p.lineup_slot !== "BE" && p.game_status === "scheduled").length;

// ---------------------------------------------------------------- standings
const REC = { 1: [3, 0, 342.6, 288.1], 2: [3, 0, 355.2, 301.4], 3: [2, 1, 331.9, 310.2], 4: [2, 1, 318.4, 305.5], 5: [2, 1, 322.8, 314.0], 6: [2, 1, 310.1, 299.7], 7: [1, 2, 298.3, 309.9], 8: [1, 2, 305.6, 322.3], 9: [1, 2, 289.4, 312.8], 10: [1, 2, 276.0, 318.6], 11: [0, 3, 281.2, 330.4], 12: [0, 3, 262.7, 339.3] };
const STREAK = { 1: "W3", 2: "W3", 3: "W1", 4: "L1", 5: "W2", 6: "W1", 7: "L1", 8: "W1", 9: "L2", 10: "L1", 11: "L3", 12: "L3" };
const POWER = [2, 1, 4, 3, 5, 6, 8, 7, 9, 10, 11, 12]; // index = team-1
const MOVE = [1, -1, 2, -1, 0, 1, -2, 3, 0, -1, 1, -1];
const record = (id) => `${REC[id][0]}-${REC[id][1]}`;
const standings = () => TEAMS.map((t) => ({
  team_id: t.id, team_name: t.name, owner_name: t.owner, wins: REC[t.id][0], losses: REC[t.id][1], ties: 0,
  points_for: REC[t.id][2].toFixed(2), points_against: REC[t.id][3].toFixed(2), final_rank: null,
})).sort((a, b) => b.wins - a.wins || +b.points_for - +a.points_for);

// ---------------------------------------------------------------- matchups
const PAIRS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]]; // [home, away]
const H2H = { "1-2": [9, 8], "3-4": [4, 5], "5-6": [3, 3], "7-8": [6, 2], "9-10": [2, 4], "11-12": [5, 5] };
function side(teamId, oppId) {
  const s = score(teamId), o = score(oppId);
  const wp = Math.max(0.03, Math.min(0.97, 0.5 + (proj(teamId) - proj(oppId)) / 40));
  return {
    team_id: teamId, team_name: T[teamId].name, owner_id: teamId, owner_name: T[teamId].owner,
    power_rank: POWER[teamId - 1], logo_url: null, score: s, season_points: REC[teamId][2],
    record: record(teamId), streak: REC[teamId][0] >= 3 ? "hot" : REC[teamId][1] >= 3 ? "cold" : "neutral",
    result_streak: STREAK[teamId], projected_total: proj(teamId), pregame_projected_total: pregame(teamId),
    roster: rosterFor(teamId), touchdowns: teamId === 1 ? [{ player_name: "Puka Nacua", position: "WR", touchdowns: 1 }, { player_name: "Jahmyr Gibbs", position: "RB", touchdowns: 1 }, ...(state.step >= 2 ? [{ player_name: "Travis Kelce", position: "TE", touchdowns: 1 }] : [])] : teamId === 2 ? [{ player_name: "Ja'Marr Chase", position: "WR", touchdowns: 2 }, { player_name: "Derrick Henry", position: "RB", touchdowns: 1 }] : [],
    bench_crime: null, clutch_choke: null, win_probability: +(wp * 100).toFixed(1),
  };
}
function matchupItem(idx) {
  const [h, a] = PAIRS[idx];
  const key = `${h}-${a}`;
  const rival = idx === 0;
  return {
    matchup_id: 4000 + idx, season: SEASON, week: WEEK, is_playoff: false, is_game_of_the_week: idx === 0, is_rivalry: rival,
    rivalry: rival ? { name: "The Grudge", emoji: "🔥", tagline: "Since 2019. Nobody's forgotten.", description: "College roommates. One trophy between them. Every meeting is personal.", tier: "Legendary", all_time_wins_home: 9, all_time_wins_away: 8 } : null,
    head_to_head: { wins_home: H2H[key][0], wins_away: H2H[key][1], ties: 0, last_season: 2025, last_week: 11, recent_meetings: [
      { season: 2024, week: 6, home_won: true, tie: false, home_score: 131.2, away_score: 118.9 },
      { season: 2024, week: 15, home_won: false, tie: false, home_score: 102.4, away_score: 109.7 },
      { season: 2025, week: 3, home_won: false, tie: false, home_score: 97.3, away_score: 142.8 },
      { season: 2025, week: 11, home_won: true, tie: false, home_score: 126.0, away_score: 125.4 },
    ] },
    home: side(h, a), away: side(a, h), narrative: null,
  };
}
const matchupContext = () => ({ season: SEASON, week: WEEK, game_of_the_week_matchup_id: 4000, matchups: PAIRS.map((_, i) => matchupItem(i)) });

// ---------------------------------------------------------------- misc league
const topScorer = (id) => { const r = rosterFor(id).filter((p) => p.lineup_slot !== "BE" && p.points_scored != null).sort((a, b) => b.points_scored - a.points_scored)[0]; return r ? { player_name: r.player_name, points_scored: r.points_scored } : null; };
const RIVALRIES = [
  { id: 1, name: "The Grudge", emoji: "🔥", tagline: "Since 2019. Nobody's forgotten.", description: "College roommates. One trophy between them.", tier: "Legendary", all_time_wins_a: 9, all_time_wins_b: 8, owner_a_id: 1, owner_a_name: "Marcus", owner_b_id: 2, owner_b_name: "Jordan" },
  { id: 2, name: "Brother-in-Law Bowl", emoji: "🦃", tagline: "Thanksgiving has never recovered.", description: "Loser carves the turkey.", tier: "Historic", all_time_wins_a: 6, all_time_wins_b: 7, owner_a_id: 3, owner_a_name: "Tyler", owner_b_id: 4, owner_b_name: "Dre" },
  { id: 3, name: "The Office Feud", emoji: "💼", tagline: "HR has been notified.", description: "Same desk pod, different realities.", tier: "Developing", all_time_wins_a: 3, all_time_wins_b: 3, owner_a_id: 5, owner_a_name: "Chris", owner_b_id: 6, owner_b_name: "Nate" },
];
const PREFS = {
  notify_direct_messages: true, notify_league_chat: true, notify_mentions: true, notify_replies: true, sunday_mode: "full_send",
  quiet_hours_enabled: false, quiet_hours_start: "23:00", quiet_hours_end: "07:00", timezone: "America/Chicago",
  read_receipts_enabled: true, typing_indicators_enabled: true, message_previews_enabled: true, mention_highlighting_enabled: true,
  neon_intensity: "standard", reduced_motion: false, accent_color: null, your_week_color: null, border_glow_color: null, honeycomb_color: null,
  theme: "cosmic", beta_layout: false, design_direction: "default", bottom_nav_order: null, home_card_order: null, push_enabled: true,
  notify_game_alerts: true, notify_my_players: true, notify_red_zone: true, notify_injuries: true, notify_player_news: true,
  notify_fantasy_team: true, notify_league: true, ai_training_opt_out: false, ai_training_notice_seen: true,
};
const ACTIVITY = [
  { kind: "trade", timestamp: iso(-3 * HR), proposing_team_name: "Chase the Bag", proposing_owner_id: 8, proposing_owner_name: "Mike", receiving_team_name: "Saquon & On", receiving_owner_id: 9, receiving_owner_name: "Luis", assets: [{ player_name: "Chris Olave", position: "WR", to_team_id: 9 }, { player_name: "Travis Etienne", position: "RB", to_team_id: 8 }] },
  { kind: "roster", timestamp: iso(-20 * HR), team_name: "Kittle Me Elmo", owner_id: 4, owner_name: "Dre", source: "waiver", added_player_name: "Tucker Kraft", added_position: "TE", dropped_player_name: "Pat Freiermuth", dropped_position: "TE" },
  { kind: "roster", timestamp: iso(-26 * HR), team_name: "Mahomes Alone", owner_id: 1, owner_name: "Marcus", source: "free_agent", added_player_name: "Chuba Hubbard", added_position: "RB", dropped_player_name: "Rhamondre Stevenson", dropped_position: "RB" },
  { kind: "roster", timestamp: iso(-30 * HR), team_name: "Henry the VIII", owner_id: 12, owner_name: "Ryan", source: "waiver", added_player_name: "Wan'Dale Robinson", added_position: "WR", dropped_player_name: "Jerry Jeudy", dropped_position: "WR" },
];
const RECAP = `Week 3 belonged to the undefeated. Mahomes Alone hung 131.4 on Gibbs Me Liberty and never once looked nervous, while Hurts Donut needed a Monday-night Derrick Henry plunge to escape Kittle Me Elmo by 2.6 — Dre, we saw the bench. We all saw the bench.\n\nThat sets up the only thing anyone's talking about: The Grudge is back. Marcus vs. Jordan, both 3-0, 17 meetings, separated by one win. Somebody's perfect season ends Sunday.\n\nMeanwhile Henry the VIII is 0-3 and has started a kicker on a bye. Twice.`;
const AWARDS = {
  overachiever: { team_id: 1, team_name: "Mahomes Alone", diff: 24.6 }, meltdown: { team_id: 11, team_name: "Jefferson Airplane", diff: -31.2 },
  biggest_bench_crime: { bench_player: "Bo Nix", started_player: "Caleb Williams", position: "QB", points_diff: 14.9, severity: "felony", team_name: "Burrow Me a Title" },
  clutch: { team_name: "Hurts Donut", margin: 2.6, reason: "Derrick Henry 1-yd TD on MNF" }, choke: { team_name: "Kittle Me Elmo", margin: 2.6, reason: "Left 21 points on the bench" },
  boom_leaders: [{ player_name: "Ja'Marr Chase", points_scored: 34.8, team_name: "Hurts Donut" }, { player_name: "Lamar Jackson", points_scored: 32.1, team_name: "Brock Lobster" }],
  bust_leaders: [{ player_name: "CeeDee Lamb", points_scored: 3.4, team_name: "Bijan Mustard" }],
  game_of_the_week: { winner: "Hurts Donut", score: "121.7 – 119.1" },
};

// ---------------------------------------------------------------- chat
const CHAT_COLORS = { 1: "#ff1744", 2: "#0ea5e9", 3: "#facc15", 4: "#a855f7", 5: "#39ff14", 6: "#f97316", 7: "#22d3ee", 8: "#ec4899", 9: "#facc15", 10: "#0ea5e9", 11: "#a855f7", 12: "#39ff14" };
let mid = 900;
const msg = (owner, body, minsAgo, extra = {}) => ({
  id: ++mid, conversation_id: 1, owner_id: owner, owner_name: T[owner].owner, owner_chat_color: CHAT_COLORS[owner], owner_logo_url: null,
  body, image_url: null, title: null, deleted: false, created_at: iso(-minsAgo * MIN), reply_to: null, mentions: [], reactions: [], seen_by: [], ...extra,
});
const CHAT = [
  msg(4, "who had the guts to start kyren williams today", 58),
  msg(3, "don't", 57),
  msg(12, "0-3 and I'm still the most confident person in this chat", 44, { reactions: [{ emoji: "😂", count: 6, reacted_by_me: true, reactor_names: ["Marcus", "Tyler", "Dre", "Sam", "Mike", "Kev"] }] }),
  msg(2, "Chase with 2 TDs before the 4pm games even end. Marcus you seeing this?", 31, { reactions: [{ emoji: "🔥", count: 3, reacted_by_me: false, reactor_names: ["Jordan", "Luis", "Kev"] }] }),
  msg(1, "Mahomes has the ball, down 3, 8 minutes left. Enjoy it while it lasts", 26, { reactions: [{ emoji: "👀", count: 5, reacted_by_me: false, reactor_names: ["Tyler", "Dre", "Chris", "Nate", "Sam"] }] }),
  msg(7, "the grudge is actually living up to the hype for once", 19),
  msg(2, "Kelce is 36 years old bro", 12, { reactions: [{ emoji: "💀", count: 4, reacted_by_me: false, reactor_names: ["Derek", "Ryan", "Mike", "Chris"] }] }),
  msg(9, "someone open the gamecast, KC is in the red zone", 4),
];
const CHAT_LIVE = [
  msg(1, "KELCE. 36 YEARS OLD. 🚀", 0.3, { reactions: [{ emoji: "🔥", count: 7, reacted_by_me: true, reactor_names: ["Marcus", "Tyler", "Dre", "Chris", "Nate", "Sam", "Kev"] }] }),
  msg(2, "I'm going to be sick", 0.1, { reactions: [{ emoji: "😂", count: 9, reacted_by_me: true, reactor_names: ["Marcus", "Tyler", "Dre", "Chris", "Nate", "Sam", "Mike", "Luis", "Kev"] }] }),
];
const chatMessages = () => (state.step >= 3 ? [...CHAT, ...CHAT_LIVE] : CHAT);
const conversations = () => {
  const last = chatMessages().at(-1);
  return [
    { id: 1, type: "league", member_count: 12, other_owner_id: null, other_owner_name: null, other_owner_chat_color: null, other_owner_logo_url: null, other_last_read_message_id: null, avatar_group: null, unread_count: 0, last_message: { id: last.id, owner_name: last.owner_name, body: last.body, created_at: last.created_at }, can_post: true, name: "League Chat", title: "League Chat" },
    { id: 2, type: "direct", member_count: 2, other_owner_id: 7, other_owner_name: "Sam", other_owner_chat_color: CHAT_COLORS[7], other_owner_logo_url: null, other_last_read_message_id: null, avatar_group: null, unread_count: 2, last_message: { id: 50, owner_name: "Sam", body: "trade talk after the game? I need a TE", created_at: iso(-40 * MIN) }, can_post: true },
    { id: 3, type: "direct", member_count: 2, other_owner_id: 2, other_owner_name: "Jordan", other_owner_chat_color: CHAT_COLORS[2], other_owner_logo_url: null, other_last_read_message_id: null, avatar_group: null, unread_count: 0, last_message: { id: 51, owner_name: "Jordan", body: "loser posts the chug. no excuses", created_at: iso(-3 * HR) }, can_post: true },
    { id: 4, type: "commish_corner", member_count: 2, other_owner_id: null, other_owner_name: null, other_owner_chat_color: null, other_owner_logo_url: null, other_last_read_message_id: null, avatar_group: null, unread_count: 0, last_message: { id: 52, owner_name: "Marcus", body: "Week 4 recap is live 📣", created_at: iso(-50 * HR) }, can_post: true },
  ];
};

// ---------------------------------------------------------------- gamecast (KC @ BUF)
const P = (id, desc, extra = {}) => ({
  play_id: `p${id}`, drive_id: "d14", period: 4, clock: "8:42", down: 1, distance: 10, description: desc, play_type: "Pass",
  yards_gained: 0, is_scoring_play: false, is_turnover: false, is_first_down: false, event_type: null, players_involved: [], timestamp: iso(-id * MIN), ...extra,
});
function gamecastState() {
  const plays = [
    P(1, "(Shotgun) P.Mahomes pass short right to R.Rice to KC 41 for 16 yards", { clock: "8:42", down: 1, distance: 10, yards_gained: 16, is_first_down: true, players_involved: [{ name: "Patrick Mahomes", team_abbr: "KC", role: "passer", provider_player_id: "3139477" }, { name: "Rashee Rice", team_abbr: "KC", role: "receiver" }] }),
    P(2, "K.Walker left tackle to KC 45 for 4 yards", { clock: "7:58", down: 1, distance: 10, yards_gained: 4, play_type: "Rush" }),
    P(3, "(Shotgun) P.Mahomes scrambles up the middle to BUF 38 for 17 yards", { clock: "7:21", down: 2, distance: 6, yards_gained: 17, is_first_down: true, play_type: "Rush" }),
  ];
  if (state.step >= 1) plays.push(P(4, "(Shotgun) P.Mahomes pass deep left to R.Rice to BUF 6 for 32 yards", { clock: "6:15", down: 1, distance: 10, yards_gained: 32, is_first_down: true }));
  if (state.step >= 2) plays.push(P(5, "(Shotgun) P.Mahomes pass short middle to T.Kelce for 6 yards, TOUCHDOWN. H.Butker extra point is GOOD.", { clock: "4:51", down: 1, distance: 6, yards_gained: 6, is_scoring_play: true, event_type: "touchdown", players_involved: [{ name: "Patrick Mahomes", team_abbr: "KC", role: "passer" }, { name: "Travis Kelce", team_abbr: "KC", role: "receiver" }] }));
  const ytg = state.step === 0 ? 38 : state.step === 1 ? 6 : 0;
  const drive = { drive_id: "d14", team_abbr: "KC", play_count: plays.length, yards: plays.reduce((s, p) => s + (p.yards_gained ?? 0), 0), duration: "3:51", start_yard_line: 25, result: state.step >= 2 ? "Touchdown" : null, plays };
  const scoring = [
    { play_id: "s1", period: 1, clock: "9:12", team_abbr: "BUF", score_type: "TD", description: "J.Cook 12 yd run (T.Bass kick)", home_score_after: 7, away_score_after: 0 },
    { play_id: "s2", period: 1, clock: "2:40", team_abbr: "KC", score_type: "TD", description: "P.Mahomes 23 yd pass to X.Worthy (H.Butker kick)", home_score_after: 7, away_score_after: 7 },
    { play_id: "s3", period: 2, clock: "10:05", team_abbr: "BUF", score_type: "TD", description: "J.Allen 4 yd run (T.Bass kick)", home_score_after: 14, away_score_after: 7 },
    { play_id: "s4", period: 2, clock: "0:03", team_abbr: "KC", score_type: "FG", description: "H.Butker 51 yd field goal", home_score_after: 14, away_score_after: 10 },
    { play_id: "s5", period: 3, clock: "7:44", team_abbr: "KC", score_type: "TD", description: "P.Mahomes 38 yd pass to R.Rice (H.Butker kick)", home_score_after: 14, away_score_after: 17 },
    { play_id: "s6", period: 3, clock: "1:15", team_abbr: "BUF", score_type: "TD", description: "J.Allen 19 yd pass to D.Kincaid (T.Bass kick)", home_score_after: 21, away_score_after: 17 },
    { play_id: "s7", period: 4, clock: "13:02", team_abbr: "BUF", score_type: "FG", description: "T.Bass 44 yd field goal", home_score_after: 24, away_score_after: 17 },
    { play_id: "s8", period: 4, clock: "10:30", team_abbr: "KC", score_type: "TD", description: "K.Walker 11 yd run (H.Butker kick)", home_score_after: 24, away_score_after: 24 },
    { play_id: "s9", period: 4, clock: "9:18", team_abbr: "KC", score_type: "FG", description: "H.Butker 47 yd field goal", home_score_after: 24, away_score_after: 27 },
  ];
  scoring[7].description = "K.Walker 11 yd run (H.Butker kick)";
  if (state.step >= 2) scoring.push({ play_id: "s10", period: 4, clock: "4:51", team_abbr: "KC", score_type: "TD", description: "P.Mahomes 6 yd pass to T.Kelce (H.Butker kick)", home_score_after: 24, away_score_after: 34 });
  return {
    game_id: "401800401", provider: "espn", status: "in_progress", season: SEASON, week: WEEK, scheduled_start: iso(-3 * HR),
    home_team: { abbr: "BUF", name: "Buffalo Bills", score: kcBuf.home }, away_team: { abbr: "KC", name: "Kansas City Chiefs", score: kcBuf.away },
    period: 4, period_label: "4th", clock: kcBuf.clock, possession_team_abbr: "KC",
    down: state.step >= 2 ? null : 1, distance: state.step >= 2 ? null : state.step === 1 ? 6 : 10, yards_to_goal: ytg,
    field_position_label: state.step === 0 ? "BUF 38" : state.step === 1 ? "BUF 6" : "TOUCHDOWN", is_redzone: state.step >= 1,
    current_drive: drive, drives: [drive], plays: [...plays].reverse(), scoring_plays: scoring, last_updated: iso(30 * MIN),
  };
}
const liveGames = () => NFL.filter((g) => g.state !== "pre").map((g) => ({
  game_id: g.id, status: g.state === "in" ? (g.detail === "Halftime" ? "halftime" : "in_progress") : "final",
  home_team: { abbr: g.home, name: g.home, score: g.hs }, away_team: { abbr: g.away, name: g.away, score: g.as },
  period: g.state === "in" ? +(g.detail.match(/(\d)(st|nd|rd|th)/)?.[1] ?? 2) : 4, period_label: g.detail, clock: g.detail.split(" - ")[0],
}));
export { gamecastState, state, STATE_FILE, CHAT_LIVE };

// ---------------------------------------------------------------- chug analyzer (Jeffrey's Rule)
const CHUGS = [
  { id: 71, owner_id: 7, owner_name: "Sam", week: 3, final_score: 9.1, created_at: iso(-20 * HR), has_video: true, roast: "4.1 seconds, zero hesitation. Sam treated that can like it owed him money." },
  { id: 70, owner_id: 12, owner_name: "Ryan", week: 3, final_score: 3.8, created_at: iso(-22 * HR), has_video: true, roast: "Ryan sipped. Paused. Sipped again. That wasn't a chug, that was a tasting menu." },
  { id: 69, owner_id: 4, owner_name: "Dre", week: 3, final_score: 7.6, created_at: iso(-26 * HR), has_video: true, roast: "Elite pace, elite hype, questionable burp management. Kyren's zero-point Sunday has been avenged." },
  { id: 68, owner_id: 10, owner_name: "Kev", week: 2, final_score: 6.2, created_at: iso(-5 * 24 * HR), has_video: true, roast: "Solid effort, but the crowd noise did more work than Kev did." },
];
const CHUG_BOARD = [
  [7, "Sam", 3, 3, 8.8, 9, 0, 0, 0], [4, "Dre", 3, 2, 7.4, 6, 1, 0, 0], [1, "Marcus", 2, 1, 8.1, 7, 1, 0, 0],
  [12, "Ryan", 5, 1, 3.8, 3, 2, 2, 20], [10, "Kev", 2, 2, 6.9, 5, 0, 0, 0], [2, "Jordan", 1, 1, 7.9, 4, 0, 0, 0],
].map(([owner_id, owner_name, owed, completed, avg_grade, lifetime_completed, outstanding_owed, fined_owed, fine_amount]) => ({
  owner_id, owner_name, owed, completed, avg_grade, lifetime_completed, outstanding_owed, fined_owed, fine_amount, doubled_weeks: [],
}));
const CHUG_RESULT = {
  can_to_mouth: true, id: 72, duration_seconds: 5.3, time_score: 8.9, smoothness_score: 9.1, hype_score: 8.4, final_score: 8.7,
  created_at: iso(0), chugs_owed_before: 1, chugs_owed_after: 0,
  roast: "Marcus finished before the crowd noise did. Kelce would be proud.",
};

// ---------------------------------------------------------------- commissioner scoring rules (league-custom values)
const SCORING = Object.entries({
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2, qb_tackle: 5, // typed to 15 on camera
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fg_yds: 0.1, fg_miss_0_29: -5, fg_miss_30_39: -3, fg_miss_40_49: -1, fg_miss_50_plus: 0, xp_made: 1,
  def_sack: 1, def_int: 2, def_fum_rec: 2, def_td: 6, def_safety: 2, def_block: 2,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35_plus: -4,
  yds_allow_lt100: 5, yds_allow_100_199: 3, yds_allow_200_299: 2, yds_allow_300_399: 0, yds_allow_400_449: -1, yds_allow_450_plus: -3,
  fum_lost: -2,
}).map(([stat_category, points_per_unit]) => ({ stat_category, points_per_unit }));

// ---------------------------------------------------------------- routes
const S = SEASON;
const unauth = { __status: 401, body: { detail: "Not authenticated" } };
export const routes = [
  ["GET", /^\/health$/, () => ({ status: "ok" })],
  ["GET", /^\/auth\/me$/, ({ signedIn }) => (signedIn ? { user_id: 1, owner_id: ME, display_name: "Marcus", is_commissioner: true, is_site_owner: false, active_league_id: 1 } : unauth)],
  ["POST", /^\/auth\/ticket$/, () => ({ ticket: "demo-ticket" })],
  ["GET", /^\/seasons$/, () => ({ seasons: [2023, 2024, 2025, 2026] })],
  ["GET", /^\/seasons\/\d+\/current-week$/, () => ({ season: S, current_week: WEEK })],
  ["GET", /^\/nfl\/scoreboard$/, () => ({ games: NFL.map(nflGame) })],
  ["GET", /^\/nfl\/live-games$/, () => ({ games: liveGames() })],
  ["GET", /^\/nfl\/games\/401800401$/, () => gamecastState()],
  ["GET", /^\/nfl\/games\/401800401\/fantasy-impact$/, () => ({
    your_team: { team_id: 1, team_name: "Mahomes Alone" },
    your_players: rosterFor(1).filter((p) => p.pro_team === "KC" && p.lineup_slot !== "BE").map((p) => ({ player_id: p.player_id, player_name: p.player_name, position: p.position, pro_team: "KC", points_scored: p.points_scored })),
    opponent_team: { team_id: 2, team_name: "Hurts Donut" },
    opponent_players: rosterFor(2).filter((p) => p.pro_team === "BUF" && p.lineup_slot !== "BE").map((p) => ({ player_id: p.player_id, player_name: p.player_name, position: p.position, pro_team: "BUF", points_scored: p.points_scored })),
    game_leaders: {
      home: { abbr: "BUF", name: "Buffalo Bills", leaders: [{ player_id: PIDS["Josh Allen"], player_name: "Josh Allen", position: "QB", points_scored: 24.1 }, { player_id: PIDS["James Cook"], player_name: "James Cook", position: "RB", points_scored: 8.2 }, { player_id: PIDS["Dalton Kincaid"], player_name: "Dalton Kincaid", position: "TE", points_scored: 6.4 }] },
      away: { abbr: "KC", name: "Kansas City Chiefs", leaders: rosterFor(1).filter((p) => p.pro_team === "KC" && p.lineup_slot !== "BE").sort((a, b) => b.points_scored - a.points_scored).map((p) => ({ player_id: p.player_id, player_name: p.player_name, position: p.position, points_scored: p.points_scored })) },
    },
  })],
  ["GET", /^\/leagues\/mine$/, () => ({ leagues: [{ id: 1, name: "The Sunday Syndicate", role: "commissioner", is_commissioner: true, member_count: 12 }], active_league_id: 1 })],
  ["GET", /^\/settings\/preferences$/, () => PREFS],
  ["GET", /^\/settings\/me$/, () => ({ display_name: "Marcus", display_name_is_custom: false, chat_color: "#ff1744", logo_url: null, discord_username: null, email: "demo@example.com", has_discord: false, has_google: false, has_password: true, team_name: "Mahomes Alone", team_name_is_custom: true })],
  ["GET", /^\/me\/week$/, () => {
    const o = 2;
    return {
      season: S, week: WEEK, team_id: 1, team_name: "Mahomes Alone", power_rank: 2,
      matchup: { matchup_id: 4000, is_playoff: false, started: true, record: record(1), my_owner_name: "Marcus", my_logo_url: null, my_result_streak: "W3", my_yet_to_play: yetToPlay(1), my_in_play: inPlay(1), my_score: score(1), my_projected_total: proj(1), my_pregame_projected_total: pregame(1),
        opponent_team_id: o, opponent_team_name: T[o].name, opponent_power_rank: 1, opponent_owner_name: T[o].owner, opponent_logo_url: null, opponent_record: record(o), opponent_result_streak: "W3", opponent_yet_to_play: yetToPlay(o), opponent_in_play: inPlay(o), opponent_score: score(o), opponent_projected_total: proj(o), opponent_pregame_projected_total: pregame(o),
        win_probability: side(1, 2).win_probability },
      draft: { scheduled_start: "2026-08-30T00:00:00Z", status: "complete" },
    };
  }],
  ["GET", /^\/seasons\/\d+\/standings$/, () => ({ standings: standings(), playoff_team_count: 6 })],
  ["GET", /^\/seasons\/\d+\/teams$/, () => ({ teams: TEAMS.map((t) => ({ team_id: t.id, espn_team_id: t.id, team_name: t.name, owner_id: t.id, owner_name: t.owner })) })],
  ["GET", /^\/seasons\/\d+\/weeks\/(\d+)\/awards$/, ({ m }) => (+m[1] === WEEK ? { overachiever: null, meltdown: null, biggest_bench_crime: null, clutch: null, choke: null, boom_leaders: [], bust_leaders: [], game_of_the_week: null } : AWARDS)],
  ["GET", /^\/seasons\/\d+\/weeks\/\d+\/matchup-context$/, () => matchupContext()],
  ["GET", /^\/matchups\/(\d+)$/, ({ m }) => { const i = +m[1] - 4000; return i >= 0 && i < PAIRS.length ? matchupItem(i) : { __status: 404 }; }],
  ["GET", /^\/rivalries$/, () => ({ rivalries: RIVALRIES })],
  ["GET", /^\/seasons\/\d+\/weeks\/\d+\/ticker$/, () => ({ items: PAIRS.map(([h, a], i) => ({ matchup_id: 4000 + i, home_team_name: T[h].name, home_score: score(h), home_top_scorer: topScorer(h), away_team_name: T[a].name, away_score: score(a), away_top_scorer: topScorer(a) })) })],
  ["GET", /^\/seasons\/\d+\/power-rankings\/latest-week$/, () => ({ week: 3 })],
  ["GET", /^\/seasons\/\d+\/weeks\/\d+\/power-rankings$/, () => ({ rankings: TEAMS.map((t) => ({ team_id: t.id, team_name: t.name, owner_id: t.id, owner_name: t.owner, power_rank: POWER[t.id - 1], luck_score: +((t.id % 5) - 2).toFixed(1) * 3.1, sos: 0.48 + (t.id % 4) * 0.02, movement: MOVE[t.id - 1] })).sort((a, b) => a.power_rank - b.power_rank) })],
  ["GET", /^\/seasons\/\d+\/power-rankings\/trend$/, () => ({ teams: TEAMS.map((t) => ({ team_id: t.id, team_name: t.name, owner_id: t.id, owner_name: t.owner, weeks: [1, 2, 3].map((w) => ({ week: w, power_rank: Math.max(1, Math.min(12, POWER[t.id - 1] + (3 - w) * (MOVE[t.id - 1] > 0 ? 1 : -1) * (w === 3 ? 0 : 1))) })) })) })],
  ["GET", /^\/chug\/deadline$/, () => ({ deadline: iso(26 * HR), is_past: false })],
  ["GET", /^\/chug\/feed/, () => ({ chugs: CHUGS })],
  ["GET", /^\/chug\/leaderboard/, () => ({ season: null, leaderboard: CHUG_BOARD })],
  // The real endpoint streams heartbeats then one JSON line; the analysis delay is simulated here.
  ["POST", /^\/chug\/upload$/, async () => { await new Promise((r) => setTimeout(r, 2600)); return CHUG_RESULT; }],
  ["GET", /^\/league\/scoring-rules/, () => ({ season: S, rules: SCORING })],
  ["PUT", /^\/league\/scoring-rules$/, ({ body }) => { const { rules } = JSON.parse(body || "{}"); return { season: S, rules: SCORING.map((r) => ({ ...r, points_per_unit: rules?.[r.stat_category] ?? r.points_per_unit })) }; }],
  ["GET", /^\/chug\/seasons$/, () => ({ seasons: [2025, 2026] })],
  ["GET", /^\/seasons\/\d+\/weeks\/(\d+)\/recap$/, ({ m }) => ({ narrative: +m[1] === WEEK - 1 ? { text: RECAP, kind: "recap" } : null })],
  ["GET", /^\/seasons\/\d+\/activity/, () => ({ items: ACTIVITY })],
  ["GET", /^\/chat\/conversations$/, () => ({ conversations: conversations() })],
  ["GET", /^\/chat\/conversations\/1\/messages/, () => ({ messages: chatMessages() })],
  ["GET", /^\/chat\/conversations\/\d+\/messages/, () => ({ messages: [] })],
  ["GET", /^\/chat\/members$/, () => ({ members: TEAMS.map((t) => ({ owner_id: t.id, display_name: t.owner, team_name: t.name, online: t.id % 3 !== 0 })) })],
  ["GET", /^\/chat\/conversations\/\d+\/members$/, () => ({ members: TEAMS.map((t) => ({ owner_id: t.id, display_name: t.owner, chat_color: CHAT_COLORS[t.id], logo_url: null })) })],
  ["POST", /^\/chat\/conversations\/\d+\/read$/, () => ({ ok: true })],
  ["GET", /^\/presence|^\/online/, () => ({ owners: TEAMS.filter((t) => t.id % 3 !== 0).map((t) => ({ owner_id: t.id, display_name: t.owner })) })],
  ["POST", /^\/analytics/, () => ({ ok: true })],
  ["POST", /^\/events/, () => ({ ok: true })],
  ["GET", /^\/seasons\/\d+\/playoffs\/bracket$/, () => ({ season: S, nodes: [] })],
  ["GET", /^\/seasons\/\d+\/playoffs\/projected$/, () => ({ season: S, matchups: null })],
  ["GET", /^\/watch-party\/rooms$/, () => ({ open_room: { id: 1, name: "Sunday Watch Party", kind: "open", created_by_owner_id: 1, member_count: 12, conversation_id: 1, is_live: false }, private_rooms: [] })],
  ["GET", /^\/teams\/(\d+)$/, ({ m }) => { const t = T[+m[1]]; return t ? { team_id: t.id, season: S, espn_team_id: t.id, team_name: t.name, owner_id: t.id, owner_name: t.owner } : { __status: 404 }; }],
  ["GET", /^\/teams\/(\d+)\/roster/, ({ m }) => { const t = T[+m[1]]; return { team: { team_id: t.id, season: S, espn_team_id: t.id, team_name: t.name, owner_id: t.id, owner_name: t.owner }, week: WEEK, roster: rosterFor(t.id) }; }],
];
