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

