/* ==========================================================================
   THE HUDDLE — mock data + hash router + view renderers
   Vanilla JS. No build step. No framework.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Icons (inline SVG, currentColor)
   * ------------------------------------------------------------------ */
  const ICO = {
    home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9"/></svg>',
    live: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z"/></svg>',
    team: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4 4 7l2 3-1 10h14L18 10l2-3-4-3-2 2h-4Z"/><path d="M10 4l2 2 2-2"/></svg>',
    league: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/><path d="M12 14v3M9 21h6M9 21c0-1.5 1-2 3-2s3 .5 3 2"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 8 12l7 7"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M3 11 20 4l-6 17-3-7-8-3Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Zm5 10v3H9v2h6v-2h-3v-3Z"/></svg>',
  };

  /* ------------------------------------------------------------------ *
   * Mock data
   * ------------------------------------------------------------------ */

  const WEEK_CURRENT = 7;

  const PLAYERS = {
    herbert: { id: "herbert", name: "Justin Herbert", pos: "QB", nfl: "LAC", init: "JH",
      status: "UPCOMING", statusNote: "4:05 PM ET", proj: 19.4, actual: 0,
      live: "Kicks off in the late window.", drafted: "R4, Pick 6", own: "99%",
      season: { pg: 21.6, tot: 129.8 }, trend: [24.1, 16.2, 28.4, 19.0, 14.8, 22.9] },
    bijan: { id: "bijan", name: "Bijan Robinson", pos: "RB", nfl: "ATL", init: "BR",
      status: "LIVE", statusNote: "ATL @ CAR · Q3", proj: 16.8, actual: 14.6,
      live: "14 car, 71 yds · 2 rec, 15 yds", drafted: "R1, Pick 5", own: "100%",
      season: { pg: 17.9, tot: 107.4 }, trend: [12.4, 21.0, 9.8, 24.6, 15.2, 16.6] },
    henry: { id: "henry", name: "Derrick Henry", pos: "RB", nfl: "BAL", init: "DH",
      status: "BYE", statusNote: "On bye", proj: 0, actual: 0,
      live: "Byeing this week — back in Week 8.", drafted: "R2, Pick 2", own: "100%",
      season: { pg: 16.4, tot: 98.4 }, trend: [19.8, 11.2, 22.0, 14.6, 14.6, 0] },
    chase: { id: "chase", name: "Ja'Marr Chase", pos: "WR", nfl: "CIN", init: "JC",
      status: "LIVE", statusNote: "CIN 21 – BAL 14 · Q3", proj: 18.5, actual: 21.8,
      live: "6 rec, 88 yds, 1 TD — and counting 🔥", drafted: "R1, Pick 3", own: "100%",
      season: { pg: 19.2, tot: 115.2 }, trend: [14.6, 26.8, 17.0, 12.4, 20.6, 21.8] },
    wilson: { id: "wilson", name: "Garrett Wilson", pos: "WR", nfl: "NYJ", init: "GW",
      status: "FINAL", statusNote: "NYJ 20 – NE 17 · Final", proj: 12.6, actual: 11.1,
      live: "5 rec, 61 yds — game's over, banked.", drafted: "R3, Pick 4", own: "99%",
      season: { pg: 13.8, tot: 82.8 }, trend: [9.2, 18.4, 11.0, 16.8, 10.6, 11.1] },
    kelce: { id: "kelce", name: "Travis Kelce", pos: "TE", nfl: "KC", init: "TK",
      status: "LIVE", statusNote: "BUF 24 – KC 17 · Q3", proj: 13.1, actual: 9.6,
      live: "5 rec, 46 yds — KC trying to answer.", drafted: "R5, Pick 1", own: "97%",
      season: { pg: 12.0, tot: 72.0 }, trend: [8.4, 15.2, 10.0, 9.8, 14.6, 9.6] },
    odunze: { id: "odunze", name: "Rome Odunze", pos: "WR", nfl: "CHI", init: "RO",
      status: "FINAL", statusNote: "CHI 27 – WAS 20 · Final", proj: 10.8, actual: 15.5,
      live: "4 rec, 55 yds, 1 TD — flex smash.", drafted: "R7, Pick 8", own: "88%",
      season: { pg: 10.9, tot: 65.4 }, trend: [6.4, 14.0, 8.8, 12.2, 9.0, 15.5] },
    dst: { id: "dst", name: "Broncos D/ST", pos: "DST", nfl: "DEN", init: "DEN",
      status: "FINAL", statusNote: "DEN 23 – LV 13 · Final", proj: 7.0, actual: 9.0,
      live: "2 sacks, 1 INT, 1 fumble recovery.", drafted: "R12, Pick 3", own: "64%",
      season: { pg: 8.1, tot: 48.6 }, trend: [6, 12, 4, 10, 8, 9] },
    butker: { id: "butker", name: "Harrison Butker", pos: "K", nfl: "KC", init: "HB",
      status: "LIVE", statusNote: "BUF 24 – KC 17 · Q3", proj: 8.0, actual: 8.0,
      live: "2/2 FG, 2/2 XP so far.", drafted: "R14, Pick 5", own: "71%",
      season: { pg: 8.4, tot: 50.4 }, trend: [7, 9, 6, 11, 8, 8] },
    charbonnet: { id: "charbonnet", name: "Zach Charbonnet", pos: "RB", nfl: "SEA", init: "ZC",
      status: "FINAL", statusNote: "SEA 16 – ARI 13 · Final", proj: 9.2, actual: 6.4,
      live: "11 car, 44 yds — early down work only.", drafted: "R9, Pick 1", own: "76%",
      season: { pg: 8.8, tot: 52.8 }, trend: [4.2, 10.6, 7.8, 6.0, 12.4, 6.4] },
    waddle: { id: "waddle", name: "Jaylen Waddle", pos: "WR", nfl: "MIA", init: "JW",
      status: "UPCOMING", statusNote: "4:25 PM ET", proj: 11.4, actual: 0,
      live: "Kicks off in the late window.", drafted: "R6, Pick 2", own: "93%",
      season: { pg: 11.9, tot: 71.4 }, trend: [8.4, 14.2, 9.6, 13.0, 10.8, 12.6] },
    murray: { id: "murray", name: "Kyler Murray", pos: "QB", nfl: "ARI", init: "KM",
      status: "FINAL", statusNote: "SEA 16 – ARI 13 · Final", proj: 17.0, actual: 13.2,
      live: "19/28, 198 yds, 1 TD · 6 rush, 22 yds.", drafted: "R8, Pick 6", own: "85%",
      season: { pg: 17.6, tot: 105.6 }, trend: [21.4, 12.0, 19.8, 15.6, 20.2, 13.2] },
    // opponent roster (Air Yard Sale) — display only
    stroud: { id: "stroud", name: "C.J. Stroud", pos: "QB", nfl: "HOU", init: "CS", status: "FINAL", actual: 16.8 },
    taylor: { id: "taylor", name: "Jonathan Taylor", pos: "RB", nfl: "IND", init: "JT", status: "LIVE", actual: 11.2 },
    achane: { id: "achane", name: "De'Von Achane", pos: "RB", nfl: "MIA", init: "DA", status: "UPCOMING", actual: 0 },
    nacua: { id: "nacua", name: "Puka Nacua", pos: "WR", nfl: "LAR", init: "PN", status: "FINAL", actual: 18.4 },
    smith: { id: "smith", name: "DeVonta Smith", pos: "WR", nfl: "PHI", init: "DS", status: "LIVE", actual: 8.6 },
    laporta: { id: "laporta", name: "Sam LaPorta", pos: "TE", nfl: "DET", init: "SL", status: "FINAL", actual: 12.0 },
    rice: { id: "rice", name: "Rashee Rice", pos: "FLEX", nfl: "KC", init: "RR", status: "LIVE", actual: 7.4 },
    jetsdst: { id: "jetsdst", name: "Jets D/ST", pos: "DST", nfl: "NYJ", init: "NYJ", status: "FINAL", actual: 8.0 },
    elliott: { id: "elliott", name: "Jake Elliott", pos: "K", nfl: "PHI", init: "JE", status: "FINAL", actual: 13.7 },
  };

  const MY_STARTERS = [
    { slot: "QB", id: "herbert" }, { slot: "RB", id: "bijan" }, { slot: "RB", id: "henry" },
    { slot: "WR", id: "chase" }, { slot: "WR", id: "wilson" }, { slot: "TE", id: "kelce" },
    { slot: "FLEX", id: "odunze" }, { slot: "DST", id: "dst" }, { slot: "K", id: "butker" },
  ];
  const MY_BENCH = ["charbonnet", "waddle", "murray"];

  const OPP_STARTERS = [
    { slot: "QB", id: "stroud" }, { slot: "RB", id: "taylor" }, { slot: "RB", id: "achane" },
    { slot: "WR", id: "nacua" }, { slot: "WR", id: "smith" }, { slot: "TE", id: "laporta" },
    { slot: "FLEX", id: "rice" }, { slot: "DST", id: "jetsdst" }, { slot: "K", id: "elliott" },
  ];

  const STANDINGS = [
    { rank: 1, team: "Blitzkrieg Bop", owner: "Marcus", rec: "5-1", pf: 812.4, streak: "W4", init: "BB" },
    { rank: 2, team: "Turf Kings", owner: "Tyler", rec: "4-2", pf: 798.6, streak: "W2", init: "TK", me: true },
    { rank: 3, team: "Air Yard Sale", owner: "Priya", rec: "4-2", pf: 790.4, streak: "L1", init: "AYS" },
    { rank: 4, team: "Gridiron Bandits", owner: "Sam", rec: "4-2", pf: 781.2, streak: "W1", init: "GB" },
    { rank: 5, team: "Legion of Zoom", owner: "Devon", rec: "3-3", pf: 774.0, streak: "L2", init: "LZ" },
    { rank: 6, team: "Hail Mary Poppins", owner: "Ava", rec: "3-3", pf: 766.9, streak: "W1", init: "HM" },
    { rank: 7, team: "Red Zone Rejects", owner: "Liam", rec: "3-3", pf: 758.0, streak: "L1", init: "RZ" },
    { rank: 8, team: "Sunday Scaries", owner: "Jordan", rec: "2-4", pf: 744.7, streak: "L3", init: "SS" },
    { rank: 9, team: "Fumble Rooski", owner: "Ben", rec: "2-4", pf: 730.5, streak: "W1", init: "FR" },
    { rank: 10, team: "Couch Potatoes", owner: "Nora", rec: "1-5", pf: 702.1, streak: "L4", init: "CP" },
  ];

  const FREE_AGENTS = [
    { id: "fa1", name: "Tyjae Spears", pos: "RB", nfl: "TEN", own: "41%", trend: "+18% this week", note: "Bell-cow work with starter dinged up.", suggest: 22 },
    { id: "fa2", name: "Jalen Coker", pos: "WR", nfl: "CAR", own: "23%", trend: "+11% this week", note: "Target share climbing 3 weeks running.", suggest: 12 },
    { id: "fa3", name: "Tyler Higbee", pos: "TE", nfl: "LAR", own: "34%", trend: "+9% this week", note: "Red-zone role since the trade.", suggest: 9 },
    { id: "fa4", name: "Jaylen Warren", pos: "RB", nfl: "PIT", own: "48%", trend: "+6% this week", note: "Passing-down role is safe volume.", suggest: 15 },
    { id: "fa5", name: "Cardinals D/ST", pos: "DST", nfl: "ARI", own: "19%", trend: "+14% this week", note: "Plus matchup on deck.", suggest: 4 },
  ];

  const CHAT_LEAGUE = [
    { id: "c1", name: "Marcus", team: "Blitzkrieg Bop", init: "M", time: "12:58 PM", text: "Waiver processing moved to Wednesday 8pm this week — heads up.", pinned: true, mine: false, reacts: { "👍": 6 } },
    { id: "c2", name: "Devon", team: "Legion of Zoom", init: "D", time: "1:41 PM", text: "anyone else's Bijan not showing live? app's stuck on pregame for me", mine: false, reacts: {} },
    { id: "c3", name: "Priya", team: "Air Yard Sale", init: "P", time: "1:44 PM", text: "refresh it, mine updated. also @Tyler enjoy this lead while it lasts 😏", mine: false, reacts: { "😂": 2 } },
    { id: "c4", name: "Tyler", team: "Turf Kings", init: "T", time: "1:45 PM", text: "The Sunday Massacre part 5 is writing itself honestly", mine: true, reacts: { "🔥": 3 } },
    { id: "c5", name: "Sam", team: "Gridiron Bandits", init: "S", time: "1:52 PM", text: "Chase just went off, 21 and counting 🔥", mine: false, reacts: { "🔥": 5, "😳": 1 } },
    { id: "c6", name: "Ava", team: "Hail Mary Poppins", init: "A", time: "1:58 PM", text: "I pick R1P3 next to Chase every single year and never land him. cursed", mine: false, reacts: {} },
    { id: "c7", name: "Liam", team: "Red Zone Rejects", init: "L", time: "2:03 PM", text: "Butker with a 47-yarder to open the 2nd half, that guy just doesn't miss", mine: false, reacts: { "👏": 2 } },
    { id: "c8", name: "Jordan", team: "Sunday Scaries", init: "J", time: "2:07 PM", text: "meanwhile my DST just allowed a pick-six. living up to the name today", mine: false, reacts: { "💀": 4 } },
    { id: "c9", name: "Nora", team: "Couch Potatoes", init: "N", time: "2:12 PM", text: "does anyone want to trade for literally anyone on my bench, I am begging", mine: false, reacts: { "😂": 3 } },
    { id: "c10", name: "Ben", team: "Fumble Rooski", init: "B", time: "2:15 PM", text: "PSA the highest single-week score ever in this league is still Marcus, 184.6 back in Week 6 2024. y'all aren't touching that", mine: false, reacts: {} },
    { id: "c11", name: "Marcus", team: "Blitzkrieg Bop", init: "M", time: "2:16 PM", text: "and I plan on adding to the trophy case", mine: false, reacts: { "🏆": 3 } },
  ];

  const CHAT_DM = [
    { id: "d1", name: "Priya", team: "Air Yard Sale", init: "P", time: "1:10 PM", text: "108-96 at the half is cute, we'll see where we are at the final whistle", mine: false, reacts: {} },
    { id: "d2", name: "Tyler", team: "Turf Kings", init: "T", time: "1:12 PM", text: "you're down 12 with Achane on a bye-adjacent goose egg rn, I like our odds", mine: true, reacts: {} },
    { id: "d3", name: "Priya", team: "Air Yard Sale", init: "P", time: "1:13 PM", text: "Smith's about to go nuclear watch", mine: false, reacts: {} },
    { id: "d4", name: "Tyler", team: "Turf Kings", init: "T", time: "1:15 PM", text: "we lead the all-time series 4-2, the Sunday Massacre remembers", mine: true, reacts: { "💀": 1 } },
  ];

  const seedRand = (str) => {
    let x = 0;
    for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
    x = x || 1;
    return function () {
      x = (Math.imul(1103515245, x) + 12345) >>> 0;
      return (x % 10000) / 10000;
    };
  };

  function weeklyValue(player, week) {
    if (week === WEEK_CURRENT) return { val: player.actual, live: player.status !== "FINAL" && player.status !== "BYE" };
    const rnd = seedRand(player.id + "-w" + week)();
    const base = player.proj || player.season?.pg || 10;
    const val = Math.max(0, Math.round(base * (0.55 + rnd * 0.85) * 10) / 10);
    return { val, live: false };
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  const S = {
    week: WEEK_CURRENT,
    leagueTab: "standings",
    chatTab: "league",
    lastMain: "#/home",
    claims: [],
    chatMsgs: { league: CHAT_LEAGUE.map((m) => ({ ...m, reacts: { ...m.reacts } })), dm: CHAT_DM.map((m) => ({ ...m, reacts: { ...m.reacts } })) },
    myReactions: {},
    profileOpen: false,
    notif: true,
    sound: false,
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function initials(name) {
    return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  }

  function crestStyle(seedStr) {
    const r = seedRand(seedStr);
    const h1 = Math.floor(r() * 360);
    const h2 = (h1 + 40 + Math.floor(r() * 60)) % 360;
    return `background:linear-gradient(155deg, hsl(${h1} 70% 62%), hsl(${h2} 70% 45%));`;
  }

  function crest(label, seedStr, size) {
    return `<div class="crest crest-${size}" style="${crestStyle(seedStr)}">${label}</div>`;
  }

  function statusBadge(status, note) {
    if (status === "LIVE") return `<span class="badge badge-live"><span class="pip"></span>LIVE · ${note || ""}</span>`;
    if (status === "FINAL") return `<span class="badge badge-dim">FINAL</span>`;
    if (status === "BYE") return `<span class="badge badge-ember">BYE</span>`;
    return `<span class="badge badge-gold">${note || "UPCOMING"}</span>`;
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ------------------------------------------------------------------ *
   * Router
   * ------------------------------------------------------------------ */

  function parseRoute() {
    const hash = location.hash || "#/splash";
    const parts = hash.replace(/^#\//, "").split("/");
    return { name: parts[0] || "splash", param: parts[1], hash };
  }

  function render() {
    const { name, param, hash } = parseRoute();
    const app = document.getElementById("app");
    const isShell = name !== "splash";

    if (isShell && name !== "player") S.lastMain = hash;

    let body;
    switch (name) {
      case "home": body = viewHome(); break;
      case "matchup": body = viewMatchup(); break;
      case "team": body = viewTeam(); break;
      case "league": body = viewLeague(); break;
      case "chat": body = viewChat(); break;
      case "waivers": body = viewWaivers(); break;
      case "player": body = viewPlayer(param); break;
      case "splash": body = viewSplash(); break;
      default: body = viewHome();
    }

    if (!isShell) {
      app.innerHTML = body;
      wireGlobal();
      return;
    }

    const activeTab = name === "waivers" ? "league" : (name === "player" ? tabForReturn() : name);

    app.innerHTML = `
      <div class="topbar glass glass-strong">
        <div class="brand">
          <div class="mark">TH</div>
          <div>
            <div class="word">The Huddle</div>
            <div class="subline">Week ${WEEK_CURRENT} &middot; Sunday 1:00 PM slate</div>
          </div>
        </div>
        <button class="avatar-btn" onclick="APP.openProfile()" aria-label="Profile">T</button>
      </div>
      <main id="view">
        <div class="fade-in">${body}</div>
      </main>
      ${name === "chat" ? chatInputBarHTML() : ""}
      <nav class="tabbar" id="tabbar">
        ${tabBtn("home", "Home", ICO.home, activeTab === "home")}
        ${tabBtn("matchup", "Live", ICO.live, activeTab === "matchup", true)}
        ${tabBtn("team", "Team", ICO.team, activeTab === "team")}
        ${tabBtn("league", "League", ICO.league, activeTab === "league")}
        ${tabBtn("chat", "Chat", ICO.chat, activeTab === "chat")}
      </nav>
      ${S.profileOpen ? viewProfileSheet() : ""}
    `;

    wireGlobal();
    wireTabBar();
  }

  function chatInputBarHTML() {
    return `
      <div class="chat-input-bar glass glass-strong">
        <input id="chat-compose" type="text" placeholder="Say something to the league…" />
        <button class="send-btn" onclick="APP.sendChat()">${ICO.send}</button>
      </div>
    `;
  }

  function tabForReturn() {
    const r = S.lastMain.replace("#/", "");
    return r.split("/")[0] || "home";
  }

  function tabBtn(route, label, icon, active, dot) {
    return `<button class="tab${active ? " active" : ""}" onclick="APP.nav('#/${route}')">
      <span class="ico">${icon}</span>
      <span class="lbl">${label}</span>
      ${dot ? '<span class="dot"></span>' : ""}
    </button>`;
  }

  window.addEventListener("hashchange", render);

  /* ------------------------------------------------------------------ *
   * Pointer lensing for tab bar (fine pointers only — stays static on touch)
   * ------------------------------------------------------------------ */

  function wireTabBar() {
    const bar = document.getElementById("tabbar");
    if (!bar) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    bar.classList.add("pointer-lens");
    bar.addEventListener("pointermove", (e) => {
      const rect = bar.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      bar.style.setProperty("--mx", x + "%");
      bar.style.setProperty("--my", y + "%");
    });
  }

  function wireGlobal() {
    const input = document.getElementById("chat-compose");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") APP.sendChat();
      });
    }
    const main = document.getElementById("view");
    if (main && window.__scrollChatBottom) {
      main.scrollTop = main.scrollHeight;
      window.__scrollChatBottom = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Splash
   * ------------------------------------------------------------------ */

  function viewSplash() {
    return `
    <div class="splash">
      <div class="splash-crests" aria-hidden="true">
        <div class="fc" style="width:120px;height:120px;top:8%;left:-20px;${crestStyle("bb")}"></div>
        <div class="fc" style="width:90px;height:90px;top:22%;right:-16px;${crestStyle("ays")}"></div>
        <div class="fc" style="width:70px;height:70px;bottom:30%;left:6%;${crestStyle("gb")}"></div>
        <div class="fc" style="width:150px;height:150px;bottom:-30px;right:-40px;${crestStyle("lz")}"></div>
      </div>
      <div class="splash-mark">TH</div>
      <div class="splash-word">THE HUDDLE</div>
      <p class="splash-tag">Your league. Your rivalry. Your Sunday. Ten owners, one group chat that never sleeps.</p>
      <div class="splash-card glass glass-strong">
        <div class="who">
          ${crest("TK", "turfkings", "md")}
          <div style="text-align:left">
            <div style="font-weight:700;font-size:15px;">Turf Kings</div>
            <div class="tiny text-dim">Tyler &middot; 4-2 &middot; Week 7</div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" onclick="APP.enter()">Continue as Tyler</button>
        <p class="tiny text-dim mt-8">The Weekend League &middot; 10 teams &middot; 2026 season</p>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Home
   * ------------------------------------------------------------------ */

  function viewHome() {
    const chaseLine = PLAYERS.chase;
    return `
      <div class="section" style="margin-top:6px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Week ${WEEK_CURRENT} &middot; Live</div>
            <h2>Hey Tyler 👋</h2>
          </div>
          ${statusBadge("LIVE", "Q3")}
        </div>

        <div class="glass hero-score card-tap" onclick="APP.nav('#/matchup')">
          <div class="rivalry-strip">
            <span class="badge badge-ember">${ICO.bolt} The Sunday Massacre</span>
          </div>
          <div class="hero-grid">
            <div class="hero-team">
              ${crest("TK", "turfkings", "lg")}
              <div class="nm">Turf Kings</div>
              <div class="own">You</div>
              <div class="hero-score-num mono-score" style="color:var(--gold)">108.4</div>
            </div>
            <div class="hero-vs">Q3</div>
            <div class="hero-team">
              ${crest("AYS", "ays", "lg")}
              <div class="nm">Air Yard Sale</div>
              <div class="own">Priya</div>
              <div class="hero-score-num mono-score">96.1</div>
            </div>
          </div>
          <div class="winprob">
            <div class="bar"><div class="fill-a" style="width:73%"></div><div class="fill-b" style="width:27%"></div></div>
            <div class="lbl-row"><span>Win prob 73%</span><span>Tap for gamecast &rsaquo;</span></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>League pulse</h2><button class="link-more" onclick="APP.nav('#/league')">Standings &rsaquo;</button></div>
        <div class="glass card">
          ${STANDINGS.slice(0, 4).map((t, i) => `
            <div class="row">
              <span class="rank">${t.rank}</span>
              ${crest(t.init, t.team, "sm")}
              <div style="flex:1;min-width:0;">
                <div class="small" style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.team}${t.me ? " (you)" : ""}</div>
                <div class="tiny text-dim">${t.owner} &middot; ${t.streak}</div>
              </div>
              <div class="small" style="font-weight:700;">${t.rec}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Top performer</h2></div>
        <div class="glass card card-tap" onclick="APP.openPlayer('${chaseLine.id}')">
          <div class="row" style="border:none;padding-top:0;margin-top:0;">
            ${crest(chaseLine.init, chaseLine.id, "md")}
            <div style="flex:1;min-width:0;">
              <div class="small" style="font-weight:700;">${chaseLine.name}</div>
              <div class="tiny text-dim">${chaseLine.live}</div>
            </div>
            <div class="player-pts"><div class="val" style="color:var(--gold)">${chaseLine.actual}</div><div class="lbl">pts</div></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="glass-light card" style="background:linear-gradient(155deg, rgba(232,174,77,0.14), rgba(217,98,43,0.10));">
          <div class="eyebrow">Commish's Corner</div>
          <p class="small mt-8">"${CHAT_LEAGUE[0].text}"</p>
          <p class="tiny text-dim mt-8">— Marcus, Blitzkrieg Bop</p>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Waiver Wire</h2><button class="link-more" onclick="APP.nav('#/waivers')">See all &rsaquo;</button></div>
        <div class="glass card">
          ${FREE_AGENTS.slice(0, 2).map((f) => `
            <div class="row">
              ${crest(initials(f.name), f.id, "sm")}
              <div style="flex:1;min-width:0;">
                <div class="small" style="font-weight:700;">${f.name} <span class="text-dim">&middot; ${f.pos} ${f.nfl}</span></div>
                <div class="tiny" style="color:var(--gold);">${f.trend}</div>
              </div>
              <span class="chip">${f.own} own</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>League chat</h2><button class="link-more" onclick="APP.nav('#/chat')">Open &rsaquo;</button></div>
        <div class="glass card card-tap" onclick="APP.nav('#/chat')">
          ${S.chatMsgs.league.slice(-2).map((m) => `
            <div class="row">
              ${crest(m.init, m.name, "sm")}
              <div style="flex:1;min-width:0;">
                <div class="small"><b>${m.name}</b> <span class="text-dim tiny">${m.time}</span></div>
                <div class="tiny text-dim2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.text)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>League records</h2></div>
        <div class="glass card">
          <div class="row" style="border:none;padding-top:0;margin-top:0;">
            <span style="font-size:16px;">${ICO.trophy}</span>
            <div style="flex:1;"><div class="small" style="font-weight:700;">Highest single-week score</div><div class="tiny text-dim">Blitzkrieg Bop &middot; 184.6 &middot; Week 6, 2024</div></div>
          </div>
          <div class="row">
            <span style="font-size:16px;">${ICO.bolt}</span>
            <div style="flex:1;"><div class="small" style="font-weight:700;">2026 MVP pace</div><div class="tiny text-dim">Marcus &middot; Blitzkrieg Bop</div></div>
          </div>
          <div class="row">
            <span style="font-size:16px;">💥</span>
            <div style="flex:1;"><div class="small" style="font-weight:700;">Biggest blowout ever</div><div class="tiny text-dim">187.2 – 61.4 &middot; Season 2023</div></div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Matchup / gamecast
   * ------------------------------------------------------------------ */

  const PLAYS = [
    { t: "Q3 12:41", text: "Ja'Marr Chase 34-yd TD catch from Joe Burrow — his second of the day.", live: true, who: "chase" },
    { t: "Q3 9:02", text: "Bijan Robinson picks up 11 on 2nd &amp; 8, into Carolina territory.", live: true, who: "bijan" },
    { t: "Q3 6:15", text: "Butker connects from 47 to open the third quarter scoring.", live: true, who: "butker" },
    { t: "Q2 1:58", text: "Kelce hauls in a 14-yard slant, moves the chains before half.", live: false, who: "kelce" },
    { t: "Q2 0:04", text: "Rome Odunze caps the first half with a 22-yard TD grab.", live: false, who: "odunze" },
    { t: "Q1 4:20", text: "Broncos D/ST forces a fumble on the opening drive, recovers at midfield.", live: false, who: "dst" },
  ];

  function viewMatchup() {
    const combined = MY_STARTERS.map((s, i) => ({ slot: s.slot, mine: PLAYERS[s.id], opp: PLAYERS[OPP_STARTERS[i].id] }));

    return `
      <div class="section" style="margin-top:6px;">
        <div class="glass hero-score">
          <div class="rivalry-strip">
            <span class="badge badge-ember">${ICO.bolt} The Sunday Massacre &middot; TK lead 4-2 all-time</span>
          </div>
          <div class="hero-grid">
            <div class="hero-team">
              ${crest("TK", "turfkings", "lg")}
              <div class="nm">Turf Kings</div>
              <div class="hero-score-num mono-score" style="color:var(--gold)">108.4</div>
            </div>
            <div class="hero-vs">${statusBadge("LIVE", "Q3 6:41")}</div>
            <div class="hero-team">
              ${crest("AYS", "ays", "lg")}
              <div class="nm">Air Yard Sale</div>
              <div class="hero-score-num mono-score">96.1</div>
            </div>
          </div>
          <div class="winprob">
            <div class="bar"><div class="fill-a" style="width:73%"></div><div class="fill-b" style="width:27%"></div></div>
            <div class="lbl-row"><span>Turf Kings 73%</span><span>Air Yard Sale 27%</span></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Live plays</h2></div>
        <div class="glass card">
          ${PLAYS.map((pl) => `
            <div class="play-item${pl.live ? "" : " settled"}">
              <span class="play-dot"></span>
              <div style="flex:1;">
                <div class="tiny text-dim">${pl.t}</div>
                <div class="small mt-4">${pl.text}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Starter vs. starter</h2></div>
        <div class="glass card">
          ${combined.map((row) => `
            <div class="row">
              <span class="slot-tag">${row.slot}</span>
              <div class="flex-col" style="flex:1;min-width:0;cursor:pointer;" onclick="APP.openPlayer('${row.mine.id}')">
                <span class="small" style="font-weight:700;">${row.mine.name}</span>
                <span class="tiny text-dim">${row.mine.nfl}</span>
              </div>
              <div class="mono-score" style="width:44px;text-align:center;color:var(--gold);">${row.mine.actual}</div>
              <div class="tiny text-dim" style="width:18px;text-align:center;">&ndash;</div>
              <div class="mono-score" style="width:44px;text-align:center;">${row.opp.actual}</div>
              <div class="flex-col" style="flex:1;min-width:0;text-align:right;">
                <span class="small" style="font-weight:700;">${row.opp.name}</span>
                <span class="tiny text-dim">${row.opp.nfl}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: My team
   * ------------------------------------------------------------------ */

  function viewTeam() {
    const weeks = [3, 4, 5, 6, 7];
    return `
      <div class="section" style="margin-top:6px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Turf Kings</div>
            <h2>My Team</h2>
          </div>
          <span class="badge badge-gold">4-2</span>
        </div>

        <div class="glass card" style="padding:10px 12px;">
          <div class="flex items-center justify-between" style="gap:6px;">
            ${weeks.map((w) => `<button class="btn btn-sm ${w === S.week ? "btn-primary" : "btn-ghost"}" style="flex:1;padding:0 6px;" onclick="APP.setWeek(${w})">Wk ${w}</button>`).join("")}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Starters</h2><span class="tiny text-dim">${S.week === WEEK_CURRENT ? "Live scoring" : "Final"}</span></div>
        <div class="glass card">
          ${MY_STARTERS.map((s) => {
            const p = PLAYERS[s.id];
            const wv = weeklyValue(p, S.week);
            return `
            <div class="player-row" onclick="APP.openPlayer('${p.id}')">
              <span class="slot-tag">${s.slot}</span>
              ${crest(p.init, p.id, "sm")}
              <div class="player-info">
                <div class="nm">${p.name}</div>
                <div class="meta">${p.pos} &middot; ${p.nfl} ${S.week === WEEK_CURRENT ? "&middot; " + (p.status === "BYE" ? "BYE" : p.statusNote) : ""}</div>
              </div>
              <div class="player-pts">
                <div class="val" style="${wv.live ? "color:var(--gold)" : ""}">${wv.val}</div>
                <div class="lbl">${wv.live ? "live" : "pts"}</div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Bench</h2></div>
        <div class="glass card">
          ${MY_BENCH.map((id) => {
            const p = PLAYERS[id];
            const wv = weeklyValue(p, S.week);
            return `
            <div class="player-row bench-row" onclick="APP.openPlayer('${p.id}')">
              <span class="slot-tag">BN</span>
              ${crest(p.init, p.id, "sm")}
              <div class="player-info">
                <div class="nm">${p.name}</div>
                <div class="meta">${p.pos} &middot; ${p.nfl}</div>
              </div>
              <div class="player-pts">
                <div class="val">${wv.val}</div>
                <div class="lbl">pts</div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="section">
        <div class="glass-light card">
          <div class="eyebrow">Draft recap</div>
          <p class="small mt-8">Grade <b style="color:var(--gold)">B+</b> &middot; 78th percentile. Highlight pick: Ja'Marr Chase, Round 1 Pick 3.</p>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: League (standings / waivers segmented)
   * ------------------------------------------------------------------ */

  function viewLeague() {
    S.leagueTab = "standings";
    return `
      <div class="section" style="margin-top:6px;">
        <div class="section-head">
          <div><div class="eyebrow">The Weekend League</div><h2>League</h2></div>
        </div>
        <div class="segmented">
          <button class="${S.leagueTab === "standings" ? "active" : ""}" onclick="APP.setLeagueTab('standings')">Standings</button>
          <button class="${S.leagueTab === "waivers" ? "active" : ""}" onclick="APP.nav('#/waivers')">Waiver Wire</button>
        </div>
      </div>
      ${S.leagueTab === "standings" ? standingsBlock() : ""}
    `;
  }

  function standingsBlock() {
    return `
      <div class="section">
        <div class="glass card">
          <div class="standings-table">
            ${STANDINGS.map((t) => `
              <div class="standings-row${t.me ? " me" : ""}">
                <span class="rank">${t.rank}</span>
                <div class="team-cell">
                  ${crest(t.init, t.team, "sm")}
                  <div class="name-wrap">
                    <div class="nm">${t.team}${t.me ? " (you)" : ""}</div>
                    <div class="owner">${t.owner} &middot; <span class="${t.streak[0] === "W" ? "streak-w" : "streak-l"}">${t.streak}</span></div>
                  </div>
                </div>
                <div class="rec-cell">${t.rec}</div>
                <div class="pf-cell">${t.pf} PF</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Rivalries</h2></div>
        <div class="glass card">
          <div class="row" style="border:none;padding-top:0;margin-top:0;">
            <span class="badge badge-ember">${ICO.bolt}</span>
            <div style="flex:1;">
              <div class="small" style="font-weight:700;">The Sunday Massacre</div>
              <div class="tiny text-dim">Turf Kings vs. Air Yard Sale &middot; Turf Kings lead 4-2 all-time</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Waivers
   * ------------------------------------------------------------------ */

  function viewWaivers() {
    S.leagueTab = "waivers";
    return `
      <div class="section" style="margin-top:6px;">
        <div class="section-head">
          <div><div class="eyebrow">The Weekend League</div><h2>League</h2></div>
        </div>
        <div class="segmented">
          <button onclick="APP.nav('#/league')">Standings</button>
          <button class="active">Waiver Wire</button>
        </div>
      </div>

      <div class="section">
        <div class="glass-light card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div class="small" style="font-weight:700;">Waivers process Wed, 8:00 PM</div>
            <div class="tiny text-dim">FAAB budget remaining: $86</div>
          </div>
          <span class="badge badge-gold">3d 6h</span>
        </div>
      </div>

      ${S.claims.length ? `
      <div class="section">
        <div class="section-head"><h2>My claims</h2></div>
        <div class="glass claims-strip">
          ${S.claims.map((c) => {
            const f = FREE_AGENTS.find((x) => x.id === c.id);
            return `<div class="claim-pill">
              <div class="flex items-center gap-10">
                ${crest(initials(f.name), f.id, "sm")}
                <div><div class="small" style="font-weight:700;">${f.name}</div><div class="tiny text-dim">$${c.bid} bid</div></div>
              </div>
              <button class="remove-x" onclick="APP.removeClaim('${c.id}')">${ICO.close}</button>
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}

      <div class="section">
        <div class="section-head"><h2>Available</h2></div>
        <div class="glass card">
          ${FREE_AGENTS.map((f) => {
            const claimed = S.claims.find((c) => c.id === f.id);
            return `
            <div class="waiver-row">
              <div class="waiver-top">
                ${crest(initials(f.name), f.id, "sm")}
                <div style="flex:1;min-width:0;">
                  <div class="small" style="font-weight:700;">${f.name} <span class="pos-badge" style="display:inline-flex;width:auto;padding:1px 6px;height:auto;vertical-align:middle;">${f.pos}</span></div>
                  <div class="tiny text-dim">${f.nfl} &middot; ${f.own} owned</div>
                </div>
              </div>
              <p class="tiny text-dim2 mt-8">${f.note} <span style="color:var(--gold)">${f.trend}</span></p>
              ${claimed ? `
                <div class="waiver-actions">
                  <span class="badge badge-gold">Claimed &middot; $${claimed.bid}</span>
                  <button class="btn btn-ghost btn-sm" onclick="APP.removeClaim('${f.id}')">Remove</button>
                </div>
              ` : `
                <div class="waiver-actions">
                  <input class="faab-input" type="number" min="0" max="86" id="bid-${f.id}" placeholder="$${f.suggest}" />
                  <button class="btn btn-ember btn-sm" onclick="APP.placeClaim('${f.id}')">Place Claim</button>
                </div>
              `}
            </div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Chat
   * ------------------------------------------------------------------ */

  function viewChat() {
    const msgs = S.chatMsgs[S.chatTab === "league" ? "league" : "dm"];
    window.__scrollChatBottom = true;
    return `
      <div style="margin-top:6px;">
        <div class="segmented">
          <button class="${S.chatTab === "league" ? "active" : ""}" onclick="APP.setChatTab('league')">League</button>
          <button class="${S.chatTab === "dm" ? "active" : ""}" onclick="APP.setChatTab('dm')">DMs &middot; Priya</button>
        </div>
      </div>

      <div class="chat-scroll mt-16">
        ${S.chatTab === "league" ? `
          <div class="glass pinned">
            <span class="badge badge-gold">📌 Pinned</span>
            <div style="flex:1;">
              <div class="small mt-4">${CHAT_LEAGUE[0].text}</div>
              <div class="tiny text-dim mt-4">Marcus &middot; Commish's Corner</div>
            </div>
          </div>
        ` : ""}
        ${msgs.map((m) => chatBubble(m)).join("")}
      </div>
    `;
  }

  function chatBubble(m) {
    const reacts = Object.entries(m.reacts || {});
    return `
      <div class="bubble-wrap${m.mine ? " mine" : ""}">
        ${!m.mine ? crest(m.init, m.name, "sm") : ""}
        <div>
          <div class="bubble">
            ${!m.mine ? `<div class="tiny" style="color:var(--gold);font-weight:700;margin-bottom:2px;">${m.name} <span class="text-dim" style="font-weight:500;">&middot; ${m.team}</span></div>` : ""}
            ${esc(m.text)}
          </div>
          <div class="bubble-meta">${m.time}</div>
          ${reacts.length ? `<div class="reactions">${reacts.map(([e, n]) => `<span class="reaction" onclick="APP.react('${m.id}','${e}')">${e} ${n}</span>`).join("")}</div>` : `<div class="reactions"><span class="reaction" onclick="APP.react('${m.id}','🔥')">+ 🔥</span></div>`}
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Player detail
   * ------------------------------------------------------------------ */

  function viewPlayer(id) {
    const p = PLAYERS[id];
    if (!p) return `<p class="mt-16">Player not found.</p>`;
    const trendMax = Math.max(...(p.trend || [1]));
    return `
      <div class="fade-in" style="margin-top:6px;">
        <button class="btn btn-ghost btn-sm" onclick="APP.nav('${S.lastMain}')">${ICO.back} Back</button>
        <div class="glass player-hero mt-12">
          ${crest(p.init, p.id, "lg")}
          <h1>${p.name}</h1>
          <div class="meta">${p.pos} &middot; ${p.nfl}</div>
          <div class="mt-12">${statusBadge(p.status, p.statusNote)}</div>
          <div class="stat-grid">
            <div class="stat-tile"><div class="v" style="color:var(--gold)">${p.actual}</div><div class="k">This week</div></div>
            <div class="stat-tile"><div class="v">${p.proj}</div><div class="k">Projected</div></div>
            <div class="stat-tile"><div class="v">${p.season ? p.season.pg : "-"}</div><div class="k">Pts / gm</div></div>
          </div>
        </div>

        <div class="section">
          <div class="glass card">
            <div class="eyebrow">Live</div>
            <p class="small mt-8">${p.live}</p>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h2>Last 6 weeks</h2></div>
          <div class="glass card">
            <div class="trend-bars">
              ${(p.trend || []).map((v, i) => `
                <div class="trend-bar">
                  <div class="bar" style="height:${Math.max(6, (v / trendMax) * 100)}%"></div>
                  <div class="wk">${v}</div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="section">
          <div class="glass card">
            <div class="row" style="border:none;padding-top:0;margin-top:0;">
              <div style="flex:1;"><div class="tiny text-dim">Drafted</div><div class="small" style="font-weight:700;">${p.drafted || "Undrafted"}</div></div>
              <div style="flex:1;"><div class="tiny text-dim">Rostered</div><div class="small" style="font-weight:700;">${p.own || "-"}</div></div>
              <div style="flex:1;"><div class="tiny text-dim">Season pts</div><div class="small" style="font-weight:700;">${p.season ? p.season.tot : "-"}</div></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * VIEW: Profile sheet (bonus overlay)
   * ------------------------------------------------------------------ */

  function viewProfileSheet() {
    return `
      <div class="sheet-backdrop" onclick="APP.closeProfileOuter(event)">
        <div class="sheet glass glass-strong" onclick="event.stopPropagation()">
          <div class="grabber"></div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-12">
              ${crest("T", "tyler-profile", "md")}
              <div><div style="font-weight:700;">Tyler</div><div class="tiny text-dim">Turf Kings &middot; Manager</div></div>
            </div>
            <button class="remove-x" onclick="APP.closeProfile()" aria-label="Close">${ICO.close}</button>
          </div>
          <div class="divider"></div>
          <div class="settings-row">
            <span class="small">Push notifications</span>
            <button class="switch ${S.notif ? "on" : ""}" onclick="APP.toggle('notif')"></button>
          </div>
          <div class="settings-row">
            <span class="small">Sound effects</span>
            <button class="switch ${S.sound ? "on" : ""}" onclick="APP.toggle('sound')"></button>
          </div>
          <div class="settings-row">
            <span class="small">Theme</span>
            <span class="tiny text-dim">Locker Room (warm dark)</span>
          </div>
          <div class="divider"></div>
          <button class="btn btn-ghost btn-block" onclick="APP.signOut()">Sign out</button>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * Public API (used by inline handlers)
   * ------------------------------------------------------------------ */

  window.APP = {
    nav(hash) { location.hash = hash; },
    enter() { location.hash = "#/home"; },
    openPlayer(id) {
      location.hash = "#/player/" + id;
    },
    openProfile() { S.profileOpen = true; render(); },
    closeProfileOuter(e) { if (e.target.classList.contains("sheet-backdrop")) { S.profileOpen = false; render(); } },
    closeProfile() { S.profileOpen = false; render(); },
    signOut() { S.profileOpen = false; location.hash = "#/splash"; },
    toggle(key) { S[key] = !S[key]; render(); },
    setWeek(w) { S.week = w; render(); },
    setLeagueTab(tab) { S.leagueTab = tab; if (tab === "waivers") { location.hash = "#/waivers"; } else { render(); } },
    setChatTab(tab) { S.chatTab = tab; render(); },
    react(id, emoji) {
      const list = S.chatMsgs[S.chatTab === "league" ? "league" : "dm"];
      const m = list.find((x) => x.id === id);
      if (!m) return;
      const key = id + emoji;
      if (S.myReactions[key]) {
        m.reacts[emoji] = Math.max(0, (m.reacts[emoji] || 1) - 1);
        if (!m.reacts[emoji]) delete m.reacts[emoji];
        S.myReactions[key] = false;
      } else {
        m.reacts[emoji] = (m.reacts[emoji] || 0) + 1;
        S.myReactions[key] = true;
      }
      render();
    },
    sendChat() {
      const input = document.getElementById("chat-compose");
      if (!input || !input.value.trim()) return;
      const list = S.chatMsgs[S.chatTab === "league" ? "league" : "dm"];
      list.push({
        id: "u" + Date.now(),
        name: "Tyler",
        team: "Turf Kings",
        init: "T",
        time: "Now",
        text: input.value.trim(),
        mine: true,
        reacts: {},
      });
      input.value = "";
      window.__scrollChatBottom = true;
      render();
    },
    placeClaim(id) {
      const el = document.getElementById("bid-" + id);
      const f = FREE_AGENTS.find((x) => x.id === id);
      const bid = (el && el.value) ? Number(el.value) : f.suggest;
      S.claims.push({ id, bid: bid || f.suggest });
      render();
    },
    removeClaim(id) {
      S.claims = S.claims.filter((c) => c.id !== id);
      render();
    },
  };

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  if (!location.hash) location.hash = "#/splash";
  render();
})();
