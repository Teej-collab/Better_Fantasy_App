/* ============================================================
   UNDER THE LIGHTS — hash-router SPA, vanilla JS, zero deps.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     MOCK DATA — anchored to the shared league reference:
     The Weekend League · 10 teams · 2026 · Week 7, Sun 1pm slate live
     --------------------------------------------------------- */

  var LEAGUE = { name: 'The Weekend League', season: 2026, week: 7 };

  var TEAMS = [
    { id: 'blitzkrieg', name: 'Blitzkrieg Bop',     owner: 'Marcus', record: '5-1', pf: 812.4, streak: 'W3' },
    { id: 'turfkings',  name: 'Turf Kings',         owner: 'Tyler',  record: '4-2', pf: 798.6, streak: 'W1', isUser: true },
    { id: 'airyard',    name: 'Air Yard Sale',      owner: 'Priya',  record: '4-2', pf: 790.4, streak: 'L1' },
    { id: 'bandits',    name: 'Gridiron Bandits',   owner: 'Sam',    record: '4-2', pf: 781.2, streak: 'W2' },
    { id: 'zoom',       name: 'Legion of Zoom',     owner: 'Devon',  record: '3-3', pf: 774.0, streak: 'L2' },
    { id: 'poppins',    name: 'Hail Mary Poppins',  owner: 'Ava',    record: '3-3', pf: 766.9, streak: 'W1' },
    { id: 'rejects',    name: 'Red Zone Rejects',   owner: 'Liam',   record: '3-3', pf: 758.0, streak: 'L1' },
    { id: 'scaries',    name: 'Sunday Scaries',     owner: 'Jordan', record: '2-4', pf: 744.7, streak: 'L3' },
    { id: 'rooski',     name: 'Fumble Rooski',      owner: 'Ben',    record: '2-4', pf: 730.5, streak: 'W1' },
    { id: 'potatoes',   name: 'Couch Potatoes',     owner: 'Nora',   record: '1-5', pf: 702.1, streak: 'L4' }
  ];

  var LIVE_MATCHUP = {
    home: TEAMS[1], away: TEAMS[2], // Turf Kings vs Air Yard Sale
    homeScore: 108.4, awayScore: 96.1,
    homeWinProb: 73, quarter: 'Q3', clock: '4:12',
    rivalry: 'The Sunday Massacre', rivalryRecord: 'Turf Kings lead all-time 4-2'
  };

  var NFL_GAMES = [
    { id: 'buf-kc',  away: 'BUF', as: 24, home: 'KC',  hs: 17, status: 'Q3 · 8:42', note: 'BUF ball, 2nd & 6 at KC 34' },
    { id: 'cin-bal', away: 'CIN', as: 21, home: 'BAL', hs: 14, status: 'Q3 · Live', note: "Chase 6 rec, 88 yds, 1 TD" },
    { id: 'atl-car', away: 'ATL', as: 17, home: 'CAR', hs: 13, status: 'Q3',        note: 'Bijan 14 car, 71 yds' },
    { id: 'dal-phi', away: 'DAL', as: 10, home: 'PHI', hs: 13, status: 'Q2',        note: '' },
    { id: 'lac-ten', away: 'LAC', as: 17, home: 'TEN', hs: 9,  status: 'Q2',        note: 'Herbert 2 TD passes' },
    { id: 'nyj-ne',  away: 'NYJ', as: 9,  home: 'NE',  hs: 6,  status: 'Q1',        note: '' },
    { id: 'den-lv',  away: 'DEN', as: 13, home: 'LV',  hs: 6,  status: 'Q3',        note: 'Broncos DST: 2 sacks, 1 INT' }
  ];

  var PLAYERS = {
    herbert:  { id:'herbert',  name:'Justin Herbert',  pos:'QB',  team:'LAC', opp:'@ TEN', status:'live', proj:19.2, actual:16.8,
      stats:[['CMP/ATT','21/28'],['YDS','241'],['TD','2']], last5:[24.1,17.6,29.8,15.2,21.0],
      blurb:'Two touchdown passes through three quarters against a Titans defense missing its top corner.' },
    bijan:    { id:'bijan',    name:'Bijan Robinson',  pos:'RB',  team:'ATL', opp:'@ CAR', status:'live', proj:17.8, actual:14.9,
      stats:[['CAR','14'],['YDS','71'],['TD','0']], last5:[19.4,22.1,11.0,26.3,14.9],
      blurb:'Averaging 5.1 yards a carry, still goal-line work to come with Atlanta up a score.' },
    henry:    { id:'henry',    name:'Derrick Henry',   pos:'RB',  team:'BAL', opp:'BYE',  status:'bye',  proj:0,    actual:0,
      stats:[['CAR','—'],['YDS','—'],['TD','—']], last5:[18.2,9.4,24.0,16.8,0],
      blurb:'On bye this week — Ravens are off, back in the lineup Week 8 vs CIN.' },
    chase:    { id:'chase',    name:"Ja'Marr Chase",   pos:'WR',  team:'CIN', opp:'vs BAL', status:'live', proj:16.4, actual:22.8,
      stats:[['REC','6'],['YDS','88'],['TD','1']], last5:[14.2,31.6,9.8,18.4,22.8],
      blurb:"Blown the projection out of the water — a 41-yard house call in the second quarter and still going in the red zone." },
    wilson:   { id:'wilson',   name:'Garrett Wilson',  pos:'WR',  team:'NYJ', opp:'@ NE',  status:'live', proj:13.1, actual:6.2,
      stats:[['REC','3'],['YDS','42'],['TD','0']], last5:[16.0,8.4,21.2,11.6,6.2],
      blurb:'Quiet first half in a low-scoring slog — still the clear first read once the Jets need a chunk play.' },
    kelce:    { id:'kelce',    name:'Travis Kelce',    pos:'TE',  team:'KC',  opp:'@ BUF', status:'live', proj:12.6, actual:9.4,
      stats:[['REC','5'],['YDS','54'],['TD','0']], last5:[11.4,7.8,15.2,9.0,9.4],
      blurb:'Chain-mover role tonight — five catches, none longer than 16 yards, in a track-meet shootout.' },
    odunze:   { id:'odunze',   name:'Rome Odunze',     pos:'WR',  team:'CHI', opp:'vs WAS', status:'upcoming', proj:11.0, actual:0,
      stats:[['REC','—'],['YDS','—'],['TD','—']], last5:[9.2,14.6,6.0,17.8,10.4],
      blurb:'Late window kickoff — Chicago favored by 3 at home, expect a heavy target share.' },
    butker:   { id:'butker',   name:'Harrison Butker', pos:'K',   team:'KC',  opp:'@ BUF', status:'live', proj:8.0,  actual:7.0,
      stats:[['FG','2/2'],['LNG','48'],['XP','1/1']], last5:[9.0,6.0,11.0,7.0,7.0],
      blurb:'A 48-yarder and a chip shot so far in a game that keeps finding the red zone.' },
    broncos:  { id:'broncos',  name:'Broncos D/ST',    pos:'DST', team:'DEN', opp:'vs LV', status:'live', proj:7.5,  actual:11.0,
      stats:[['SACK','2'],['INT','1'],['PA','6']], last5:[6.0,14.0,4.0,9.0,11.0],
      blurb:'Two sacks and a pick-six-that-wasn’t (down at the 3) — Raiders offense has found nothing.' },
    charbonnet:{ id:'charbonnet', name:'Zach Charbonnet', pos:'RB', team:'SEA', opp:'vs LAR', status:'bench', proj:8.4, actual:5.1,
      stats:[['CAR','9'],['YDS','38'],['TD','0']], last5:[6.4,11.0,4.8,9.6,5.1],
      blurb:'Complementary role behind the early-down back — flex-worthy only in points-per-reception weeks.' },
    waddle:   { id:'waddle',   name:'Jaylen Waddle',   pos:'WR',  team:'MIA', opp:'@ IND', status:'bench', proj:10.8, actual:0,
      stats:[['REC','—'],['YDS','—'],['TD','—']], last5:[13.4,7.2,16.8,5.4,12.0],
      blurb:'Late slate kickoff, questionable tag cleared Friday — trending toward a full workload.' },
    murray:   { id:'murray',   name:'Kyler Murray',    pos:'QB',  team:'ARI', opp:'vs SF', status:'bench', proj:17.0, actual:0,
      stats:[['CMP/ATT','—'],['YDS','—'],['TD','—']], last5:[21.0,14.6,19.8,22.4,16.0],
      blurb:'Streaming option if Herbert’s matchup ever sours — has cleared 18 fantasy points in four of six.' }
  };

  var TURF_KINGS_LINEUP = {
    starters: [
      { slot: 'QB',   id: 'herbert' },
      { slot: 'RB',   id: 'bijan' },
      { slot: 'RB',   id: 'henry' },
      { slot: 'WR',   id: 'chase' },
      { slot: 'WR',   id: 'wilson' },
      { slot: 'TE',   id: 'kelce' },
      { slot: 'FLEX', id: 'odunze' },
      { slot: 'DST',  id: 'broncos' },
      { slot: 'K',    id: 'butker' }
    ],
    bench: ['charbonnet', 'waddle', 'murray']
  };

  var WAIVERS = [
    { id: 'spears',   name: 'Tyjae Spears',    pos: 'RB', team: 'TEN', trend: '+18% rostered this week', blurb: 'Lead back role trending up after Sunday’s workload.', suggestedBid: 14 },
    { id: 'warren',   name: 'Jaylen Warren',   pos: 'RB', team: 'PIT', trend: '+11% rostered this week', blurb: 'Passing-down back seeing more early-down run too.', suggestedBid: 9 },
    { id: 'shaheed',  name: 'Rashid Shaheed',  pos: 'WR', team: 'NO',  trend: '+9% rostered this week',  blurb: 'Deep-threat role expanding with the No. 1 hurt.', suggestedBid: 6 },
    { id: 'doubs',    name: 'Romeo Doubs',     pos: 'WR', team: 'GB',  trend: '+6% rostered this week',  blurb: 'Two touchdowns in the last three games.', suggestedBid: 5 },
    { id: 'nix',      name: 'Bo Nix',          pos: 'QB', team: 'DEN', trend: '+4% rostered this week',  blurb: 'Streamer option with a juicy Week 8 matchup on deck.', suggestedBid: 3 }
  ];

  var FAAB = { budget: 100, spent: 53 };

  var CHAT = [
    { id: 1, from: 'Priya',  team: 'Air Yard Sale', mine: false, time: '1:42 PM', text: "anyone else's Bijan not showing live? app's stuck at 11.0" },
    { id: 2, from: 'Tyler',  team: 'Turf Kings',     mine: true,  time: '1:44 PM', text: 'refresh — mine just jumped, he broke a 20-yarder' },
    { id: 3, from: 'Tyler',  team: 'Turf Kings',     mine: true,  time: '2:15 PM', text: 'Chase just went off, 21 and counting 🔥' },
    { id: 4, from: 'Priya',  team: 'Air Yard Sale',  mine: false, time: '2:16 PM', text: 'yeah yeah rub it in, still Q3' },
    { id: 5, from: 'Sam',    team: 'Gridiron Bandits', mine: false, time: '2:20 PM', text: 'Turf Kings running away with this one, 73% win prob and climbing' },
    { id: 6, from: 'Priya',  team: 'Air Yard Sale',  mine: false, time: '2:21 PM', text: 'garrett wilson wake UP i need you' }
  ];

  var PINNED = { from: 'Marcus', team: 'Commish’s Corner', text: 'Waiver processing moved to Wednesday 8pm this week.' };

  var RECORDS = {
    highWeek: { team: 'Blitzkrieg Bop', pts: 184.6, when: 'Week 6, 2024' },
    mvpPace: 'Marcus (Blitzkrieg Bop)',
    blowout: { score: '187.2–61.4', when: 'Season 2023' }
  };

  /* ---------------------------------------------------------
     STATE
     --------------------------------------------------------- */
  var state = {
    matchupTab: 'mine',
    playFeedExpanded: false,
    standingsOpen: null,
    sheetPlayer: null,
    myClaims: [],
    chat: CHAT.slice()
  };

  /* ---------------------------------------------------------
     ICONS
     --------------------------------------------------------- */
  var ICON = {
    home:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>',
    live:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M7 8a7 7 0 0 0 0 8M17 8a7 7 0 0 1 0 8M4 4a12 12 0 0 0 0 16M20 4a12 12 0 0 1 0 16"/></svg>',
    team:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 6v3l3-1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8l3 1V6l-4-3-3 2h-2z"/></svg>',
    league:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>',
    chat:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5z"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 8 12l7 7"/></svg>',
    chev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    send:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    tag:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10 12 2H4v8l8 8 8-8z"/><circle cx="7.5" cy="6.5" r="1"/></svg>'
  };

  /* ---------------------------------------------------------
     HELPERS
     --------------------------------------------------------- */
  function initials(name) {
    return name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
  }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function teamById(id) { return TEAMS.filter(function (t) { return t.id === id; })[0]; }
  function playerById(id) { return PLAYERS[id]; }
  function statusChip(status) {
    if (status === 'live') return '<span class="chip chip-live"><span class="live-dot"></span>Live</span>';
    if (status === 'bye') return '<span class="chip">Bye</span>';
    if (status === 'bench') return '<span class="chip">Bench</span>';
    return '<span class="chip">Upcoming</span>';
  }

  function sparkline(points, w, h) {
    var max = Math.max.apply(null, points.concat([1]));
    var min = 0;
    var stepX = w / (points.length - 1);
    var coords = points.map(function (p, i) {
      var x = i * stepX;
      var y = h - ((p - min) / (max - min || 1)) * (h - 8) - 4;
      return [x, y];
    });
    var path = coords.map(function (c, i) { return (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ');
    var last = coords[coords.length - 1];
    var area = path + ' L' + w + ',' + h + ' L0,' + h + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none">' +
      '<path d="' + area + '" fill="rgba(255,182,39,0.14)" stroke="none"></path>' +
      '<path d="' + path + '" fill="none" stroke="#FFB627" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5" fill="#FFB627"></circle>' +
      '</svg>';
  }

  /* ---------------------------------------------------------
     SHELL
     --------------------------------------------------------- */
  var TABS = [
    { route: '#/home',    icon: 'home',   label: 'Home' },
    { route: '#/matchup', icon: 'live',   label: 'Live' },
    { route: '#/team',    icon: 'team',   label: 'Team' },
    { route: '#/league',  icon: 'league', label: 'League' },
    { route: '#/chat',    icon: 'chat',   label: 'Chat' }
  ];

  function tabbarHtml(active) {
    return '<nav class="tabbar glass">' + TABS.map(function (t) {
      var isActive = active === t.route;
      return '<a class="tab' + (isActive ? ' active' : '') + '" href="' + t.route + '">' +
        ICON[t.icon] + '<span>' + t.label + '</span>' +
        '<span class="tab-dot"></span></a>';
    }).join('') + '</nav>';
  }

  function topbarHtml(title, opts) {
    opts = opts || {};
    var left = opts.back
      ? '<a class="icon-btn" href="' + opts.back + '">' + ICON.back + '</a>'
      : '<span class="avatar">TK</span>';
    var right = opts.right || '';
    return '<header class="topbar glass">' +
      '<div class="row">' + left + '</div>' +
      '<div class="wordmark">' + (opts.wordmark ? 'THE <em>WEEKEND</em>' : esc(title)) + '</div>' +
      '<div class="row">' + right + '</div>' +
      '</header>';
  }

  function shell(activeTab, topbar, inner) {
    return '<div class="atmosphere"></div>' +
      topbar +
      '<main class="screen">' + inner + '</main>' +
      (activeTab ? tabbarHtml(activeTab) : '');
  }

  /* ---------------------------------------------------------
     VIEW: SPLASH
     --------------------------------------------------------- */
  function viewSplash() {
    var html =
      '<div class="atmosphere"></div>' +
      '<div class="splash">' +
        '<div class="stack gap-3">' +
          '<p class="label center" style="letter-spacing:.18em">' + LEAGUE.season + ' SEASON &middot; WEEK ' + LEAGUE.week + '</p>' +
          '<h1 class="splash-word">UNDER<br>THE <em>LIGHTS</em></h1>' +
          '<p class="splash-clock num" id="kickoff-clock">KICKOFF IN <span class="t">--:--:--</span></p>' +
        '</div>' +
        '<div class="field-graphic"></div>' +
        '<div class="stack gap-4">' +
          '<div class="card-glass glass" style="padding:18px;border-radius:24px;">' +
            '<input class="bid-input" style="font-family:var(--font-body);font-size:15px;font-weight:600;text-align:left;height:48px;" type="email" placeholder="you@theweekendleague.com" />' +
          '</div>' +
          '<a class="btn btn-primary btn-block" href="#/home">Enter the League</a>' +
          '<a class="btn btn-ghost btn-block" href="#/home">Continue as Guest</a>' +
          '<p class="text-sm muted center">The Weekend League &middot; 10 teams &middot; Est. 2021</p>' +
        '</div>' +
      '</div>';
    return html;
  }

  /* ---------------------------------------------------------
     VIEW: HOME
     --------------------------------------------------------- */
  function viewHome() {
    var m = LIVE_MATCHUP;
    var top3 = TEAMS.slice(0, 3);
    var latestChat = state.chat[state.chat.length - 1];

    var inner =
      '<section class="ticker-wrap mt-3">' +
        '<div class="ticker">' + NFL_GAMES.map(tickerCard).join('') + '</div>' +
      '</section>' +

      '<div class="mx-4 mt-3 glass score-hero tap" data-nav="#/matchup">' +
        '<div class="row between">' +
          '<span class="chip chip-live"><span class="live-dot"></span>' + m.quarter + ' &middot; ' + m.clock + '</span>' +
          '<span class="label">WEEK ' + LEAGUE.week + '</span>' +
        '</div>' +
        '<div class="teams mt-4">' +
          '<div class="team-col">' +
            '<span class="label">' + esc(m.home.name) + '</span>' +
            '<span class="score lead num">' + fmt1(m.homeScore) + '</span>' +
          '</div>' +
          '<div class="vs">VS</div>' +
          '<div class="team-col right">' +
            '<span class="label">' + esc(m.away.name) + '</span>' +
            '<span class="score num">' + fmt1(m.awayScore) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="winprob">' +
          '<div class="row between text-sm muted mb-2"><span>Win probability</span><span class="num">' + m.homeWinProb + '%</span></div>' +
          '<div class="winprob-track"><div class="winprob-fill" style="width:' + m.homeWinProb + '%"></div></div>' +
        '</div>' +
        '<p class="text-sm muted mt-4">&ldquo;' + m.rivalry + '&rdquo; &middot; ' + m.rivalryRecord + '</p>' +
      '</div>' +

      '<div class="section-head"><h2>League pulse</h2><a href="#/league">Standings <span></span></a></div>' +
      '<div class="mx-4 card">' +
        top3.map(function (t, i) { return standingsRow(t, i + 1, false); }).join('') +
      '</div>' +

      '<div class="section-head"><h2>Waiver wire</h2><a href="#/waivers">See all</a></div>' +
      '<div class="mx-4 card-glass glass tap" style="padding:16px;" data-nav="#/waivers">' +
        '<div class="row between">' +
          '<div>' +
            '<p class="player-name">FAAB remaining</p>' +
            '<p class="text-sm muted">Processing moves to Wed 8:00 PM</p>' +
          '</div>' +
          '<span class="score num" style="font-size:28px;color:var(--gold)">$' + (FAAB.budget - FAAB.spent) + '</span>' +
        '</div>' +
      '</div>' +

      '<div class="section-head"><h2>League chat</h2><a href="#/chat">Open</a></div>' +
      '<div class="mx-4 card tap" style="padding:14px 16px;" data-nav="#/chat">' +
        '<p class="text-sm"><b style="color:var(--gold)">' + esc(latestChat.from) + ':</b> ' + esc(latestChat.text) + '</p>' +
      '</div>';

    return shell('#/home', topbarHtml('', { wordmark: true, right: '<a class="icon-btn" href="#/team">' + ICON.team + '</a>' }), inner);
  }

  function tickerCard(g) {
    return '<div class="ticker-card card-glass glass">' +
      '<div class="g"><span>' + g.away + '</span><b class="num">' + g.as + '</b></div>' +
      '<div class="g"><span>' + g.home + '</span><b class="num">' + g.hs + '</b></div>' +
      '<div class="status">' + g.status + '</div>' +
      '</div>';
  }

  /* ---------------------------------------------------------
     VIEW: MATCHUP / GAMECAST
     --------------------------------------------------------- */
  var PLAYS = [
    { clock: 'Q3 8:42', text: '<b>Josh Allen</b> 14-yd scramble, 1st down at KC 34.' },
    { clock: 'Q3 9:55', text: '<b>Ja’Marr Chase</b> 41-yd touchdown catch from Joe Burrow. CIN 21, BAL 14.' },
    { clock: 'Q3 11:20', text: '<b>Bijan Robinson</b> 9-yd run, ATL converts 3rd & 4.' },
    { clock: 'Q2 1:14', text: '<b>Harrison Butker</b> 48-yd field goal is good.' },
    { clock: 'Q2 4:02', text: '<b>Justin Herbert</b> 22-yd strike to the sideline, 1st down.' },
    { clock: 'Q2 9:40', text: '<b>Broncos D/ST</b> sack Aidan O’Connell for a loss of 7.' },
    { clock: 'Q1 6:18', text: '<b>Garrett Wilson</b> 12-yd catch, short of the sticks.' },
    { clock: 'Q1 12:00', text: 'Turf Kings vs Air Yard Sale kicks off &mdash; ' + LIVE_MATCHUP.rivalry + '.' }
  ];

  function viewMatchup() {
    var m = LIVE_MATCHUP;
    var lineup = state.matchupTab === 'mine' ? TURF_KINGS_LINEUP.starters : null;
    var visiblePlays = state.playFeedExpanded ? PLAYS : PLAYS.slice(0, 4);

    var rosterHtml;
    if (state.matchupTab === 'mine') {
      rosterHtml = lineup.map(function (slot) {
        var p = playerById(slot.id);
        return rosterRow(slot.slot, p, true);
      }).join('');
    } else {
      rosterHtml = '<div class="px" style="padding:24px 16px;text-align:center;">' +
        '<p class="text-sm muted">Air Yard Sale starters are locked once Sunday’s slate kicks off &mdash; live scoring syncs from ESPN in real time.</p>' +
        '</div>';
    }

    var inner =
      '<div class="mx-4 mt-3 glass score-hero">' +
        '<div class="row between">' +
          '<span class="chip chip-live"><span class="live-dot"></span>' + m.quarter + ' &middot; ' + m.clock + '</span>' +
          '<span class="label">GAMECAST</span>' +
        '</div>' +
        '<div class="teams mt-4">' +
          '<div class="team-col">' +
            '<span class="team-name">' + esc(m.home.name) + '</span>' +
            '<span class="score lead num">' + fmt1(m.homeScore) + '</span>' +
          '</div>' +
          '<div class="vs">Q3</div>' +
          '<div class="team-col right">' +
            '<span class="team-name">' + esc(m.away.name) + '</span>' +
            '<span class="score num">' + fmt1(m.awayScore) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="winprob">' +
          '<div class="row between text-sm muted mb-2"><span>' + esc(m.home.name) + ' win prob</span><span class="num">' + m.homeWinProb + '%</span></div>' +
          '<div class="winprob-track"><div class="winprob-fill" style="width:' + m.homeWinProb + '%"></div></div>' +
        '</div>' +
      '</div>' +

      '<div class="mx-4 mt-5 segmented" role="tablist">' +
        '<button data-set-matchup-tab="mine" class="' + (state.matchupTab === 'mine' ? 'active' : '') + '">Turf Kings</button>' +
        '<button data-set-matchup-tab="theirs" class="' + (state.matchupTab === 'theirs' ? 'active' : '') + '">Air Yard Sale</button>' +
      '</div>' +
      '<div class="mx-4 mt-3 card">' + rosterHtml + '</div>' +

      '<div class="section-head"><h2>Key plays</h2></div>' +
      '<div class="mx-4 card">' +
        visiblePlays.map(function (p) { return '<div class="play-row"><span class="play-clock num">' + p.clock + '</span><p class="play-text">' + p.text + '</p></div>'; }).join('') +
        (PLAYS.length > 4 ?
          '<button class="btn btn-ghost btn-sm" style="margin:14px 16px;" data-toggle-plays>' + (state.playFeedExpanded ? 'Show less' : 'Load earlier plays') + '</button>'
          : '') +
      '</div>' +

      '<div class="section-head"><h2>Around the slate</h2></div>' +
      '<div class="ticker-wrap"><div class="ticker">' + NFL_GAMES.map(tickerCard).join('') + '</div></div>';

    return shell('#/matchup', topbarHtml('Gamecast', {}), inner);
  }

  function rosterRow(slotLabel, p, linkToPlayer) {
    var live = p.status === 'live';
    var attrs = linkToPlayer ? ' data-nav="#/player/' + p.id + '"' : '';
    return '<div class="roster-row tap"' + attrs + '>' +
      '<span class="pos-badge">' + slotLabel + '</span>' +
      '<div>' +
        '<p class="player-name">' + esc(p.name) + '</p>' +
        '<p class="player-sub">' + p.team + ' &middot; ' + p.opp + '</p>' +
      '</div>' +
      '<div class="pts-col">' +
        '<p class="pts-actual num' + (live ? ' live' : '') + '">' + (p.status === 'bye' ? '&mdash;' : fmt1(p.actual)) + '</p>' +
        '<p class="pts-proj num">proj ' + fmt1(p.proj) + '</p>' +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     VIEW: MY TEAM
     --------------------------------------------------------- */
  function viewTeam() {
    var starters = TURF_KINGS_LINEUP.starters;
    var bench = TURF_KINGS_LINEUP.bench;
    var totalActual = starters.reduce(function (s, r) { var p = playerById(r.id); return s + (p.status === 'bye' ? 0 : p.actual); }, 0);
    var totalProj = starters.reduce(function (s, r) { return s + playerById(r.id).proj; }, 0);

    var inner =
      '<div class="mx-4 mt-3 glass" style="padding:20px;">' +
        '<div class="row between">' +
          '<div>' +
            '<h1 style="font-size:26px;">Turf Kings</h1>' +
            '<p class="text-sm muted">Tyler &middot; 4-2 &middot; 798.6 PF</p>' +
          '</div>' +
          '<span class="avatar" style="width:48px;height:48px;font-size:18px;">TK</span>' +
        '</div>' +
        '<div class="row between mt-5">' +
          '<div><p class="label">This week</p><p class="score num" style="font-size:32px;">' + fmt1(totalActual) + '</p></div>' +
          '<div style="text-align:right"><p class="label">Projected</p><p class="score num" style="font-size:32px;color:var(--muted)">' + fmt1(totalProj) + '</p></div>' +
        '</div>' +
      '</div>' +

      '<div class="section-head"><h2>Starters</h2></div>' +
      '<div class="mx-4 card">' + starters.map(function (s) { return rosterRow(s.slot, playerById(s.id), true); }).join('') + '</div>' +

      '<div class="section-head"><h2>Bench</h2></div>' +
      '<div class="mx-4 card">' + bench.map(function (id) { return rosterRow('BN', playerById(id), true); }).join('') + '</div>' +

      '<div class="mx-4 mt-5">' +
        '<a class="btn btn-primary btn-block" href="#/waivers">' + ICON.tag + ' Waiver Wire</a>' +
      '</div>';

    return shell('#/team', topbarHtml('My Team', {}), inner);
  }

  /* ---------------------------------------------------------
     VIEW: LEAGUE / STANDINGS
     --------------------------------------------------------- */
  function standingsRow(t, rank, expandable) {
    var streakClass = t.streak.indexOf('W') === 0 ? 'win' : 'loss';
    var open = state.standingsOpen === t.id;
    var attrs = expandable ? ' data-standings-row="' + t.id + '"' : '';
    var row = '<div class="standings-row' + (t.isUser ? ' user' : '') + ' tap"' + attrs + '>' +
      '<span class="rank num">' + rank + '</span>' +
      '<div class="team-meta"><p class="name">' + esc(t.name) + '</p><p class="owner">' + esc(t.owner) + '</p></div>' +
      '<span class="pf-col num">' + fmt1(t.pf) + '</span>' +
      '<span class="streak ' + streakClass + '">' + t.streak + '</span>' +
    '</div>';
    if (expandable && open) {
      row += '<div class="row-detail">Record ' + t.record + ' &middot; ' + fmt1(t.pf) + ' points for &middot; currently on a ' + t.streak + ' streak.' +
        (t.isUser ? ' This is your team.' : '') + '</div>';
    }
    return row;
  }

  function viewLeague() {
    var inner =
      '<div class="mx-4 mt-3 glass" style="padding:18px 20px;">' +
        '<p class="label">' + LEAGUE.name + '</p>' +
        '<h1 style="font-size:24px;">Standings</h1>' +
        '<p class="text-sm muted mt-3">Season ' + LEAGUE.season + ' &middot; Week ' + LEAGUE.week + ' &middot; tap a team for form</p>' +
      '</div>' +

      '<div class="mx-4 mt-4 card">' +
        TEAMS.map(function (t, i) { return standingsRow(t, i + 1, true); }).join('') +
      '</div>' +

      '<div class="section-head"><h2>League records</h2></div>' +
      '<div class="mx-4 card" style="padding:4px 0;">' +
        '<div class="roster-row" style="grid-template-columns:1fr auto;">' +
          '<div><p class="player-name">Highest single week</p><p class="player-sub">' + RECORDS.highWeek.team + ' &middot; ' + RECORDS.highWeek.when + '</p></div>' +
          '<span class="score num" style="font-size:19px;">' + RECORDS.highWeek.pts + '</span>' +
        '</div>' +
        '<div class="roster-row" style="grid-template-columns:1fr auto;">' +
          '<div><p class="player-name">2026 MVP pace</p><p class="player-sub">Most points scored this season</p></div>' +
          '<span class="score num" style="font-size:15px;color:var(--gold);text-align:right;">' + RECORDS.mvpPace + '</span>' +
        '</div>' +
        '<div class="roster-row" style="grid-template-columns:1fr auto;border-bottom:0;">' +
          '<div><p class="player-name">Biggest blowout</p><p class="player-sub">' + RECORDS.blowout.when + '</p></div>' +
          '<span class="score num" style="font-size:19px;">' + RECORDS.blowout.score + '</span>' +
        '</div>' +
      '</div>';

    return shell('#/league', topbarHtml('League', {}), inner);
  }

  /* ---------------------------------------------------------
     VIEW: PLAYER DETAIL
     --------------------------------------------------------- */
  function viewPlayer(id) {
    var p = playerById(id);
    if (!p) return shell('#/team', topbarHtml('Player', { back: '#/team' }), '<p class="px mt-5">Player not found.</p>');

    var inner =
      '<div class="player-hero">' +
        '<div class="player-photo">' + initials(p.name) + '</div>' +
        '<h1 style="font-size:28px;">' + esc(p.name) + '</h1>' +
        '<p class="text-sm muted mt-3">' + p.pos + ' &middot; ' + p.team + ' &middot; ' + p.opp + '</p>' +
        '<div class="mt-3">' + statusChip(p.status) + '</div>' +
      '</div>' +

      '<div class="mx-4 stat-grid">' +
        '<div class="stat-tile card"><p class="v num">' + fmt1(p.status === 'bye' ? 0 : p.actual) + '</p><p class="k">Actual pts</p></div>' +
        '<div class="stat-tile card"><p class="v num">' + fmt1(p.proj) + '</p><p class="k">Projected</p></div>' +
        '<div class="stat-tile card"><p class="v num">' + fmt1(p.last5.reduce(function(a,b){return a+b;},0)/p.last5.length) + '</p><p class="k">L5 avg</p></div>' +
      '</div>' +

      '<div class="section-head"><h2>This week</h2></div>' +
      '<div class="mx-4 card" style="padding:16px;">' +
        '<div class="row between">' +
          p.stats.map(function (s) { return '<div style="text-align:center;flex:1;"><p class="score num" style="font-size:20px;">' + s[1] + '</p><p class="label" style="font-size:9.5px;">' + s[0] + '</p></div>'; }).join('') +
        '</div>' +
      '</div>' +

      '<div class="section-head"><h2>Last 5 weeks</h2></div>' +
      '<div class="mx-4 card sparkline-wrap">' +
        sparkline(p.last5, 320, 90) +
        '<div class="row between text-sm muted mt-3">' +
          p.last5.map(function (v) { return '<span class="num">' + fmt1(v) + '</span>'; }).join('') +
        '</div>' +
      '</div>' +

      '<div class="section-head"><h2>Matchup notes</h2></div>' +
      '<div class="mx-4 card-glass glass" style="padding:16px;">' +
        '<p class="text-sm">' + esc(p.blurb) + '</p>' +
      '</div>';

    return shell(null, topbarHtml(p.name, { back: '#/team' }), inner);
  }

  /* ---------------------------------------------------------
     VIEW: WAIVERS
     --------------------------------------------------------- */
  function viewWaivers() {
    var remaining = FAAB.budget - FAAB.spent;
    var claimsHtml = state.myClaims.length
      ? state.myClaims.map(function (c) {
          var w = WAIVERS.filter(function (x) { return x.id === c.playerId; })[0];
          return '<div class="roster-row" style="grid-template-columns:1fr auto;">' +
            '<div><p class="player-name">' + esc(w.name) + '</p><p class="player-sub">' + w.pos + ' &middot; ' + w.team + '</p></div>' +
            '<span class="chip chip-pos">$' + c.bid + ' bid</span>' +
          '</div>';
        }).join('')
      : '<div class="px" style="padding:18px 16px;"><p class="text-sm muted">No active claims yet &mdash; place a bid below.</p></div>';

    var inner =
      '<div class="mx-4 mt-3 glass" style="padding:18px 20px;">' +
        '<div class="row between">' +
          '<div><p class="label">FAAB budget</p><p class="score num" style="font-size:34px;color:var(--gold);">$' + remaining + '</p></div>' +
          '<div style="text-align:right"><p class="label">Processes</p><p class="player-name" id="waiver-countdown">Wed 8:00 PM</p></div>' +
        '</div>' +
        '<div class="winprob-track mt-4"><div class="winprob-fill" style="width:' + Math.round((remaining / FAAB.budget) * 100) + '%"></div></div>' +
        '<p class="text-sm muted mt-3">$' + FAAB.spent + ' of $' + FAAB.budget + ' spent this season</p>' +
      '</div>' +

      '<div class="section-head"><h2>My claims</h2></div>' +
      '<div class="mx-4 card">' + claimsHtml + '</div>' +

      '<div class="section-head"><h2>Trending adds</h2></div>' +
      '<div class="mx-4 card">' +
        WAIVERS.map(function (w) {
          return '<div class="waiver-row">' +
            '<div>' +
              '<p class="player-name">' + esc(w.name) + '</p>' +
              '<p class="player-sub">' + w.pos + ' &middot; ' + w.team + '</p>' +
              '<p class="trend mt-1">&#9650; ' + w.trend + '</p>' +
            '</div>' +
            '<button class="btn btn-primary btn-sm" data-open-bid="' + w.id + '">Bid</button>' +
          '</div>';
        }).join('') +
      '</div>';

    var sheet = '';
    if (state.sheetPlayer) {
      var wp = WAIVERS.filter(function (x) { return x.id === state.sheetPlayer; })[0];
      sheet =
        '<div class="sheet-backdrop" data-close-sheet>' +
          '<div class="sheet glass" onclick="event.stopPropagation()">' +
            '<div class="sheet-handle"></div>' +
            '<div class="row between">' +
              '<div><p class="label">Place FAAB bid</p><h2 style="font-size:22px;">' + esc(wp.name) + '</h2></div>' +
              '<button class="icon-btn" data-close-sheet>' + ICON.close + '</button>' +
            '</div>' +
            '<p class="text-sm muted mt-2">' + esc(wp.blurb) + '</p>' +
            '<input class="bid-input mt-5" id="bid-amount" type="number" inputmode="numeric" min="0" max="' + remaining + '" value="' + wp.suggestedBid + '" />' +
            '<p class="text-sm muted center mt-2">Suggested bid $' + wp.suggestedBid + ' &middot; $' + remaining + ' available</p>' +
            '<button class="btn btn-primary btn-block mt-5" data-submit-bid="' + wp.id + '">Submit claim</button>' +
          '</div>' +
        '</div>';
    }

    return shell('#/team', topbarHtml('Waiver Wire', { back: '#/team' }), inner) + sheet;
  }

  /* ---------------------------------------------------------
     VIEW: CHAT
     --------------------------------------------------------- */
  function viewChat() {
    var inner =
      '<div class="pinned-banner">' +
        '<p class="label" style="color:var(--gold)">📌 ' + esc(PINNED.team) + '</p>' +
        '<p class="text-sm mt-1">' + esc(PINNED.from) + ': ' + esc(PINNED.text) + '</p>' +
      '</div>' +
      '<div class="chat-scroll" id="chat-scroll">' +
        state.chat.map(function (m) {
          return '<div class="bubble-row ' + (m.mine ? 'mine' : 'theirs') + '">' +
            (m.mine ? '' : '<span class="bubble-meta">' + esc(m.from) + '</span>') +
            '<div class="bubble">' + esc(m.text) + '</div>' +
            '<span class="bubble-meta">' + m.time + '</span>' +
          '</div>';
        }).join('') +
      '</div>';

    var inputBar =
      '<div class="chat-input-bar glass">' +
        '<input id="chat-input" type="text" placeholder="Talk some trash&hellip;" />' +
        '<button class="send-btn" data-send-chat>' + ICON.send + '</button>' +
      '</div>';

    return shell('#/chat', topbarHtml('League Chat', {}), inner) + inputBar;
  }

  /* ---------------------------------------------------------
     ROUTER
     --------------------------------------------------------- */
  function currentRoute() {
    return window.location.hash || '#/splash';
  }

  function render() {
    var hash = currentRoute();
    var parts = hash.replace('#/', '').split('/');
    var route = parts[0] || 'splash';
    var view = document.getElementById('view');
    var html;

    switch (route) {
      case 'splash':  html = viewSplash(); break;
      case 'home':    html = viewHome(); break;
      case 'matchup': html = viewMatchup(); break;
      case 'team':    html = viewTeam(); break;
      case 'league':  html = viewLeague(); break;
      case 'player':  html = viewPlayer(parts[1]); break;
      case 'waivers': html = viewWaivers(); break;
      case 'chat':    html = viewChat(); break;
      default:        html = viewSplash();
    }

    view.innerHTML = html;
    view.scrollTop = 0;

    if (route === 'chat') {
      var scroller = document.getElementById('chat-scroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
    if (route === 'splash') startKickoffClock();
    bindSpecularPointer();
  }

  /* ---------------------------------------------------------
     EVENT DELEGATION — nav links, toggles, forms
     --------------------------------------------------------- */
  document.addEventListener('click', function (e) {
    var navEl = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (navEl) { window.location.hash = navEl.getAttribute('data-nav'); return; }

    var tabBtn = e.target.closest('[data-set-matchup-tab]');
    if (tabBtn) { state.matchupTab = tabBtn.getAttribute('data-set-matchup-tab'); render(); return; }

    var toggleId = e.target.closest('[data-standings-row]');
    if (toggleId) {
      var id = toggleId.getAttribute('data-standings-row');
      state.standingsOpen = state.standingsOpen === id ? null : id;
      render();
      return;
    }

    if (e.target.closest('[data-toggle-plays]')) {
      state.playFeedExpanded = !state.playFeedExpanded;
      render();
      return;
    }

    var openBid = e.target.closest('[data-open-bid]');
    if (openBid) { state.sheetPlayer = openBid.getAttribute('data-open-bid'); render(); return; }

    if (e.target.closest('[data-close-sheet]')) { state.sheetPlayer = null; render(); return; }

    var submitBid = e.target.closest('[data-submit-bid]');
    if (submitBid) {
      var pid = submitBid.getAttribute('data-submit-bid');
      var amountEl = document.getElementById('bid-amount');
      var amount = amountEl ? parseInt(amountEl.value, 10) || 0 : 0;
      state.myClaims = state.myClaims.filter(function (c) { return c.playerId !== pid; });
      state.myClaims.push({ playerId: pid, bid: amount });
      state.sheetPlayer = null;
      render();
      return;
    }

    if (e.target.closest('[data-send-chat]')) { sendChat(); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'chat-input') sendChat();
  });

  function sendChat() {
    var input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    var now = new Date();
    var h = now.getHours() % 12 || 12;
    var mm = (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
    state.chat.push({ id: state.chat.length + 1, from: 'Tyler', team: 'Turf Kings', mine: true, time: h + ':' + mm + ' ' + (now.getHours() >= 12 ? 'PM' : 'AM'), text: input.value.trim() });
    input.value = '';
    render();
    var scroller = document.getElementById('chat-scroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    var freshInput = document.getElementById('chat-input');
    if (freshInput) freshInput.focus();
  }

  /* ---------------------------------------------------------
     KICKOFF CLOCK — ticks independently, no full re-render
     --------------------------------------------------------- */
  var clockTimer = null;
  function startKickoffClock() {
    if (clockTimer) clearInterval(clockTimer);
    var target = new Date();
    target.setHours(target.getHours() + 2, 18, 4, 0);
    function tick() {
      var el = document.getElementById('kickoff-clock');
      if (!el) { clearInterval(clockTimer); return; }
      var diff = Math.max(0, target - new Date());
      var h = String(Math.floor(diff / 3600000)).padStart(2, '0');
      var m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
      var s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
      el.innerHTML = 'NEXT SLATE IN <span class="t">' + h + ':' + m + ':' + s + '</span>';
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  /* ---------------------------------------------------------
     SPECULAR HIGHLIGHT — subtle pointer-follow on fine pointers,
     static (CSS-animated only) on touch. Respects reduced motion.
     --------------------------------------------------------- */
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasFinePointer = window.matchMedia && window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
  function bindSpecularPointer() {
    if (reduceMotion || !hasFinePointer) return;
    var bar = document.querySelector('.tabbar');
    if (!bar || bar.dataset.specBound) return;
    bar.dataset.specBound = '1';
    bar.addEventListener('pointerenter', function () { bar.classList.add('spec-follow'); });
    bar.addEventListener('pointerleave', function () { bar.classList.remove('spec-follow'); });
    bar.addEventListener('pointermove', function (e) {
      var rect = bar.getBoundingClientRect();
      var pct = ((e.clientX - rect.left) / rect.width) * 100;
      bar.style.setProperty('--spec-x', pct + '%');
    });
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);
})();
