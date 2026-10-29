# THE CLUBHOUSE

**Pitch:** THE WEEKEND as a premium sports magazine crossed with a private league's clubhouse — the league's history, rivalries, and personalities *are* the product, told in warm parchment tones instead of another dark "fantasy app" dashboard.

**Three signature moments:**
1. **The masthead + contents strip** — no bottom tab bar. A real editorial masthead ("THE WEEKEND, Week 7") with a horizontal text-based contents strip underneath, active section underlined in oxblood — reads like a magazine's table of contents, not app chrome.
2. **The trading-card flip** — Player Detail's portrait is a real CSS 3D flip (front: duotone portrait, back: season + live stat line). It's the *only* 3D moment in the whole concept, deliberately — restraint everywhere else is what makes it land.
3. **Hairlines over cards** — sections are separated by yard-line-dashed dividers and thin rules instead of being boxed in cards; the `.card`/`.pullquote` treatment is reserved for the few moments (trash talk, a record) that earn a frame.

**Tech:** Zero dependencies, zero build step — plain HTML/CSS/JS. `app.js` is a ~15-line hash router (`#/home`, `#/matchup`, `#/player/:id`, etc.) that swaps template-literal HTML into `#view`. Open `index.html` directly in a browser. Portraits are pure CSS (duotone gradient + tiny radial-gradient grain) — no image assets. Fonts: Libre Bodoni (display serif) + Public Sans (body), loaded from Google Fonts. Respects `prefers-reduced-motion`.

**Screens:** Login, Home, League, Matchup, My Team, Player Detail, Draft Room (live-simulated via a button), Gamecast, Chat (real local send), Standings, Activity, Profile.
