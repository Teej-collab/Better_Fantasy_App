# THE WEEKEND — Information Architecture (Proposed)

**Status:** Proposal for review. **Rollout:** this nav model ships behind a single opt-in "Try the new look" toggle in Settings (not as a permanent third theme) — see `06_Implementation_Roadmap.md` §0 for why, and for the sunset plan that retires the old nav once feedback comes in. Describes the current IA as found in code, what's wrong with it, and a proposed structure — not a mandate to implement the exact 5-tab example from the brief blindly, per the brief's own instruction to determine the best structure rather than copy one.

---

## 1. Current IA, as it actually exists in code

**Top-level tabs (identical set, desktop `PrimaryNav` and mobile `BottomNav`):**
My Team · League · Home · Matchups · Gamecast — 5 slots, owner-reorderable.

**Pulled out of the tab bar entirely:** Chat — lives as a persistent header icon (with unread badge) at every breakpoint, never in the primary or bottom nav.

**One level down, via sub-navigation:**
- `LeagueSubNav` (under League): Overview, Standings, Power Rankings, Rivalries, Rules, History — 6 destinations
- `MyTeamSubNav` (under My Team): Roster, Draft, Keepers, Free Agents, Trades — 5 destinations
- `SeasonTabs` (a third layer, under some of the above): Standings, Awards, Player Cards, Owner profile all get year-based sub-tabs

**A second, informal "More"-shaped surface:** Home's "Discover" tile grid, placed last in an already 9-10-card-long scroll, re-offers Gamecast/League/Standings/Power-Rankings/Rivalries/Rules/History — several of which are *already* reachable via League's sub-nav one tap away.

**Total: 19 distinct destinations** (`DestinationKey` values in `navDestinations.ts`), only 5 as true top-level tabs.

---

## 2. What's actually wrong with this (not just "too many pages")

1. **Chat's placement contradicts the product's own stated identity.** The brief's philosophy section calls THE WEEKEND "part fantasy football clubhouse... part league group chat" — but Chat is the one thing users can't reach from the tab bar at all. A header icon says "utility," a tab says "this is core to the product." Right now the nav says the opposite of what the brief wants the product to feel like.
2. **There's no real "More."** Because there's no catch-all, secondary destinations get crammed two ways at once: sub-nav pill rows (5-6 wide, sometimes needing horizontal scroll on mobile) *and* a duplicate tile grid on Home. A user can end up seeing "Standings" offered in three different places (League sub-nav, Home's Discover grid, and indirectly via the Home dashboard's own Standings card) with no single canonical path.
3. **Three-deep nesting for common tasks.** Reaching Rivalries today is Home/League tab → League sub-nav → Rivalries, or Home tab → scroll to Discover grid → Rivalries — never a direct one-tap path from the primary nav.
4. **The tab bar optimizes for "my stuff" (My Team, Matchups) but drops the social layer (Chat) and the competitive/league layer (League, which itself fans out to 6 more things) into unequal-depth buckets** — My Team's 5 sub-destinations are all genuinely about my roster; League's 6 sub-destinations span very different jobs (checking the standings vs. reading the rulebook vs. browsing 5-year-old history), which is why it feels sprawling even at one level of nesting.

---

## 3. Proposed IA

**Mobile primary tabs (5, matching the platform convention the brief itself floats, adapted to this app's real content — not a blind copy):**

| Tab | Replaces / absorbs |
|---|---|
| **Home** | unchanged — the personalized dashboard |
| **League** | unchanged destination, but its sub-nav gets thinned (see §4) |
| **Matchup** | renamed from "Matchups" (singular — "my matchup this week" is the primary job; the plural list of all league matchups becomes a secondary view reachable from within it) |
| **Chat** | **newly promoted from header icon to a real tab** — this is the single highest-leverage IA change in this document given the brief's own stated identity goals |
| **More** | **new.** Houses My Team's current sub-destinations (Roster, Draft, Keepers, Free Agents, Trades) plus Gamecast, Settings, and (for commissioners) League Management/Admin entry points |

**Why My Team moves under More instead of staying a top-level tab:** Roster is already reachable from Home (the "Your Week" card links straight into it) and from Matchup (a "my lineup" link is a natural addition there per `03_Component_System.md`'s MatchupHero spec) — it doesn't need its own permanent tab slot once those two paths exist, and freeing the slot is what makes room for Chat without exceeding 5 tabs. **This is a judgment call worth discussing, not a foregone conclusion** — if user testing or the commissioner's own instinct says My Team should keep a dedicated tab instead of Chat, the alternative (keep My Team, fold Chat's promotion into a persistent-but-larger header presence instead) is a reasonable fallback; flagging it explicitly rather than presenting only one option.

**Gamecast moves from a top-level tab into More / contextual entry points** (a live game already surfaces via Home's live card and via a "watch live" link from Matchup/Roster when a rostered player's game is active) — it's a drill-down destination, not a place people navigate to cold as often as Home/League/Matchup/Chat.

**League sub-nav thinned from 6 to 4:** Standings, Power Rankings, Rivalries stay; **History and Rules move into a single "League Info" entry** (History is already a 3-tile hub internally, Rules is static reference content — neither needs its own top-level sub-nav slot). Net: League's sub-nav becomes Standings / Power Rankings / Rivalries / League Info.

**Home's "Discover" grid is removed entirely** once every destination it duplicated has exactly one canonical home in the tab/sub-nav structure above — Home goes back to being "what matters to me right now," not also a secondary site map.

**Desktop:** same 5 top-level destinations in the horizontal bar (Home / League / Matchup / Chat / More, with More becoming a dropdown rather than a mobile-style page at desktop widths — see `05_Desktop_Strategy.md`).

---

## 4. Destination map (all 19, reassigned)

| Destination | Today | Proposed |
|---|---|---|
| Home | tab | tab (unchanged) |
| League overview | League sub-nav | League tab default view |
| Standings | League sub-nav + Home Discover | League sub-nav |
| Power Rankings | League sub-nav + Home Discover | League sub-nav |
| Rivalries | League sub-nav + Home Discover | League sub-nav |
| Rules | League sub-nav + Home Discover | League sub-nav → "League Info" |
| History | League sub-nav + Home Discover | League sub-nav → "League Info" |
| Matchups (list) | tab | inside Matchup tab, "all matchups" secondary view |
| My matchup | tab (via Matchups list) | Matchup tab default view |
| Gamecast | tab + Home Discover | More, plus contextual "watch live" links |
| Roster | My Team sub-nav | More (or Home/Matchup deep link) |
| Draft (live + archive) | My Team sub-nav | More |
| Keepers | My Team sub-nav | More, nested under Draft |
| Free Agents | My Team sub-nav | More |
| Trades | My Team sub-nav | More |
| Chat | header icon | **tab** |
| Settings | header/account menu | More |
| Commissioner (League Mgmt) | header/account menu, commissioner-only | More, commissioner-only |
| Admin | separate route, site-owner-only | unchanged — outside the consumer IA entirely, no change needed |

---

## 5. What this fixes from the audit

- Chat's promotion directly addresses the "clubhouse" identity gap (§00 Audit, P0).
- Collapsing History+Rules into League Info and removing the Home Discover grid eliminates the triplicate paths to the same destinations.
- Thinning My Team out of the top-level bar (into More, with deep links from Home/Matchup) reduces the tab bar from "5 tabs covering roughly 11 real destinations unevenly" to "5 tabs with a real, honest catch-all," matching the brief's explicit ask to evaluate exactly this trade-off rather than assume the current 5 are the right 5.

## 6. What does not change

Admin stays fully separate from the consumer IA (it already is, correctly). The underlying pages/routes themselves are not being deleted — this document only proposes moving *entry points*, not removing functionality. Season-based sub-tabs (`SeasonTabs`) on Standings/Awards/Owner-profile stay as-is; they're a correctly-scoped third layer for genuinely historical browsing, not part of the noise problem.
