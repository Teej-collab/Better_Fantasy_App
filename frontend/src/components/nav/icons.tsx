// Minimal single-color line icons for the 5 primary destinations — no
// icon library exists anywhere in this repo (confirmed: no lucide/
// heroicons/react-icons, no local Icon components), and the app's
// existing live/status indicators lean on emoji + CSS-shape dots
// instead. For a persistent, always-visible primary nav specifically,
// a small hand-authored line-icon set reads as the "premium sports
// app" register the brief asks for — not a gaming HUD, not an emoji
// row — while adding zero new dependencies. currentColor throughout
// so each icon inherits its NavLink's active/inactive text color.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function TeamIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 3.5 4 6v3.5c0 5 3.2 8.7 8 10.5 4.8-1.8 8-5.5 8-10.5V6l-5-2.5" />
      <path d="M9 3.5 12 6l3-2.5" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function LeagueIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z" />
      <path d="M7 5H4.5A1.5 1.5 0 0 0 3 6.5 3.5 3.5 0 0 0 6.5 10H7" />
      <path d="M17 5h2.5A1.5 1.5 0 0 1 21 6.5 3.5 3.5 0 0 1 17.5 10H17" />
      <path d="M12 13v3" />
      <path d="M9 20h6" />
      <path d="M9.5 20c0-1.7.6-3 2.5-4 1.9 1 2.5 2.3 2.5 4" />
    </svg>
  );
}

export function MatchupsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h6l-2.5 6L10 18H4" />
      <path d="M20 6h-6l2.5 6L14 18h6" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4v-10Z" />
    </svg>
  );
}

// A broadcast-signal mark (source dot + radiating arcs) rather than a
// literal TV/screen — reads as "live feed" specifically, distinct from
// Matchups' vs-brackets, for the one destination in this set that's
// actually about a real-time broadcast rather than fantasy data.
export function GamecastIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" />
      <path d="M12 16.2v-1.7" />
      <path d="M9 12.7a4.2 4.2 0 0 1 6 0" />
      <path d="M6.5 10a7.8 7.8 0 0 1 11 0" />
      <path d="M4 7.3a11.4 11.4 0 0 1 16 0" />
    </svg>
  );
}

// Beta nav (Documentation/UX/02_Information_Architecture.md) — a
// 3x3 dot grid for "More," matching the same mark used across the
// redesign mockups rather than a generic hamburger/ellipsis, since
// "More" here is a real catch-all destination (My Team, Draft,
// Keepers, Free Agents, Trades, Gamecast, Settings, League
// Management), not a menu of secondary actions.
// A TV screen — Lounge is a shared-screen watch party, not a generic
// video-call icon (which would read as indistinguishable from Chat's
// own icon here).
export function LoungeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 17v3.5" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  const p = base(props);
  return (
    <svg {...p} fill="currentColor" stroke="none">
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="18" cy="6" r="1.6" />
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="12" cy="18" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
    </svg>
  );
}

