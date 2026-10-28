import type { Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

// The New Here tour (2026-10-28): twelve slides that walk a new member
// through what The Weekend does and where each thing lives, plus the
// Glossary (Profile circle › Glossary) that explains every term and
// replays the tour. Content lives here so the tour, its "Show me"
// banner and the Glossary all name the same paths.

export type TourSlideKey =
  | 'welcome' | 'living' | 'tickers' | 'gamecast' | 'writeups' | 'whatif'
  | 'chug' | 'social' | 'bragging' | 'appearance' | 'alerts' | 'glossary';

export type TourSlide = {
  key: TourSlideKey;
  kicker: string;
  title: string;
  body: string;
  chips: string[];
  // Where it lives, step by step; 'or' separates two ways in.
  where?: string[];
  // Where "Show me" takes you.
  href?: Href;
  // What the "you're here" banner calls it.
  place?: string;
};

export function tourSlides(opts: { chugEnabled: boolean; chugRuleName: string }): TourSlide[] {
  const slides: TourSlide[] = [
    {
      key: 'welcome', kicker: 'New here?', title: 'Welcome to The Weekend',
      body: 'Your fantasy league, turned into a whole weekend. Keep playing on ESPN or Sleeper. We add the write-ups, the live sweat, the trash talk and the house rules on top.',
      chips: ['12 quick slides', 'About 2 minutes'],
    },
    {
      key: 'living', kicker: 'Living Home', title: 'A home screen that knows what day it is',
      body: "Home changes through the week: the Monday-night sweat, Tuesday's recap, Wednesday's waiver results, and a full game-day board from Thursday to Sunday.",
      chips: ['Changes daily', 'Your matchup up top', 'What you need to win'],
      where: ['Home tab'], href: '/', place: 'Home',
    },
    {
      key: 'tickers', kicker: 'Tickers & Live Activities', title: 'Every score, always in view',
      body: "Ticker strips across the top of every screen show NFL scores and your league's matchups, live. Turn on the lock-screen score and your matchup rides on your Lock Screen and Dynamic Island too.",
      chips: ['NFL ticker', 'League ticker', 'Lock screen', 'Widgets'],
      where: ['Profile circle', 'Notifications', 'Live score on Lock Screen'],
      href: { pathname: '/settings', params: { section: 'notifications' } } as Href, place: 'Notifications',
    },
    {
      key: 'gamecast', kicker: 'Gamecast', title: 'Watch the swing, play by play',
      body: 'A live field view, the last play, and the fantasy impact of every snap. The win-odds chart marks each turning point. Tip: tap any game in the ticker to open it.',
      chips: ['Field view', 'Win odds chart', 'Fantasy impact'],
      where: ['Grid button', 'Gamecast'], href: '/gamecast', place: 'Gamecast',
    },
    {
      key: 'writeups', kicker: 'Write-ups', title: 'Your league, roasted every week',
      body: 'A preview before every matchup, the league recap every Tuesday at 2 PM, and a callout when a player you dropped goes off for someone else.',
      chips: ['Matchup previews', 'Tuesday recap', 'Draft grades'],
      where: ['Home tab', 'Weekly recap card'], href: '/', place: 'Home',
    },
    {
      key: 'whatif', kicker: 'What-If Lab', title: 'Know exactly what you need',
      body: 'We play out the rest of the season 10,000 times: your playoff odds, your odds if you win or lose, who to root for, and your best path to the title.',
      chips: ['Playoff odds', 'Who to root for', 'Simulated bracket'],
      where: ['Grid button', 'What-If'],
      href: { pathname: '/league', params: { section: 'standings', view: 'playoffs' } } as Href, place: 'the What-If Lab',
    },
    {
      key: 'chug', kicker: opts.chugRuleName, title: 'Score zero? You chug.',
      body: `Start a player who scores zero or less and you owe the league a beer chug, filmed and posted. The Chug Analyzer times it, grades your form and hype, then roasts you. Your commissioner can rename ${opts.chugRuleName}.`,
      chips: ['Chug debts', 'Chug Analyzer', 'Leaderboard'],
      where: ['Grid button', 'Chug'], href: '/chug', place: 'the Chug Board',
    },
    {
      key: 'social', kicker: 'Social', title: 'Your group chat, upgraded',
      body: "League chat with GIFs and video, the Lounge for watch parties with the game and everyone's cameras, bets you can tail or fade, and the punishment wheel.",
      chips: ['Chat', 'The Lounge', 'Bets', 'Punishment wheel'],
      where: ['Chat tab', 'or', 'Grid button', 'Lounge'], href: '/chat' as Href, place: 'Chat',
    },
    {
      key: 'bragging', kicker: 'Bragging rights', title: 'History that holds a grudge',
      body: "Rivalries built from your league's history, a Rivalry Week on the schedule, season awards like the Great White Buffalo, a record book, and a War Room for draft day.",
      chips: ['Rivalries', 'Season awards', 'Record book', 'War Room'],
      where: ['League tab', 'Rivalries'],
      href: { pathname: '/league', params: { section: 'rivalries' } } as Href, place: 'Rivalries',
    },
    {
      key: 'appearance', kicker: 'Make it yours', title: 'Your colors, your name, your team',
      body: 'Pick the Calm or Cosmic look, any accent color (or Multi), how hard the neon glows, a seasonal app icon and the intro sound. Set your name, team name, logo and chat bubble color.',
      chips: ['Look', 'Accent color', 'Neon intensity', 'Team logo', 'App icon'],
      where: ['Profile circle', 'Settings', 'Appearance'],
      href: { pathname: '/settings', params: { section: 'appearance' } } as Href, place: 'Appearance',
    },
    {
      key: 'alerts', kicker: 'Notifications', title: 'Only the alerts you want',
      body: 'Pick a Sunday Mode, or choose alert by alert: touchdowns, red zone, injuries, waivers and watch parties. Set quiet hours, and get phone reminders before lineups lock and chugs are due.',
      chips: ['Sunday Mode', 'Touchdowns', 'Quiet hours', 'Reminders'],
      where: ['Profile circle', 'Notifications'],
      href: { pathname: '/settings', params: { section: 'notifications' } } as Href, place: 'Notifications',
    },
    {
      key: 'glossary', kicker: 'Glossary', title: "Lost? It's all in the Glossary",
      body: 'Every term in the app, explained in a sentence, plus where to find each feature. Tap your profile circle at the top right, then Glossary. You can replay this tour from there too.',
      chips: ['Every term', 'Where to find it', 'Replay the tour'],
      where: ['Profile circle', 'Glossary'], href: '/glossary' as Href, place: 'the Glossary',
    },
  ];
  return opts.chugEnabled ? slides : slides.filter((s) => s.key !== 'chug');
}

export type GlossaryGroup = { name: string; color: string; terms: { term: string; def: string; where?: string }[] };

export function glossary(chugRuleName: string, chugEnabled: boolean): GlossaryGroup[] {
  const groups: GlossaryGroup[] = [
    { name: 'Game day', color: '#39ff14', terms: [
      { term: 'Living Home', def: 'Your home screen, which changes through the week: the Monday sweat, recap day, waivers and game day.', where: 'Home tab' },
      { term: 'Ticker', def: "The strips across the top with live NFL scores and your league's matchups.", where: 'Top of every screen' },
      { term: 'Live Activity', def: 'Your live score on the Lock Screen and Dynamic Island during games.', where: 'Profile circle › Notifications › Live score on Lock Screen' },
      { term: 'Gamecast', def: "Live play-by-play with a field view, the last play and each play's fantasy impact.", where: 'Grid button › Gamecast' },
      { term: 'Win odds', def: 'Your chance to win the matchup right now, updated as plays happen.', where: 'Grid button › Matchup' },
      { term: 'Turning point', def: 'A play that swung your win odds the most, marked on the win-odds chart.', where: 'Your matchup › Win odds chart' },
    ] },
    { name: 'Write-ups & stats', color: '#22d3ee', terms: [
      { term: 'Preview & recap', def: 'Write-ups before and after every matchup, plus the league recap every Tuesday at 2 PM.', where: 'Home tab, or Grid button › Matchup' },
      { term: 'Power rankings', def: 'Weekly rankings from record, scoring, all-play record, form and margin.', where: 'League tab › Standings' },
      { term: 'Boom / Bust', def: 'A player who beat his projection by a lot, or fell well short of it.' },
      { term: 'Bench crime', def: 'Leaving more points on your bench than the starter you played instead.' },
    ] },
    { name: 'Playoffs', color: '#a78bfa', terms: [
      { term: 'What-If Lab', def: 'The rest of the season played out 10,000 times to find your playoff odds and best path.', where: 'Grid button › What-If' },
      { term: 'Who to root for', def: 'The games around the league whose results help your odds most.', where: 'Grid button › What-If' },
      { term: 'Toilet Bowl', def: 'The consolation bracket at the bottom. Nobody wants to win it, or lose it.', where: 'League tab › Standings' },
    ] },
    { name: chugRuleName, color: '#f59e0b', terms: [
      { term: chugRuleName, def: "Your league's chug rule. Your commissioner can rename it, and the app uses your league's name everywhere.", where: 'Grid button › Chug' },
      { term: 'Chug debt', def: 'One beer chug owed for every starter who scores zero or less.', where: 'Grid button › Chug' },
      { term: 'Chug deadline', def: "When a week's chugs are due, filmed and posted.", where: 'Grid button › Chug' },
      { term: 'Chug Analyzer', def: 'Grades your chug video for time, technique and hype, then roasts you.', where: 'Grid button › Chug' },
    ] },
    { name: 'Draft & roster', color: '#eab308', terms: [
      { term: 'War Room', def: "Keepers, draft day and your draft's report card, in one tab under My Team.", where: 'Team tab › War Room' },
      { term: 'ADP', def: 'Average draft position: where a player usually goes in drafts across the internet.' },
      { term: 'Steal / Reach', def: 'A pick a full round later (steal) or earlier (reach) than his ADP.' },
      { term: 'FAAB', def: 'Free-agent budget: blind bids on waiver players with a season-long budget.', where: 'Team tab › Free Agents' },
    ] },
    { name: 'Bragging rights', color: '#f97316', terms: [
      { term: 'Rivalry', def: "A matchup with history, suggested from your league's past and approved by the commissioner.", where: 'League tab › Rivalries' },
      { term: 'Rivalry Week', def: 'The week late in the season when the schedule pits rivals against each other.' },
      { term: 'Great White Buffalo', def: 'Season award for giving away the most big games: players you let go who went off elsewhere.' },
      { term: 'Manager of the Year', def: 'Season award for the best-managed season: comebacks, smart moves and injuries overcome.' },
      { term: 'Record book', def: 'All-time league records, streaks and award winners.', where: 'League tab › History' },
    ] },
    { name: 'Social & settings', color: '#ec4899', terms: [
      { term: 'The Lounge', def: "Watch-party rooms with the game and everyone's cameras.", where: 'Grid button › Lounge' },
      { term: 'Tail / Fade', def: "Copy a league mate's bet (tail), or bet against it (fade).", where: 'Grid button › League Bets' },
      { term: 'Sunday Mode', def: 'A one-tap notification preset: Full Send, Game Day or Leave Me Alone.', where: 'Profile circle › Notifications' },
      { term: 'Look & accent color', def: 'Calm or Cosmic, your accent color, neon intensity, app icon and intro sound.', where: 'Profile circle › Settings › Appearance' },
    ] },
  ];
  return chugEnabled ? groups : groups.filter((g) => g.name !== chugRuleName);
}

// --- The tour's state: open or closed, which slide, and the "you're here"
// banner after "Show me". One small store so the Glossary, the account
// menu and the root layout can all open it.

type TourState = { open: boolean; index: number; found: { place: string; where: string[]; index: number } | null };

let state: TourState = { open: false, index: 0, found: null };
const listeners = new Set<() => void>();

function set(next: Partial<TourState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useTour(): TourState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const tour = {
  open(index = 0) {
    set({ open: true, index, found: null });
  },
  go(index: number) {
    set({ index });
  },
  close() {
    set({ open: false });
  },
  // "Show me": the tour steps aside and a banner says where you are.
  showMe(slide: TourSlide, index: number) {
    set({ open: false, found: { place: slide.place ?? slide.kicker, where: slide.where ?? [], index } });
  },
  dismissFound() {
    set({ found: null });
  },
};

// Shown once per phone: the first time someone opens the app with a league.
const SEEN_KEY = 'new_here_tour_seen_v1';

export async function tourSeen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SEEN_KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markTourSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(SEEN_KEY, '1');
  } catch {
    // Not fatal: at worst it shows once more.
  }
}
