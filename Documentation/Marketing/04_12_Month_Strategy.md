# THE WEEKEND — 12-Month Strategy (September 2026 – September 2027)

**Status:** Proposal for review.

---

## Why the phases are ordered this way

The fantasy football calendar is fixed and unforgiving: the 2026 season runs through its playoffs in late December/early January, the offseason runs roughly February through August, and the entire addressable market — every commissioner who might switch — makes that decision in a tight window between roughly **June and late August 2027**, before their own draft. Miss that window and the next chance is a full year later. That reality, combined with the honest finding in `00_Product_Marketing_Audit.md` that the multi-league product isn't finished yet, drives the phase order below: **the product has to be ready to actually onboard a league well before the June–August 2027 window opens**, which means the "boring" finishing work has to happen now, in the fall/winter, while there's no market pressure yet and while League #1's live season provides real end-to-end testing for free.

## Phase 1 — Finish the Foundation (September – November 2026)

**Objective:** Make the product capable of doing, for a second league, what marketing will promise. Not audience-building yet — this phase produces almost no public-facing activity.

- Ship the multi-league frontend work already scoped in `TODO.md` Phase 9 (standings, matchups, draft, roster, chat, awards, power rankings all reading the active league, not League #1) — this is the single highest-priority item in the entire 12-month plan. See `17_Growth_Roadmap.md` P0.
- Resolve the brand-name inconsistency (`01_Brand_Positioning.md` Section 0).
- Build the minimum public surface: a real logged-out landing page, Open Graph/Twitter Card metadata, and a password-reset flow (a genuine trust blocker per the competitive audit's P1 list).
- Use League #1's live 2026 season (through the playoffs) as the real-world test of every fix — this is free, high-fidelity QA that a second league launching cold wouldn't get.
- Begin "building in public" content now (`16_Weekly_Execution_System.md`) — not to acquire users yet, but to start accumulating an audience and a content archive before the acquisition push needs it.

**Expected outcome:** By end of November, the product can honestly support a second real league end-to-end, and there's a small, warm audience (a few hundred people, realistically) who've been watching it get built.

## Phase 2 — Build Awareness & Prove It Works (December 2026 – February 2027)

**Objective:** Get the first handful of real, non-founder leagues running on the platform — friends of the founder, or early adopters recruited from the building-in-public audience — while League #1's season wraps and its playoffs/championship provide real, shareable content.

- Recruit 3–8 "Founding Leagues" (`15_2027_Launch_Campaign.md`) through direct, personal outreach — not broad marketing. The goal is real usage data and testimonials, not volume.
- Ship League #1's championship/awards content as the first real "this is what a season looks like on THE WEEKEND" proof point.
- Start light content-pillar production (`06_Content_Pillars.md`) aimed at commissioners, not yet paid or creator-driven.
- Fix whatever the Founding Leagues break that League #1 alone never exposed (different league sizes, different scoring rules, different roster configs).

**Expected outcome:** A handful of leagues have played a real, if partial (offseason/dead period), stretch on the platform and can honestly vouch for it. Multi-league bugs specific to *other* leagues' configurations are found and fixed now, not in August.

## Phase 3 — Build Community & Content Muscle (March – April 2027)

**Objective:** Build the recurring content cadence and community presence that Phase 5's acquisition push will lean on, and start SEO content now so it has time to index before draft season.

- Stand up the Discord/community presence (`09_Community_Strategy.md`).
- Begin the recurring content series (`06_Content_Pillars.md`) at a sustainable cadence.
- Publish the first wave of SEO-targeted content (`11_SEO_Strategy.md`) — content published in March-April has 3-5 months to gain search authority before the June-August acquisition window.
- Begin light, genuine creator outreach at the micro level (`10_Creator_Strategy.md`) — relationship-building, not a campaign yet.

## Phase 4 — Recruit Commissioners (May – June 2027)

**Objective:** This is where the commissioner-acquisition playbook (`07_Commissioner_Acquisition.md`) goes live in earnest — the product is proven (Phase 2), the content engine is warmed up (Phase 3), and commissioners are starting to think about next season.

- Launch the Founding Leagues program publicly (expanding from the invite-only Phase 2 cohort) with a clear, time-boxed value proposition (`15_2027_Launch_Campaign.md`).
- Referral program goes live (`08_Referral_Growth.md`) — timed so early Founding Leagues have something to refer their friends into before the peak rush.
- Commissioner-specific landing page and onboarding toolkit ship (`07_Commissioner_Acquisition.md`).

## Phase 5 — Pre-Season Expansion (July – August 2027)

**Objective:** This is the highest-leverage window of the entire year — every commissioner who's going to switch platforms for the 2027 season makes that call now. Full acquisition push.

- The named pre-season campaign runs at full intensity (`15_2027_Launch_Campaign.md`).
- Paid spend (if any — see budget tiers in `14_Metrics.md`) concentrates here, not spread evenly across the year.
- Creator/podcast partnerships peak here, timed to draft-prep content cycles (`10_Creator_Strategy.md`).
- Support capacity is the constraint to watch, not content output — a commissioner mid-draft-setup who hits a bug and has no answer is a lost league, not a delayed one.

## Phase 6 — 2027 Draft Season (Late August – Mid-September 2027)

**Objective:** This is the goal state named in the brief: multiple new leagues drafting on the platform. Execution mode, not growth-experimentation mode.

- Freeze non-critical product changes; this is a stability and support window, not a features window.
- Real-time monitoring of every new league's first draft — this is the highest-stakes single moment a new commissioner and their whole league will experience the product together.
- Capture draft-day content (grades, recaps, screenshots) immediately — this is the richest source of organic, shareable content all year, and the loop described in `08_Referral_Growth.md` depends on it firing in the moment, not weeks later.

## Phase 7 — Retention & Word of Mouth (Ongoing from September 2027)

**Objective:** A league that had a good Week 1 is the actual proof of everything this strategy bet on. This phase isn't a calendar month — it starts the moment Phase 6's first drafts complete and runs continuously.

- Weekly recap/awards content becomes the retention engine (it's automatic, it's differentiated, and it's the reason a league stays engaged past Week 3 — see `12_Email_Strategy.md` and `06_Content_Pillars.md`).
- Referral loops fire off real season activity (a good recap, a funny award) rather than manufactured prompts.
- This phase's real output is the input to *next* year's Phase 2: testimonials, case studies, and a second Founding Leagues cohort.

---

## The one sentence to remember about this calendar

**Every phase before May 2027 exists to make sure the acquisition push in June–August 2027 isn't spent driving commissioners to a product that lets them down mid-season** — because a burned commissioner doesn't just churn once, they tell every other commissioner they know, and there's no recovering a league's trust in the middle of a real-money season.
