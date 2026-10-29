/* THE CLUBHOUSE — app.js — tiny hash router + vanilla renderers */
(() => {
"use strict";

const $view = document.getElementById("view");
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- MOCK DATA ---------------- */
const TEAMS = [
  { id:"blitz", name:"Blitzkrieg Bop", owner:"Marcus", w:5,l:1,t:0, pf:812.4, pa:701.2, trend:"up", init:"BB", tone:["#4a2e22","#1c1712"] },
  { id:"turf",  name:"Turf Kings",     owner:"Tyler",  w:4,l:2,t:0, pf:798.6, pa:733.9, trend:"up", init:"TK", tone:["#5a2626","#1c1712"], me:true },
  { id:"air",   name:"Air Yard Sale",  owner:"Priya",  w:4,l:2,t:0, pf:790.4, pa:744.1, trend:"down", init:"AY", tone:["#2f4a3a","#1c1712"] },
  { id:"band",  name:"Gridiron Bandits",owner:"Sam",   w:4,l:2,t:0, pf:781.2, pa:750.0, trend:"up", init:"GB", tone:["#3a3320","#1c1712"] },
  { id:"zoom",  name:"Legion of Zoom", owner:"Devon",  w:3,l:3,t:0, pf:774.0, pa:760.3, trend:"down", init:"LZ", tone:["#242c3a","#1c1712"] },
  { id:"hail",  name:"Hail Mary Poppins",owner:"Ava",  w:3,l:3,t:0, pf:766.9, pa:762.5, trend:"up", init:"HP", tone:["#40304a","#1c1712"] },
  { id:"rzr",   name:"Red Zone Rejects",owner:"Liam",  w:3,l:3,t:0, pf:758.0, pa:759.9, trend:"down", init:"RR", tone:["#4a2a30","#1c1712"] },
  { id:"scary", name:"Sunday Scaries", owner:"Jordan", w:2,l:4,t:0, pf:744.7, pa:770.8, trend:"down", init:"SS", tone:["#2a3a2f","#1c1712"] },
  { id:"fumb",  name:"Fumble Rooski",  owner:"Ben",    w:2,l:4,t:0, pf:730.5, pa:781.0, trend:"up", init:"FR", tone:["#443322","#1c1712"] },
  { id:"couch", name:"Couch Potatoes", owner:"Nora",   w:1,l:5,t:0, pf:702.1, pa:790.6, trend:"down", init:"CP", tone:["#332222","#1c1712"] },
];
const byId = (id) => TEAMS.find(t=>t.id===id);

const PLAYERS = {
  herbert:  { id:"herbert", name:"Justin Herbert", pos:"QB", team:"LAC", opp:"@ DEN", pts:24.2, proj:21.5, status:"LIVE", bio:"6th-year signal caller. 3 TD, 0 INT through three quarters today.", season:"312.4 pts · QB6 overall" },
  bijan:    { id:"bijan", name:"Bijan Robinson", pos:"RB", team:"ATL", opp:"@ CAR", pts:18.6, proj:16.0, status:"LIVE", bio:"14 carries, 71 yards, 1 receiving TD so far.", season:"188.9 pts · RB4 overall" },
  henry:    { id:"henry", name:"Derrick Henry", pos:"RB", team:"BAL", opp:"BYE", pts:0, proj:14.2, status:"BYE", bio:"On bye this week — back in Week 8.", season:"201.0 pts · RB2 overall" },
  chase:    { id:"chase", name:"Ja'Marr Chase", pos:"WR", team:"CIN", opp:"vs BAL", pts:21.1, proj:17.9, status:"LIVE", bio:"6 catches, 88 yards, 1 TD. Threatening a third straight 100-yard game.", season:"224.7 pts · WR1 overall" },
  wilson:   { id:"wilson", name:"Garrett Wilson", pos:"WR", team:"NYJ", opp:"vs MIA", pts:8.4, proj:13.0, status:"Q", bio:"Questionable with a hamstring, active and playing.", season:"149.2 pts · WR14 overall" },
  kelce:    { id:"kelce", name:"Travis Kelce", pos:"TE", team:"KC", opp:"@ BUF", pts:12.3, proj:11.0, status:"LIVE", bio:"3 catches for 41 yards, one drive still to come this half.", season:"167.5 pts · TE2 overall" },
  odunze:   { id:"odunze", name:"Rome Odunze", pos:"FLEX", team:"CHI", opp:"@ MIN", pts:9.9, proj:9.5, status:"FINAL", bio:"Finished early — 5 catches, 62 yards in the early window.", season:"118.0 pts · WR26 overall" },
  broncos:  { id:"broncos", name:"Broncos D/ST", pos:"DST", team:"DEN", opp:"vs LAC", pts:4.0, proj:6.5, status:"LIVE", bio:"1 sack, 1 forced fumble so far.", season:"91.0 pts · DST8 overall" },
  butker:   { id:"butker", name:"Harrison Butker", pos:"K", team:"KC", opp:"@ BUF", pts:6.0, proj:8.0, status:"LIVE", bio:"2/2 field goals, long of 47.", season:"98.0 pts · K5 overall" },
  charbonnet:{ id:"charbonnet", name:"Zach Charbonnet", pos:"RB", team:"SEA", opp:"@ LAR", pts:6.1, proj:8.9, status:"FINAL", bio:"Bench — 12 touches, one short TD.", season:"84.2 pts · RB30 overall" },
  waddle:   { id:"waddle", name:"Jaylen Waddle", pos:"WR", team:"MIA", opp:"@ NYJ", pts:11.3, proj:12.4, status:"LIVE", bio:"Bench — 4 catches, 61 yards, still playing.", season:"131.5 pts · WR22 overall" },
  murray:   { id:"murray", name:"Kyler Murray", pos:"QB", team:"ARI", opp:"vs SF", pts:15.8, proj:18.0, status:"FINAL", bio:"Bench — 2 total TDs in an early kickoff.", season:"196.0 pts · QB11 overall" },
};
const STARTER_ORDER = ["herbert","bijan","henry","chase","wilson","kelce","odunze","broncos","butker"];
const BENCH_ORDER = ["charbonnet","waddle","murray"];

const AWAY_TEAM = "Air Yard Sale";
const HOME_SCORE = 108.4, AWAY_SCORE = 96.1;

const CHAT = {
  pinned: { author:"Marcus", role:"Commissioner", text:"Waiver processing moved to Wednesday 8pm this week — Thursday night game changes the usual schedule." },
  messages: [
    { who:"Priya", mine:false, text:"anyone else's Bijan not showing live? refresh isn't fixing it for me", t:"1:42 PM" },
    { who:"Sam", mine:false, text:"yeah same, ESPN's feed is lagging for everyone rn", t:"1:43 PM" },
    { who:"Tyler", mine:true, text:"should sort itself out by the next drive, happens most Sundays around this time", t:"1:44 PM" },
    { who:"Ben", mine:false, text:"Chase just went off, 21 and counting 🔥", t:"1:51 PM" },
    { who:"Priya", mine:false, text:"don't remind me, he's lighting up MY defense too", t:"1:52 PM" },
  ],
};

const DRAFT_MADE = [
  { pick:1, team:"blitz", player:"Bijan Robinson", pos:"RB" },
  { pick:2, team:"air", player:"CeeDee Lamb", pos:"WR" },
  { pick:3, team:"turf", player:"Ja'Marr Chase", pos:"WR" },
  { pick:4, team:"band", player:"Christian McCaffrey", pos:"RB" },
];
const DRAFT_QUEUE = [
  { team:"zoom", player:"Justin Jefferson", pos:"WR" },
  { team:"hail", player:"Breece Hall", pos:"RB" },
  { team:"rzr", player:"Amon-Ra St. Brown", pos:"WR" },
  { team:"scary", player:"Jahmyr Gibbs", pos:"RB" },
];

const GC_PLAYS = [
  { meta:"Q3 · 8:42", text:"J. Allen pass complete to K. Coleman for 14 yards.", score:false },
  { meta:"Q3 · 9:10", text:"H. Butker 47-yd field goal is GOOD.", score:true },
  { meta:"Q3 · 11:02", text:"P. Mahomes sacked by the Broncos front three, loss of 6.", score:false },
  { meta:"Q2 · 0:14", text:"J. Chase 22-yd touchdown catch from J. Burrow.", score:true },
];

const ACTIVITY = [
  { icon:"trade", text:"Priya and Sam completed a trade — Waddle for a 2027 3rd", time:"22m ago" },
  { icon:"add", text:"Jordan dropped Zach Charbonnet, added Rachaad White", time:"41m ago" },
  { icon:"award", text:"Draft grades are live — Blitzkrieg Bop graded an A", time:"1h ago" },
  { icon:"chat", text:"12 new messages in league chat", time:"2h ago" },
];

const ICONS = {
  trade:'<path d="M7 10l-4 4 4 4M3 14h13a4 4 0 0 0 0-8h-1M17 10l4 4-4 4M21 14H8a4 4 0 0 1 0-8h1"/>',
  add:'<path d="M12 5v14M5 12h14"/>',
  award:'<circle cx="12" cy="8" r="5"/><path d="M8.5 13 7 21l5-3 5 3-1.5-8"/>',
  chat:'<path d="M4 5h16v11H8l-4 4V5Z"/>',
  send:'<path d="M3 12l18-8-6 8 6 8-18-8Z"/>',
};
const icon = (name, cls="icon") => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[name]||""}</svg>`;

const portrait = (t, size="") => `<div class="portrait ${size}" style="--tone-a:${t.tone[0]};--tone-b:${t.tone[1]}"><span class="portrait__initials">${t.init}</span></div>`;
const playerInit = (p) => p.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
const playerPortrait = (p) => `<div class="portrait" style="--tone-a:#3a2e26;--tone-b:#1c1712"><span class="portrait__initials">${playerInit(p)}</span></div>`;

/* ---------------- ROUTER ---------------- */
const routes = [
  { pattern:/^login$/, render: renderLogin, chrome:false },
  { pattern:/^home$/, render: renderHome },
  { pattern:/^league$/, render: renderLeague },
  { pattern:/^matchup$/, render: renderMatchup },
  { pattern:/^myteam$/, render: renderMyTeam },
  { pattern:/^player\/(.+)$/, render: renderPlayer },
  { pattern:/^draft$/, render: renderDraft },
  { pattern:/^gamecast$/, render: renderGamecast },
  { pattern:/^chat$/, render: renderChat },
  { pattern:/^standings$/, render: renderStandings },
  { pattern:/^activity$/, render: renderActivity },
  { pattern:/^profile$/, render: renderProfile },
];

function router(){
  let hash = location.hash.replace(/^#\//,"") || "login";
  const found = routes.find(r=>r.pattern.test(hash));
  const match = found ? hash.match(found.pattern) : null;
  const shell = found || routes[0];
  document.getElementById("masthead").hidden = shell.chrome === false;
  document.getElementById("contents-strip").hidden = shell.chrome === false;
  document.getElementById("corner-tab").hidden = shell.chrome === false || hash === "myteam";
  document.querySelectorAll(".contents-strip a").forEach(a=>{
    a.classList.toggle("active", hash.startsWith(a.dataset.route));
  });
  $view.innerHTML = `<div class="screen">${shell.render(match)}</div>`;
  window.scrollTo(0,0);
  wireScreen(hash.split("/")[0]);
  observeReveals();
}
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);

function observeReveals(){
  const els = document.querySelectorAll(".reveal");
  if (reduceMotion() || !("IntersectionObserver" in window)){
    els.forEach(el=>el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add("is-visible"); io.unobserve(e.target); } });
  }, { threshold:.12 });
  els.forEach(el=>io.observe(el));
}

/* ---------------- SCREENS ---------------- */

function renderLogin(){
  return `
  <div class="login-screen">
    <div class="masthead__kicker"><span>EST. 2019</span><span>·</span><span>10 TEAMS</span></div>
    <h1>THE<br><em style="color:var(--oxblood);font-style:normal">WEEKEND</em></h1>
    <p>Where your league lives on Sunday. Ten owners, one clubhouse, one long-running rivalry that started in 2019 and hasn't cooled off since.</p>
    <a href="#/home" class="btn btn--primary">Enter the Clubhouse</a>
    <a href="#/home" class="btn btn--ghost">I'm a guest, just show me around</a>
  </div>`;
}

function renderHome(){
  const me = byId("turf");
  const awards = `
    <div class="section reveal">
      <div class="eyebrow">The Record Book</div>
      <div class="pullquote">
        <p>184.6 — the highest score this league has ever produced, and Marcus has done it twice.</p>
        <cite>Blitzkrieg Bop, Week 6, 2024</cite>
      </div>
    </div>`;
  return `
  <div class="section" style="padding-top:22px">
    <div class="eyebrow">Your Week</div>
    <div class="matchup-hero">
      <span class="live-tag"><span class="live-dot"></span>Live · Q3</span>
      <div class="matchup-hero__vs">
        <div class="matchup-hero__team">${portrait(me)}<div class="matchup-hero__name">Turf Kings</div><div class="matchup-hero__record">4-2</div></div>
        <div class="matchup-hero__divider">vs</div>
        <div class="matchup-hero__team">${portrait(byId("air"))}<div class="matchup-hero__name">Air Yard Sale</div><div class="matchup-hero__record">4-2</div></div>
      </div>
      <div style="display:flex;justify-content:center;gap:34px;margin:8px 0 4px">
        <div class="score-huge">${HOME_SCORE}</div>
        <div class="score-huge" style="color:var(--ink-faint)">${AWAY_SCORE}</div>
      </div>
      <div class="winprob-bar"><div class="winprob-bar__fill"></div></div>
      <div class="winprob-label"><span>You're favored, 73%</span><span>Proj 121.7 – 108.9</span></div>
      <a href="#/matchup" class="btn btn--ghost">Read the full story →</a>
    </div>
  </div>
  <div class="hr--yard"></div>
  <div class="grid-editorial">
    <div>
      <div class="section reveal" style="padding-top:0">
        <div class="section-head"><h2>League Standings</h2><a href="#/standings" class="more">Full table</a></div>
        ${TEAMS.slice(0,4).map((t,i)=>standingsRow(t,i+1)).join("")}
      </div>
      <div class="section reveal">
        <div class="section-head"><h2>From the Clubhouse</h2><a href="#/chat" class="more">Join in</a></div>
        <p style="font-size:13px;color:var(--ink-dim);margin-bottom:10px">${CHAT.messages.length} new messages since kickoff.</p>
        ${CHAT.messages.slice(-2).map(m=>`<div class="bubble-row ${m.mine?'mine':''}"><div class="portrait" style="width:26px;--tone-a:#3a2e26;--tone-b:#1c1712"><span class="portrait__initials" style="font-size:10px;padding:6px">${m.who[0]}</span></div><div class="bubble"><div class="bubble__sender">${m.who}</div><div class="bubble__text">${m.text}</div></div></div>`).join("")}
      </div>
    </div>
    <div>
      ${awards}
      <div class="section reveal">
        <div class="eyebrow">Live Around the League</div>
        <div class="play-row"><div class="play-row__meta">BUF 24 – KC 17 · Q3</div>Allen finds Coleman for 14, Chiefs need a stop.</div>
        <div class="play-row is-score"><div class="play-row__meta">CIN 21 – BAL 14 · Q3</div>Chase's third straight 100-yard game is in reach.</div>
        <a href="#/gamecast" class="btn btn--ghost">Open Gamecast →</a>
      </div>
    </div>
  </div>`;
}

function standingsRow(t, rank){
  return `<div class="standings-row ${t.me?'is-me':''}">
    <div class="standings-row__rank">${rank}</div>
    ${portrait(t,"")}
    <div class="standings-row__meta"><div class="standings-row__team">${t.name}${t.me?' <span style="color:var(--ink-faint);font-weight:400">(you)</span>':''}</div><div class="standings-row__owner">${t.owner}</div></div>
    <div class="standings-row__stats"><b>${t.w}-${t.l}</b><span class="trend trend--${t.trend}">${t.trend==='up'?'▲':'▼'}</span></div>
  </div>`;
}

function renderLeague(){
  return `
  <div class="section" style="padding-top:22px">
    <div class="eyebrow">League Overview</div>
    <h2 style="font-size:28px;margin-bottom:6px">The Weekend League</h2>
    <p style="color:var(--ink-dim);font-size:13.5px;max-width:46ch">Ten owners. One clubhouse. Running since 2019, and the rivalries have only gotten more personal.</p>
  </div>
  <div class="hr--yard"></div>
  <div class="section reveal">
    <div class="section-head"><h2>This Week's Rivalry</h2></div>
    <div class="pullquote"><p>"The Sunday Massacre" — Turf Kings lead the all-time series 4-2, and Priya has not let it go since 2023.</p></div>
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>Standings</h2><a href="#/standings" class="more">Full table</a></div>
    ${TEAMS.slice(0,5).map((t,i)=>standingsRow(t,i+1)).join("")}
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>The Record Book</h2><a href="#/activity" class="more">History</a></div>
    <div class="chip chip--brass" style="margin-bottom:10px">184.6 pts — highest week ever</div><br>
    <div class="chip chip--oxblood">187.2 – 61.4 — biggest blowout, 2023</div>
  </div>`;
}

function renderMatchup(){
  const home = byId("turf"), away = byId("air");
  const rows = STARTER_ORDER.map(id=>{
    const p = PLAYERS[id];
    const opp = { herbert:19.4, bijan:12.1, henry:0, chase:14.0, wilson:9.8, kelce:8.5, odunze:7.9, broncos:5.0, butker:8.0 }[id] ?? 8;
    return `<div class="lineup-row">
      <div class="lineup-player" data-nav="player/${id}">${playerPortrait(p)}<div><div class="lineup-player__name">${p.name}</div><div class="lineup-player__pos">${p.pos} · ${p.team}</div></div><div class="lineup-player__pts">${p.pts}</div></div>
      <div class="lineup-slot">${p.pos}</div>
      <div class="lineup-player lineup-player--right"><div class="lineup-player__pts">${opp}</div><div><div class="lineup-player__name">${away.name.split(' ')[0]} starter</div><div class="lineup-player__pos">${p.pos}</div></div><div class="portrait" style="width:32px;--tone-a:${away.tone[0]};--tone-b:${away.tone[1]}"><span class="portrait__initials" style="font-size:10px;padding:6px">${away.init}</span></div></div>
    </div>`;
  }).join("");
  return `
  <div class="section" style="padding-top:22px;text-align:center">
    <span class="live-tag"><span class="live-dot"></span>Live · Q3 · 8:42</span>
    <div class="matchup-hero__vs">
      <div class="matchup-hero__team">${portrait(home)}<div class="matchup-hero__name">Turf Kings</div><div class="matchup-hero__record">4-2 · Tyler</div></div>
      <div class="matchup-hero__divider">vs</div>
      <div class="matchup-hero__team">${portrait(away)}<div class="matchup-hero__name">Air Yard Sale</div><div class="matchup-hero__record">4-2 · Priya</div></div>
    </div>
    <div style="display:flex;justify-content:center;gap:40px;margin:6px 0">
      <div class="score-mid">${HOME_SCORE}</div><div class="score-mid" style="color:var(--ink-faint)">${AWAY_SCORE}</div>
    </div>
    <div class="winprob-bar" style="max-width:320px;margin-left:auto;margin-right:auto"><div class="winprob-bar__fill"></div></div>
    <div class="winprob-label" style="max-width:320px;margin:0 auto"><span>73% win</span><span>27% win</span></div>
  </div>
  <div class="hr--yard"></div>
  <div class="section reveal">
    <div class="eyebrow">The Story So Far</div>
    <p style="font-size:14px;line-height:1.6">Turf Kings raced ahead behind an early Chase touchdown and haven't trailed since. Air Yard Sale need a big second half from their bench to keep the rivalry close — history says they usually find one.</p>
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>Starting Lineups</h2></div>
    ${rows}
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>All-Time — The Sunday Massacre</h2></div>
    <p style="font-size:13px;color:var(--ink-dim)">Turf Kings lead <b style="color:var(--ink)">4–2</b> · last met Week 4, 2025 (Turf Kings won 118.2–104.6)</p>
  </div>`;
}

function renderMyTeam(){
  const starters = STARTER_ORDER.map(id=>rosterRow(PLAYERS[id])).join("");
  const bench = BENCH_ORDER.map(id=>rosterRow(PLAYERS[id])).join("");
  return `
  <div class="section" style="padding-top:22px">
    <div class="eyebrow">My Team</div>
    <h2 style="font-size:26px">Turf Kings</h2>
    <p style="color:var(--ink-dim);font-size:12.5px">Week 7 · 98.2 pts so far</p>
  </div>
  <div class="roster-divider">Starters</div>
  ${starters}
  <div class="roster-divider">Bench</div>
  ${bench}`;
}
function rosterRow(p){
  return `<div class="roster-row" data-nav="player/${p.id}">
    ${playerPortrait(p)}
    <div class="roster-row__body"><div class="roster-row__name">${p.name}</div><div class="roster-row__sub">${p.pos} · ${p.team} · ${p.opp}${p.status==='LIVE'?' <span class="chip chip--oxblood" style="margin-left:6px;padding:1px 6px">LIVE</span>':''}${p.status==='Q'?' <span class="chip" style="margin-left:6px;padding:1px 6px">Q</span>':''}</div></div>
    <div class="roster-row__pts"><b>${p.pts}</b><span>Proj ${p.proj}</span></div>
  </div>`;
}

function renderPlayer(match){
  const p = PLAYERS[match[1]] || PLAYERS.herbert;
  return `
  <div class="section" style="padding-top:22px">
    <a href="#/myteam" class="btn btn--ghost">← Back to Team</a>
    <div class="grid-editorial" style="margin-top:16px">
      <div>
        <div class="flip-outer" style="width:180px;aspect-ratio:3/4" id="flip-outer">
          <div class="flip-inner" id="flip-inner">
            <div class="flip-face">${playerPortrait(p)}</div>
            <div class="flip-face flip-face--back">
              <div class="eyebrow" style="color:var(--brass)">Season</div>
              <div style="font-family:var(--serif);font-size:15px">${p.season}</div>
              <div class="hr" style="border-color:rgba(244,239,228,.15);margin:10px 0"></div>
              <div class="eyebrow" style="color:var(--brass)">Today</div>
              <div style="font-size:13px;line-height:1.5">${p.bio}</div>
            </div>
          </div>
        </div>
        <div class="flip-hint">Tap the card to flip</div>
      </div>
      <div>
        <div class="eyebrow">${p.pos} · ${p.team}</div>
        <h2 style="font-size:32px;margin-bottom:4px">${p.name}</h2>
        <p style="color:var(--ink-dim);font-size:13px;margin-bottom:16px">${p.opp} · ${p.status}</p>
        <div style="display:flex;gap:28px;margin-bottom:18px">
          <div><div class="score-mid">${p.pts}</div><div style="font-size:11px;color:var(--ink-faint)">Points today</div></div>
          <div><div class="score-mid" style="color:var(--ink-faint)">${p.proj}</div><div style="font-size:11px;color:var(--ink-faint)">Projected</div></div>
        </div>
        <div class="pullquote"><p>${p.bio}</p></div>
      </div>
    </div>
  </div>`;
}

function renderDraft(){
  return `
  <div class="section" style="padding-top:22px">
    <div class="eyebrow">Draft Room · Archived, August 2026</div>
    <h2 style="font-size:26px">The 2026 Draft</h2>
  </div>
  <div class="draft-clock">
    <div><div style="font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em">On the clock</div><div class="score-mid" id="draft-onclock" style="font-size:22px">Legion of Zoom</div></div>
    <button class="btn btn--outline" id="draft-sim">Simulate Next Pick</button>
  </div>
  <div class="section reveal" style="padding-top:0">
    <div class="section-head"><h2>Recent Picks</h2></div>
    <div id="draft-picks">
      ${DRAFT_MADE.slice().reverse().map(draftRow).join("")}
    </div>
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>Best Available</h2></div>
    <div class="avail-row"><div><div class="avail-row__name">Justin Jefferson</div><div class="avail-row__meta">WR · MIN</div></div><span class="chip">1</span></div>
    <div class="avail-row"><div><div class="avail-row__name">Breece Hall</div><div class="avail-row__meta">RB · NYJ</div></div><span class="chip">2</span></div>
    <div class="avail-row"><div><div class="avail-row__name">Amon-Ra St. Brown</div><div class="avail-row__meta">WR · DET</div></div><span class="chip">3</span></div>
  </div>`;
}
function draftRow(d, isNew){
  const t = byId(d.team);
  return `<div class="draft-pick-row ${isNew?'is-new':''}"><div class="draft-pick-row__num">${d.pick}</div>${portrait(t)}<div style="flex:1"><div style="font-weight:700;font-size:13px">${d.player}</div><div style="font-size:11px;color:var(--ink-dim)">${t.name}</div></div><span class="chip">${d.pos}</span></div>`;
}

function renderGamecast(){
  return `
  <div class="section" style="padding-top:22px">
    <a href="#/home" class="btn btn--ghost">← Back</a>
    <div class="eyebrow" style="margin-top:10px">Gamecast</div>
    <h2 style="font-size:24px">Bills @ Chiefs</h2>
  </div>
  <div class="gc-score">
    <div class="gc-team"><div class="portrait" style="width:52px;--tone-a:#2a3a5a;--tone-b:#1c1712"><span class="portrait__initials">BUF</span></div><div class="score-mid">24</div></div>
    <span class="live-tag"><span class="live-dot"></span>Q3 · 8:42</span>
    <div class="gc-team"><div class="portrait" style="width:52px;--tone-a:#5a2a2a;--tone-b:#1c1712"><span class="portrait__initials">KC</span></div><div class="score-mid">17</div></div>
  </div>
  <p style="text-align:center;font-size:12.5px;color:var(--ink-dim)">BUF ball · 2nd &amp; 6 at KC 34</p>
  <div class="field-strip"><div class="field-strip__marks"></div><div class="field-strip__ball" style="left:66%"></div></div>
  <div class="section reveal">
    <div class="section-head"><h2>Fantasy Impact</h2></div>
    <div class="roster-row"><div class="portrait" style="width:34px;--tone-a:#3a2e26;--tone-b:#1c1712"><span class="portrait__initials" style="font-size:11px;padding:8px">TK</span></div><div class="roster-row__body"><div class="roster-row__name">Travis Kelce</div><div class="roster-row__sub">6-yd reception, 3rd down conversion</div></div><div class="roster-row__pts"><b style="color:var(--forest)">+1.6</b></div></div>
    <div class="roster-row"><div class="portrait" style="width:34px;--tone-a:#3a2e26;--tone-b:#1c1712"><span class="portrait__initials" style="font-size:11px;padding:8px">HB</span></div><div class="roster-row__body"><div class="roster-row__name">Harrison Butker</div><div class="roster-row__sub">42-yd field goal, good</div></div><div class="roster-row__pts"><b style="color:var(--forest)">+3.0</b></div></div>
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>Play by Play</h2></div>
    ${GC_PLAYS.map(p=>`<div class="play-row ${p.score?'is-score':''}"><div class="play-row__meta">${p.meta}</div>${p.text}</div>`).join("")}
  </div>`;
}

function renderChat(){
  return `
  <div class="section" style="padding-top:22px;padding-bottom:0">
    <div class="eyebrow">The Clubhouse</div>
    <h2 style="font-size:24px">League Chat</h2>
    <div class="pinned-note"><b>Pinned · Commish's Corner</b>${CHAT.pinned.text}</div>
  </div>
  <div class="chat-thread" id="chat-thread">
    ${CHAT.messages.map(chatBubble).join("")}
  </div>
  <div class="composer">
    <input type="text" id="chat-input" placeholder="Say something to the league…" maxlength="240">
    <button id="chat-send" aria-label="Send">${icon("send")}</button>
  </div>`;
}
function chatBubble(m){
  return `<div class="bubble-row ${m.mine?'mine':''}"><div class="portrait" style="width:26px;--tone-a:#3a2e26;--tone-b:#1c1712"><span class="portrait__initials" style="font-size:10px;padding:6px">${m.who[0]}</span></div><div><div class="bubble"><div class="bubble__sender">${m.who}</div><div class="bubble__text">${m.text}</div></div><div class="bubble__time">${m.t}</div></div></div>`;
}

function renderStandings(){
  return `
  <div class="section" style="padding-top:22px">
    <div class="eyebrow">Week 7</div>
    <h2 style="font-size:26px">Standings</h2>
  </div>
  <div class="section reveal" style="padding-top:0">
    ${TEAMS.map((t,i)=>standingsRow(t,i+1)).join("")}
  </div>`;
}

function renderActivity(){
  return `
  <div class="section" style="padding-top:22px">
    <div class="eyebrow">League Activity</div>
    <h2 style="font-size:26px">What Happened</h2>
  </div>
  <div class="section reveal" style="padding-top:0">
    ${ACTIVITY.map(a=>`<div class="activity-row"><div class="activity-row__icon">${icon(a.icon)}</div><div><div class="activity-row__body">${a.text}</div><div class="activity-row__time">${a.time}</div></div></div>`).join("")}
  </div>`;
}

function renderProfile(){
  return `
  <div class="section" style="padding-top:22px;text-align:center">
    <div class="portrait" style="width:72px;margin:0 auto 12px;--tone-a:#5a2626;--tone-b:#1c1712"><span class="portrait__initials">TK</span></div>
    <h2 style="font-size:22px">Tyler</h2>
    <p style="color:var(--ink-dim);font-size:12.5px">Turf Kings · Member since 2019</p>
  </div>
  <div class="section reveal">
    <div class="section-head"><h2>Preferences</h2></div>
    <div class="settings-row"><span>Game-day alerts</span><button class="toggle on" role="switch" aria-checked="true" aria-label="Game-day alerts" data-toggle><span class="toggle__knob"></span></button></div>
    <div class="settings-row"><span>Chat notifications</span><button class="toggle on" role="switch" aria-checked="true" aria-label="Chat notifications" data-toggle><span class="toggle__knob"></span></button></div>
    <div class="settings-row"><span>Trade offers by email</span><button class="toggle" role="switch" aria-checked="false" aria-label="Trade offers by email" data-toggle><span class="toggle__knob"></span></button></div>
  </div>
  <div class="section reveal">
    <a href="#/login" class="btn btn--outline btn--block">Sign out</a>
  </div>`;
}

/* ---------------- INTERACTIONS ---------------- */
function wireScreen(name){
  $view.querySelectorAll("[data-nav]").forEach(el=>{
    el.addEventListener("click", ()=>{ location.hash = "#/" + el.dataset.nav; });
  });
  $view.querySelectorAll("[data-toggle]").forEach(el=>{
    el.addEventListener("click", ()=>{
      const on = el.classList.toggle("on");
      el.setAttribute("aria-checked", String(on));
    });
  });

  if (name === "player"){
    const outer = document.getElementById("flip-outer");
    const inner = document.getElementById("flip-inner");
    if (outer) outer.addEventListener("click", ()=> inner.classList.toggle("is-flipped"));
  }

  if (name === "chat"){
    const input = document.getElementById("chat-input");
    const send = document.getElementById("chat-send");
    const thread = document.getElementById("chat-thread");
    const doSend = () => {
      const text = input.value.trim();
      if (!text) return;
      const now = new Date();
      const msg = { who:"Tyler", mine:true, text, t: now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) };
      CHAT.messages.push(msg);
      thread.insertAdjacentHTML("beforeend", chatBubble(msg));
      input.value = "";
      thread.scrollTop = thread.scrollHeight;
    };
    send.addEventListener("click", doSend);
    input.addEventListener("keydown", (e)=>{ if (e.key === "Enter") doSend(); });
  }

  if (name === "draft"){
    const btn = document.getElementById("draft-sim");
    const list = document.getElementById("draft-picks");
    const onclock = document.getElementById("draft-onclock");
    if (btn) btn.addEventListener("click", ()=>{
      const next = DRAFT_QUEUE.shift();
      if (!next){ btn.disabled = true; btn.textContent = "Draft Complete"; onclock.textContent = "—"; return; }
      const pickNum = DRAFT_MADE.length + 1;
      const rec = { pick:pickNum, team:next.team, player:next.player, pos:next.pos };
      DRAFT_MADE.push(rec);
      list.insertAdjacentHTML("afterbegin", draftRow(rec, true));
      const upcoming = DRAFT_QUEUE[0];
      onclock.textContent = upcoming ? byId(upcoming.team).name : "Draft Complete";
      if (!DRAFT_QUEUE.length){ btn.disabled = true; btn.textContent = "Draft Complete"; }
    });
  }
}

})();
