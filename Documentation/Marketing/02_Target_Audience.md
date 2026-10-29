# THE WEEKEND — Target Audience

**Status:** Proposal for review.

---

## The central strategic fact

**One commissioner brings 8–14 users in a single motion.** Every dollar and hour spent trying to acquire individual fantasy players one at a time is roughly an order of magnitude less efficient than spending it convincing one commissioner to move their league. THE WEEKEND's self-serve league-creation flow already reflects this instinct correctly (invite-code join, create-a-league-then-invite-your-people). The entire acquisition strategy in this folder is built around the commissioner as the primary unit of growth, not the individual player — see `07_Commissioner_Acquisition.md` for the dedicated playbook.

## Primary customer: the underserved home-league commissioner

- Runs an 8–14 team **friends, family, or work league** that's been together 2+ years (so there's real history worth preserving — the exact thing THE WEEKEND's power rankings/awards/record book are built for).
- Currently on ESPN or Yahoo, mildly to actively annoyed by it (a redesign they hated, a Sunday outage, a UI they find cluttered) but has never seriously considered switching because the switching cost — re-onboarding everyone — always seemed higher than the annoyance.
- Values league culture: has a rivalry, a running bit, a punishment for last place, a group chat that's more active than the app itself. This person is the exact customer the "clubhouse" positioning in `01_Brand_Positioning.md` is written for.
- Is not primarily price-motivated (the free tier removes this as an objection) — they're motivated by whether the switch will make their league *more fun*, not cheaper.
- Is reachable in identifiable places: r/fantasyfootball and league-specific Discord servers, and is disproportionately likely to also listen to a small-to-mid fantasy podcast or follow a fantasy TikTok/YouTube creator for advice, which makes commissioner-adjacent creator content (see `10_Creator_Strategy.md`) a real acquisition surface, not just a brand play.

## Secondary customer: the competitive/engaged individual player

- Plays in 1–3 leagues, is more engaged with fantasy content generally (reads rankings, watches waiver-wire videos), and is a likely source of **inbound pressure on their own commissioner** to switch ("hey, check this out") rather than a switcher themselves — most individual players don't control which platform their league uses.
- This person is a genuine secondary acquisition target for content and community work (they're more likely to follow THE WEEKEND's social accounts, join a Discord, watch a "Bench Crime of the Week" clip) even when they can't unilaterally move a league. Treat this audience as the top of a funnel whose real conversion event is "forwarded this to my commissioner," not "signed up."

## Tertiary customer: the founding-cohort early adopter / builder-in-public audience

- People who follow indie/solo-builder software generally (r/SideProject-adjacent, indie hacker Twitter/X, "build in public" audiences) — genuinely interested in watching a real product get built and shipped fast, not necessarily fantasy football die-hards.
- Low direct league-acquisition value per person, but high value as early testers, bug-finders, and amplifiers of the founder story (`01_Brand_Positioning.md` Section 13) — and a decent source of the first few Founding Leagues who'll try something unfinished specifically *because* it's unfinished and they want to be early.

## Audiences evaluated and deprioritized (with reasons)

| Audience | Verdict | Why |
|---|---|---|
| Sleeper power users / dynasty & keeper die-hards | **Deprioritize** | THE WEEKEND has no dynasty mode, no taxi squads, no multi-team trades, no draft-pick trading — this audience will bounce off immediately on real, unclosed gaps. Revisit only after `Documentation/Competitive_Audit`'s P2/P3 items are built. |
| Large fantasy podcasts / mega-influencers | **Deprioritize for now** | No budget for it, and a mega-audience sending a flood of new leagues at a product whose frontend isn't fully multi-league-ready yet (Section 1, `00_Product_Marketing_Audit.md`) would be a self-inflicted wound. Revisit post-launch-campaign, see `10_Creator_Strategy.md`. |
| Sports-bar / general "casual sports fan" communities | **Deprioritize** | Too broad, no natural distribution channel, and requires local/offline outreach with a poor time-to-payoff ratio for a small team. |
| Cold paid acquisition (broad social ads) | **Deprioritize until Phase 3+** | Paying to acquire an individual user is the wrong unit economics when the real unit is a league; paid spend is better aimed at commissioner-specific channels once the product and landing experience can convert them (`22`/budget guidance in `14_Metrics.md`). |
| Public league directories / matchmaking-style "join a random league" seekers | **Do not build for** | This is a single-private-league product model, per the existing competitive audit's own P4 "do not build" list; chasing this audience would require product work (public league discovery) that doesn't serve the actual customer. |

## The one persona worth writing everything around

**"Dave, the commissioner."** Late 20s to late 40s. Has run the same 10-team league with college friends or a friend group for 3–7 years. Is not a fantasy-content junkie but reads a ranking article or two before his draft. Handles the league's admin overhead himself — collects the buy-in, settles the "did that count" arguments, posts the recap in the group chat. Would switch platforms if, and only if, he's confident it won't blow up his league's trust in him mid-season. He is the reader of the commissioner landing page in `07_Commissioner_Acquisition.md`, the target of the Founding Leagues program in `15_2027_Launch_Campaign.md`, and the reason the entire growth funnel in `13_Growth_Funnel.md` is optimized around "commissioner completes onboarding and successfully invites their real league," not "individual signs up."
