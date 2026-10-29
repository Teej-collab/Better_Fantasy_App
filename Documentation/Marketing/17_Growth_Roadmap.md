# THE WEEKEND — Growth Roadmap, Product Prioritization & Final Recommendation

**Status:** Proposal for review. This is the capstone document — read it alongside `00_Product_Marketing_Audit.md`.

---

## 1. Product changes required for marketing to work at all

Ranked by leverage, not by size. Several of these are small builds with outsized effect; a few are the real, larger work this whole strategy depends on.

| Change | Why it matters for marketing specifically |
|---|---|
| **Finish making the frontend league-aware** (standings, matchups, draft, roster, chat, awards, power rankings all read the active league, not League #1) | Every other item on this list is pointless if a second league can't actually use the product. This is not a marketing feature — it's the precondition for marketing existing at all. |
| **Resolve the brand name** ("THE WEEKEND" vs. "Weekend League") | Cheap now, expensive once it's on a landing page, a T-shirt, or a Reddit thread. |
| **A real public landing page** (logged-out visitors currently see an auth-gate animation, not marketing content) | There is currently nowhere to send anyone. |
| **A commissioner-specific landing page** | The primary customer (`02_Target_Audience.md`) needs a page speaking directly to them, not a generic homepage. |
| **Shareable recap/award/draft-grade cards + Open Graph metadata** | The product's most differentiated content (AI recaps, awards, draft grades) currently has zero path out of the app. This is the growth-loop engine described in `08_Referral_Growth.md`. |
| **A branded, pre-written league invite message** | Lowers the real friction named in `07_Commissioner_Acquisition.md` — the commissioner shouldn't have to write their own pitch to their league. |
| **Password reset flow** | A real account-recovery dead end today; a trust blocker independent of marketing, but marketing traffic makes the exposure real rather than theoretical. |
| **League invitation + weekly recap emails** | The literal mechanism of both the growth loop and the retention engine; neither exists today (`12_Email_Strategy.md`). |
| **sitemap.xml / robots.txt / basic SEO scaffolding on public pages only** | Table stakes once the landing/commissioner pages exist; near-zero cost. |
| **A minimal analytics view for league-level funnel metrics** (leagues created → activated → retained) | The existing analytics taxonomy is real but narrow (`page_view` + two feature events per `00_Product_Marketing_Audit.md`); the funnel in `13_Growth_Funnel.md` can't be measured without this. |

## 2. Prioritization (P0–P3)

**P0 — absolutely necessary, blocks everything else:**
- Finish the multi-league frontend.
- Resolve the brand name.
- Ship a real public landing page + commissioner landing page.
- Password reset flow.

**P1 — high impact, should follow immediately after P0:**
- Shareable recap/award/draft-grade cards + Open Graph metadata.
- Branded league invite message/toolkit.
- League invitation email + weekly recap email.
- Basic SEO scaffolding on the new public pages.

**P2 — valuable, sequence into Phase 3-4 (`04_12_Month_Strategy.md`):**
- Referral program mechanics (tracking, badges, reward fulfillment).
- Discord community stand-up.
- Comparison/alternative SEO content pages.
- Minimal league-funnel analytics dashboard.
- Commissioner onboarding email sequence.

**P3 — nice to have, do not build before P0-P2 are done:**
- Automated ESPN/Sleeper/Yahoo import for brand-new self-serve leagues (build only once real commissioner demand is confirmed, per `07_Commissioner_Acquisition.md`).
- Championship-specific graphics templates (needed once, but not before a league is close to finishing a season).
- Paid-tier infrastructure (explicitly not recommended yet — see the existing competitive audit's own P4 list, which this strategy agrees with).

**The 20% that produces 80% of the result:** finishing the multi-league frontend, resolving the name, and shipping the shareable-content builds (P0 + the first half of P1). Everything else in this 18-document strategy is amplification of those three things — a great content calendar pointed at a product that can't onboard a second league, or a referral program with no shareable output to refer, produces nothing.

## 3. The 12-month calendar

| Month | Primary objective | Marketing objective | Product objective | Social focus | Community | Commissioner acquisition | Creator outreach | SEO | Email | Major activity | Key metric | Expected outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Sep 2026** | Finish the foundation | Start building in public (low volume) | Ship multi-league frontend work | Weekly Ship Log begins | Genuine Reddit/X participation only | None yet | None yet | None yet | None yet | League #1's live season = free QA | Multi-league bugs found & fixed | Product nearing real second-league readiness |
| **Oct 2026** | Finish the foundation | Continue building in public | Resolve brand name; landing page scaffolding begins | Weekly Ship Log | Same | None yet | None yet | None yet | None yet | — | Brand decision made | Name resolved across product |
| **Nov 2026** | Finish the foundation | Continue building in public | Landing page + commissioner page ship; password reset ships | Weekly Ship Log | Same | Soft groundwork (no push yet) | Early warm relationship-building only | Technical scaffolding | Invitation + recap email built | League #1 playoffs = content source | P0 product items complete | Product genuinely ready for a second real league |
| **Dec 2026** | Prove it works | League #1 championship content | Shareable card builds (P1) | Championship/season-recap content | Discord not yet public | Recruit 3-8 Founding Leagues, personal outreach only | Continue warm relationships | — | Recap email live | League #1 championship | 3-8 Founding Leagues recruited | First non-founder leagues on the platform |
| **Jan 2027** | Prove it works | Founding League early feedback loop | Fix bugs Founding Leagues expose | Founding League early spotlight (soft) | Same | Support existing Founding Leagues | Same | — | Same | Post-mortem on Phase 1-2 | Founding League activation rate | Real multi-league usage data exists |
| **Feb 2027** | Prove it works → transition to content | Referral mechanics groundwork | Referral program build begins | Content pillar cadence testing begins | Same | Same | Same | First SEO content drafted | Onboarding sequence built | — | Content cadence consistency | Ready to scale content in March |
| **Mar 2027** | Build community & content | Full content-pillar cadence begins | Referral program ships | 3x/week TikTok/Reels begins | Discord goes public | Light, not yet a push | Formal micro-creator outreach begins | First SEO content publishes | Onboarding sequence live | Discord launch | Community size, content cadence held | Content + community engine running |
| **Apr 2027** | Build community & content | Continue | Polish based on real usage | Continue | Grow Discord organically | Light | Continue | Second SEO wave | — | — | Engagement quality, not just volume | Warmed audience ahead of acquisition push |
| **May 2027** | Recruit commissioners | Founding Leagues program opens publicly | Any remaining P2 items | Commissioner-focused content ramps | Community as source of first public applicants | **Active push begins** | Outreach → real partnerships | Comparison pages live | Commissioner sequence live | Public Founding Leagues launch | Leagues applying, commissioner landing page conversion | Real pipeline of interested commissioners |
| **Jun 2027** | Pre-season expansion | Campaign ("Draft Somewhere That Remembers") launches | Stability-focused only | Peak cadence | Active | Full push | Peak partnership activity begins | — | Campaign sequence | Campaign launch | Leagues created, invite acceptance rate | Momentum building into peak window |
| **Jul 2027** | Pre-season expansion | Campaign peak | Stability-focused only | Peak cadence | Active | Full push | Peak | — | — | Peak spend window (if any) | Draft completion rate | Majority of new leagues forming |
| **Aug 2027** | Pre-season expansion → draft season | Campaign peak → execution mode | Freeze non-critical changes | Draft Grade Roasts daily | Active, high-touch support | Full push → support mode | Peak → support mode | — | Draft reminder emails live | Draft season begins | Draft completion rate, Week 1 lineup-set rate | Multiple new leagues drafting |
| **Sep 2027** | 2027 draft season / goal state | Real-time monitoring, capture content live | Stability & support | Live capture (Sunday Meltdown, etc.) | High-touch support | Support existing, not new push | Support existing relationships | — | Week 1/weekly recap live | **Target state: multiple new leagues playing real 2027 seasons** | Active leagues, Week 1 retention | Brief's stated goal achieved |

*A more detailed breakdown of June-September 2027 (the highest-stakes window) is in `15_2027_Launch_Campaign.md`.*

## 4. Final strategic recommendation

**If I were investing my own money into THE WEEKEND, would I pursue this marketing strategy?** Yes, but only in the order written — spend nothing on audience-building until the P0 product items in Section 2 are done. The strategy itself is sound; the risk isn't the plan, it's the temptation to start Phase 4-6 activity early because it's more exciting than finishing frontend plumbing.

**What I'd be most worried about:** that the founder — who has shown real appetite for building differentiated, exciting features (AI recaps, chug leaderboard, power rankings) — keeps doing that instead of finishing the unglamorous multi-league frontend work, the same sequencing pattern the existing competitive audit already caught once (waivers and lineup lock got built after AI recaps and chug leaderboard, not before). The single biggest threat to this entire 12-month plan is not a competitor and not a lack of audience — it's the product not being ready for the audience when it arrives.

**What I'd double down on:** the shareable-card builds (`08_Referral_Growth.md`) and the "content the product already generates" system (`16_Weekly_Execution_System.md`). This is the cheapest, most differentiated, most defensible lever available to a small team, and it's currently sitting almost entirely unbuilt despite the underlying data already existing.

**What I'd stop doing (if it were happening):** treating "THE WEEKEND" as a marketable brand while the product itself says "Weekend League." Small, but it's exactly the kind of inconsistency that erodes the trust this whole strategy depends on.

**What I'd build, right now, before anything else:** the multi-league frontend. Full stop. Nothing in this 18-document strategy has any value until a second league can actually play a season on this product.

**What I would NOT build:** a paid tier, dynasty/taxi-squad infrastructure, a public league directory, auction drafts, or native highlight video — all correctly ruled out already by the existing competitive audit's P4 list, and this strategy agrees with every item on it. Chasing feature parity with Sleeper/ESPN/Yahoo is not the game to play; depth-of-care for a smaller set of leagues is.

**What I'd test first:** whether the shareable award/recap cards actually get shared once built — this is the single riskiest untested assumption in the whole strategy (that THE WEEKEND's differentiated content is genuinely share-worthy outside the league that generated it). Ship the smallest possible version (even a manually-generated image for League #1's own content) and watch whether it gets forwarded before building the full automated pipeline.

**The single biggest opportunity:** the AI-recap/awards/power-ranking system is a real, working, differentiated content engine that no competitor researched in the existing audit confirms having natively — and it currently produces zero marketing value because it has no path out of the app. Closing that one gap (shareable cards) may be worth more than every other tactic in this document combined.

**The single biggest threat:** launching the acquisition push in `15_2027_Launch_Campaign.md` before the product can actually support the leagues it attracts. A commissioner who moves their real-money league to THE WEEKEND and has a bad first month will not just churn — per `07_Commissioner_Acquisition.md`, they'll actively warn other commissioners away, in the same Reddit threads and Discord servers this strategy is counting on for organic reach. The downside of moving too fast is asymmetric and durable in a way the upside of moving fast is not.

**What would make THE WEEKEND capable of acquiring hundreds or thousands of leagues:** not a bigger marketing budget — the infrastructure honesty check in `00_Product_Marketing_Audit.md` (no Redis-backed WebSocket layer, in-memory rate limiting, single-league-assumption gaps still being found reactively in the `rivalries`/`chat` tables) means the technical path to "thousands of leagues" is a separate, real scaling project that this marketing strategy doesn't cover and shouldn't be assumed to have solved by success alone. Hundreds of leagues is a realistic 2-3 year outcome if the base-case scenario in `14_Metrics.md` holds and compounds via the referral loop; thousands requires both that compounding *and* a scaling investment this document doesn't scope. Say that plainly rather than implying the marketing plan alone gets there.
