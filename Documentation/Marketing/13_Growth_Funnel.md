# THE WEEKEND — 2027 Acquisition Funnel

**Status:** Proposal for review.

---

## The funnel

```
SOCIAL POST / REDDIT / CREATOR MENTION
        ↓
LANDING PAGE  (does not exist yet — P0, see 17_Growth_Roadmap.md)
        ↓
SIGN UP  (real, works today)
        ↓
CREATE / JOIN LEAGUE  (real, works today)
        ↓
INVITE LEAGUE  (real invite code exists; branded/shareable version does not — see 08_Referral_Growth.md)
        ↓
ACTIVATION  (league members actually join and set up teams)
        ↓
DRAFT  (real, strong feature; only fully reliable for League #1 today — see 00_Product_Marketing_Audit.md)
        ↓
WEEK 1  (only reliable for League #1 today — rest of frontend not league-aware yet)
        ↓
WEEKLY ENGAGEMENT  (recaps, awards, chat, Gamecast — real, differentiated, but same caveat above)
        ↓
RETENTION  (season-long usage, return for 2028 draft)
        ↓
REFERRAL  (commissioner brings another league — see 08_Referral_Growth.md)
```

## Where the biggest drop-offs will happen, and why

| Stage | Biggest risk | Why | Mitigation |
|---|---|---|---|
| Social post → Landing page | No landing page exists yet | Every upstream awareness effort currently has nowhere real to send traffic | P0 build, `17_Growth_Roadmap.md` |
| Landing page → Sign up | Vague or overclaiming copy triggers the skepticism named in `00_Product_Marketing_Audit.md` Q10 | A fantasy-savvy visitor evaluates trust fast | Apply the brand-voice honesty rule (`01_Brand_Positioning.md`) rigorously on this exact page |
| Create league → Invite league | The invite flow is functional but unbranded/low-effort today (a bare code) | A commissioner has to do real work to explain the app to their league themselves | Ship the branded invite message/toolkit (`07_Commissioner_Acquisition.md`) |
| Invite league → Activation | Invited players don't act on an email/text they weren't expecting | No invitation email exists yet (`12_Email_Strategy.md`) | Build the invitation email as a P0/P1 item |
| Activation → Draft | **The single largest real risk in the whole funnel today**: most of the app isn't league-aware yet, so a second league's draft/roster/standings experience may simply not work correctly | This is a product bug, not a funnel-design problem | Do not run acquisition at volume until `17_Growth_Roadmap.md` P0 ships — this is the entire thesis of this strategy |
| Draft → Week 1 | A league that had a confusing or broken draft won't come back for Week 1 | Draft night is the first and most memorable multi-person experience of the product | Real-time monitoring during Phase 6 (`04_12_Month_Strategy.md`), not just post-hoc bug fixing |
| Week 1 → Weekly engagement | A league that doesn't discover the recap/awards/power-ranking features in the first two weeks may never form the habit | These features are real but historically under-discoverable even for League #1 (the commissioner's own words: "I don't see it at all anywhere," re: draft grades, per the competitive audit) | Push/email delivery of weekly recap content (`12_Email_Strategy.md`), not passive in-app-only discovery |
| Weekly engagement → Retention | A league's season simply ends in December/January with no natural next touchpoint | Fantasy football has a hard offseason gap | Preseason 2028 re-engagement email (`12_Email_Strategy.md`), championship content as a high note to end on |
| Retention → Referral | A satisfied commissioner doesn't think to recommend the platform unless prompted | Referral isn't top-of-mind by default | The referral program (`08_Referral_Growth.md`) and shareable content (award/recap cards) need to make the ask visible at the right moment, not rely on spontaneous recommendation |

## How to measure each stage

| Stage | Metric |
|---|---|
| Landing page | Unique visitors, visitor → signup conversion rate |
| Sign up | Signups, signup → league-created-or-joined rate |
| Create/join league | Leagues created, invite codes generated |
| Invite league | Invites sent, invite → join conversion rate |
| Activation | % of invited members who actually join + set up a team within N days |
| Draft | Draft completion rate (leagues that start a draft and finish it) |
| Week 1 | % of activated leagues that set a lineup in Week 1 |
| Weekly engagement | Week 4 retention (active users/leagues), recap open rate |
| Retention | Season-long retention, return rate for the following season |
| Referral | Referral rate (leagues referred per active league), referred-league activation rate |

Full metric definitions and targets are in `14_Metrics.md`. The funnel above is the map; that document is the dashboard.
