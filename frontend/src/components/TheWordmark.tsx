import { currentSeason } from "@/lib/seasonal";
import styles from "./TheWordmark.module.css";

/** "The", in script, above the WEEKEND neon — The Weekend's wordmark in
 * the app-entry intro. Tinted for the season (orange in October, red in
 * winter) like the logo. */
export function TheWordmark({ className }: { className?: string }) {
  const season = currentSeason();
  const tint = season === "halloween" ? styles.halloween : season === "winter" ? styles.winter : "";
  return (
    <div className={styles.wrap}>
      <span className={`${styles.the} ${tint} ${className ?? ""}`}>The</span>
    </div>
  );
}
