# THE WEEKEND — Viral Loops & Referral Program

**Status:** Proposal for review.

---

## Part 1: Organic growth loops the product can generate

The brief's framing is right: the goal is not artificial virality, it's **one league → invites → friends → other leagues → new commissioners.** Evaluated against what actually exists today (`00_Product_Marketing_Audit.md`):

| Potential loop | Current state | Verdict |
|---|---|---|
| League invites | Real, functional (invite code + copy button) | **Real today** — the actual foundation of the whole loop. Needs the "shareable invitation" polish from `07_Commissioner_Acquisition.md`. |
| Matchup sharing | No share button, no OG tags — a pasted link shows a bare title | **Does not exist yet.** High-leverage build — see `17_Growth_Roadmap.md`. |
| Awards / power rankings sharing | Real data exists, no export/share UI | **Does not exist yet.** Among the highest-leverage builds — this is THE WEEKEND's most differentiated content (`03_Competitive_Positioning.md`). |
| Draft results / draft grades | Real data (AI-generated grades), no share/export | **Does not exist yet.** Second-highest-leverage build — draft night is peak emotional/shareable moment. |
| Championship graphics | Not found anywhere in the codebase | **Does not exist.** Needed before the first Founding League finishes a season (Phase 2, `04_12_Month_Strategy.md`). |
| Weekly AI recaps | Real, generated automatically | **Real today**, but lives only inside the app — no share/export path out to a group chat or social post. |
| Notifications (push) | Real, working pipeline | **Real today.** Not a growth loop by itself, but a retention mechanic that keeps the audience for the loops above alive. |
| Gamecast moments | Real, live | **Real today**, in-app only, no shareable clip/screenshot path. |

**The honest conclusion:** almost none of the classic fantasy-app growth loops (share a matchup, share an award, share a draft grade) exist as real product surfaces yet. This is not a marketing gap, it's a product gap, and it's the single most concrete, buildable set of changes in this entire strategy — see `17_Growth_Roadmap.md` for prioritization. The one loop that's already real and functional — invite-a-friend-to-my-league — is exactly the one that matters most (per `02_Target_Audience.md`'s commissioner thesis) and should be polished, not rebuilt.

## Part 2: What to build, in priority order (for growth-loop purposes)

1. **Shareable weekly recap/award cards** — a simple, branded image (or well-formatted OG-tagged link) generated automatically from real recap/award data, with a one-tap share to the league's existing group chat. This directly feeds Bench Crime of the Week, League Villain of the Week, and Power Rankings Reveal (`06_Content_Pillars.md`).
2. **Shareable draft-grade cards** — same mechanic, timed to draft night, THE WEEKEND's single highest-emotion moment.
3. **Open Graph/Twitter Card metadata on any link a user might paste into a group chat** (matchup, standings, draft results) — this is a small, cheap fix (the pages already have basic `<title>` metadata; adding `og:image`/`og:description` is incremental, not a rebuild) with outsized payoff, since a bare-title link actively looks broken today.
4. **A branded, pre-written invite message** — see `07_Commissioner_Acquisition.md`.

Every one of these should be gated on the multi-league frontend work (`17_Growth_Roadmap.md` P0) — a shareable card that shows League #1's data to a user in a different league would be actively broken, not just unpolished.

## Part 3: Referral program design

**Who gets rewarded:** primarily the **commissioner**, not the individual user — consistent with `02_Target_Audience.md`'s thesis that a commissioner brings a whole league in one motion. A secondary, smaller reward track exists for individual users who refer a friend into an *existing* league (a smaller but real growth vector — this is how a league grows past its original roster).

**What triggers a reward:** league **activation**, not signup. A referred league that creates an account but never drafts is not a real referral success — reward on "referred league completed a draft," not "referred league signed up." This avoids the standard referral-program failure mode of rewarding volume that never converts to real usage.

**Reward menu (all low/zero marginal cost, appropriate for a pre-revenue product):**

| Reward | For | Cost |
|---|---|---|
| "Founding Commissioner" / "Referral Champion" badge, visible in-app | Any commissioner who refers a league that activates | Zero — a data flag + a UI element |
| Early access to new features | Top referrers | Zero — sequencing, not spend |
| Custom league theme/branding options | Referring commissioners | Low — a real product feature, buildable once, reusable forever |
| Founder shout-out in the "Founding League Spotlight" content series | Any activated referred league | Zero — content already being produced |
| Future subscription-tier benefit, if/when a paid tier ever exists | Founding-era referrers, grandfathered | Zero now, deferred cost — a credible long-term incentive that costs nothing today |

**Explicitly not recommended:** cash rewards, gift cards, or paid subscription giveaways at this stage. The competitive audit's own P4 "do not build" list correctly notes THE WEEKEND has no monetization layer and doesn't need one yet — a referral program with a real cash cost creates a financial liability disconnected from any revenue, and recognition-based rewards are a better fit for a product whose actual value proposition is culture and craftsmanship, not price.

## Part 4: The loop as a whole

**One league → invites (already real) → friends join (already real) → a friend who liked it becomes a commissioner of their own league (needs the referral program above) → their league's first draft/recap gets shared (needs Part 2's builds) → someone outside either league sees it and asks their own commissioner about it.** Every link in this chain except the last is a specific, named, buildable product or program element in this document — this loop is a roadmap, not a hope.
