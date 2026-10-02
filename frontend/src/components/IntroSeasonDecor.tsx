import { currentSeason } from "@/lib/seasonal";
import styles from "./IntroSeasonDecor.module.css";

// The app-entry intro's seasonal touches, behind the words: a corner web
// and two dangling spiders in October, falling snow in winter (the same
// windows as the logo, lib/seasonal.ts). Nothing the rest of the year.

const LEGS = [
  "M-6 0 L-26 -14 L-38 4",
  "M-6 4 L-30 -2 L-40 18",
  "M-6 8 L-28 12 L-36 32",
  "M6 0 L26 -14 L38 4",
  "M6 4 L30 -2 L40 18",
  "M6 8 L28 12 L36 32",
];

function Spider({ left, thread, size, late }: { left: string; thread: number; size: number; late?: boolean }) {
  return (
    <div className={`${styles.spider} ${late ? styles.spiderB : ""}`} style={{ left }}>
      <div className={styles.thread} style={{ height: thread }} />
      <svg viewBox="-44 -24 88 72" width={size} height={size * 0.82} style={{ marginTop: -4 }}>
        <g stroke="#ff7a1a" strokeWidth="7" strokeLinecap="round" fill="none">
          {LEGS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g stroke="#0f0c14" strokeWidth="3.4" strokeLinecap="round" fill="none">
          {LEGS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <ellipse cx="0" cy="12" rx="15" ry="19" fill="#0f0c14" stroke="#ff7a1a" strokeWidth="3" />
        <circle cx="0" cy="-10" r="10" fill="#0f0c14" stroke="#ff7a1a" strokeWidth="2.6" />
        <circle cx="-4" cy="-11" r="2.6" fill="#ff7a1a" />
        <circle cx="4" cy="-11" r="2.6" fill="#ff7a1a" />
      </svg>
    </div>
  );
}

// Fixed spots so the snow looks the same on every render.
const FLAKES = [3, 10, 17, 24, 30, 37, 44, 51, 57, 64, 71, 77, 84, 90, 96, 7, 54, 87].map((x, i) => ({
  left: `${x}%`,
  size: 3 + (i % 4),
  opacity: 0.45 + (i % 3) * 0.2,
  duration: `${7 + (i % 5) * 1.6}s`,
  delay: `-${((i * 1.37) % 9).toFixed(2)}s`,
}));

export function IntroSeasonDecor() {
  const season = currentSeason();
  if (season === "halloween") {
    return (
      <div className={styles.layer} aria-hidden>
        <svg className={styles.web} viewBox="250 0 140 154" fill="none" stroke="#d9d9e6" strokeWidth="1.6" strokeLinecap="round">
          <line x1="390" y1="0" x2="250" y2="20" />
          <line x1="390" y1="0" x2="276" y2="78" />
          <line x1="390" y1="0" x2="318" y2="122" />
          <line x1="390" y1="0" x2="362" y2="146" />
          <line x1="390" y1="0" x2="388" y2="152" />
          <path d="M338 8 Q 346 26 352 36 Q 362 48 368 66 Q 378 72 388 80" />
          <path d="M296 14 Q 310 42 322 56 Q 334 76 344 96 Q 364 104 388 112" />
          <path d="M258 20 Q 278 60 296 74 Q 314 102 332 120 Q 358 134 389 140" />
        </svg>
        <Spider left="11%" thread={150} size={40} />
        <Spider left="84%" thread={250} size={32} late />
      </div>
    );
  }
  if (season === "winter") {
    return (
      <div className={styles.layer} aria-hidden>
        {FLAKES.map((f, i) => (
          <span
            key={i}
            className={styles.flake}
            style={{ left: f.left, width: f.size, height: f.size, opacity: f.opacity, animationDuration: f.duration, animationDelay: f.delay }}
          />
        ))}
      </div>
    );
  }
  return null;
}
