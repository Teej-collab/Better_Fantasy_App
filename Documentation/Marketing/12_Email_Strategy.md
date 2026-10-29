# THE WEEKEND — Email & Notification Lifecycle Strategy

**Status:** Proposal for review.

---

## What already exists

Real, working Web Push infrastructure (VAPID keys, `pywebpush`, dead-subscription cleanup) with real trigger wiring for chat, draft events, and fantasy-activity events — per the competitive audit, this pipeline is genuinely more built-out than a first glance suggests. **There is no email system at all** — no transactional email, no lifecycle email, no email address verification. This means the plan below is a build, not a tuning pass, and should be scoped accordingly in `17_Growth_Roadmap.md`.

## Principle: every message has a job

Per the brief's instruction, nothing below is generic "engagement" messaging — each entry states the specific decision or action it exists to prompt.

| Moment | Channel | Purpose | Notes |
|---|---|---|---|
| New account created | Email | Confirm the account exists, set expectations | Also the natural home for a future password-reset flow, which doesn't exist yet and is a real trust gap (competitive audit P1) |
| New league created | Email + push | Confirm league settings, hand the commissioner the invite link/message immediately | This is the moment `07_Commissioner_Acquisition.md`'s toolkit should be delivered automatically, not left for the commissioner to find |
| League invitation received | Email | Get an invited player to actually join, not just be told about it | The single highest-leverage lifecycle email — this is the literal mechanism of the growth loop in `08_Referral_Growth.md` |
| Commissioner onboarding (post-league-creation, pre-draft) | Email sequence (2-3 emails) | Walk the commissioner through the remaining setup steps if they've stalled | Only fires if the commissioner hasn't completed onboarding within a set window — a nudge, not a drip campaign |
| Draft scheduled / draft reminder | Email + push | Get everyone in the room on time — a stalled/incomplete draft is a first-week failure mode worth actively preventing | Push already exists for "on the clock" per the competitive audit; email reminder (24hr/1hr before) is the gap |
| Game day | Push only | Real-time relevance — email is too slow for this moment | Already real per the competitive audit |
| Weekly recap | Email + push | Deliver the AI recap/awards content to people who don't open the app proactively | This is a retention-and-content-distribution mechanic simultaneously — see `06_Content_Pillars.md` |
| Playoffs | Email + push | Heighten stakes messaging, bracket updates | Only meaningful once a league is deep into a season |
| Championship | Email | A real, celebratory, shareable moment — the natural trigger for `08_Referral_Growth.md`'s championship-graphic loop | High-value, low-frequency (once/league/season) |
| Offseason | Email (low frequency) | Keep the league's commissioner warm without being noise — a single "here's what's new" touch every few weeks at most | This is where Founding Leagues / building-in-public updates belong, not general marketing |
| Preseason (next year) | Email | Re-engage the prior season's leagues to set up their next draft | This is the actual "did they come back" retention test — see `13_Growth_Funnel.md` |
| 2027 season kickoff | Email + push | Standard season-start messaging, same as any new draft/kickoff cycle above | No special new mechanic needed — this is where all the above simply recurs |

## What this explicitly is not

Not a marketing-blast newsletter. Not a re-engagement drip designed to manufacture urgency. Every entry above is tied to a real state change in a real league (created, invited, drafting, scored, won) — this is the ethical lifecycle model the brief asked for, and it's also simply the right design: a fantasy app's own season IS the content calendar, so there's no need to invent occasions to email people.

## Build priority

Given nothing exists today, sequence by leverage: **league invitation email** and **weekly recap email** first (directly serve the growth loop and the core retention mechanic), **password reset** second (a real trust/account-safety gap, not a growth feature but a prerequisite the competitive audit already flagged as P1), everything else following as the product's multi-league maturity (`17_Growth_Roadmap.md` P0) makes it relevant.
