# THE WEEKEND — Brand Positioning & Core Message

**Status:** Proposal for review. Assumes the resolution recommended in Section 0 below.

---

## 0. First: resolve the name

The codebase calls this product **"Weekend League"** everywhere a user can see — the browser tab, the PWA manifest, the logo, the sign-in screen. This strategy (like the brief that requested it) calls it **THE WEEKEND**. Both cannot be true in public at the same time; a commissioner who signs up, sees "Weekend League" on the login screen, and then sees "THE WEEKEND" on a TikTok or a landing page will reasonably wonder if they're the same product.

**Recommendation:** Adopt **THE WEEKEND** as the brand name going forward, and treat "Weekend League" as a retired working title, not a co-brand. Reasons: "THE WEEKEND" is the more ownable, more marketable name — it survives outside a fantasy-football context (a name, a hashtag, a domain), where "Weekend League" reads as a generic category description and is harder to trademark-search cleanly. This requires a small, concrete product change (rename in `layout.tsx`, `manifest.json`, `BrandMark.tsx`, the logo asset, and page titles) that should happen **before** any public-facing material ships — it's cheap now and expensive after the name is on a T-shirt or a Reddit thread. This is listed as a P0 item in `17_Growth_Roadmap.md`.

Everything below assumes that decision is made. If the founder prefers to keep "Weekend League" as the product name and use "THE WEEKEND" only as a seasonal campaign or content-brand name (e.g., the way "March Madness" sits inside NCAA basketball), that also works — but it must be a deliberate choice, stated once, and applied consistently. What can't survive is accidental inconsistency.

---

## 1. One-sentence positioning

> **THE WEEKEND is the fantasy football home for a league that wants to feel like its own show — real scoring, a real draft room, and a season that writes its own highlight reel.**

## 2. 10-second elevator pitch

> "It's fantasy football, but your league gets its own AI-written recaps, real power rankings, and a running record book — instead of a spreadsheet with a scoreboard bolted on."

## 3. 30-second pitch

> "Sleeper, ESPN, and Yahoo are built for a hundred million users, so your league is just twelve rows in a database to them. THE WEEKEND is built the way a league actually experiences a season — draft night, waiver drama, a rivalry that's been going for years, the guy who always chokes in Week 12. It's got the real stuff: live scoring, a real draft room, waivers, a lineup lock that actually locks. But it also writes your league's story for you — AI recaps after every week, real draft grades, a power-ranking algorithm, an all-time record book that updates itself. It's free, it's fast, and it was built by someone who plays in the league it was built for."

## 4. Website headline

> **Your league deserves better than a spreadsheet with a scoreboard.**

Alternates:
- "Fantasy football that actually remembers your league."
- "The app your league group chat has been begging for."

## 5. Website subheadline

> Real drafts, real scoring, real waivers — plus the stuff ESPN and Yahoo will never build for a 12-person league: AI recaps, power rankings, and a record book that writes itself.

## 6. Commissioner-focused pitch

> "You're the one who has to explain the rules, settle the disputes, and keep the league alive year over year. THE WEEKEND gives you real commissioner tools — trade review, force-edit, league polls, granular scoring rules — and it does the thankless part for you: it computes your power rankings, writes your weekly recaps, and keeps a running record book, so you're not the one manually posting 'nice job this week' in the group chat every Monday."

## 7. Player-focused pitch

> "You already have the group chat, the trash talk, the rivalry that's been going since 2019. THE WEEKEND gives that a home — real-time scores, a live Gamecast, chat that's actually built into the app instead of a separate group text, and a recap that roasts you by name if you benched the wrong guy."

## 8. Social media bio (160 chars)

> Fantasy football built for leagues that already have a personality. Real draft, real scoring, AI recaps, power rankings. Free. 🏈

## 9. App Store description concept (short)

> **THE WEEKEND — Fantasy Football, With a Memory**
> Draft, score, and manage your league with a real snake draft, waivers, and lineup locks. Then let THE WEEKEND do what no other app does: AI-written weekly recaps, real power rankings, and an all-time record book that updates itself every week. Built by a commissioner, for commissioners.

## 10. "Why THE WEEKEND?" message

> Every other fantasy platform is built to serve millions of leagues identically. THE WEEKEND is built to make *your* league's season feel like its own story — because a league you've played in for five years isn't a row in a database, it's a rivalry, a running joke, a guy who never lives down 2023. We build the boring stuff (real scoring, real waivers, a lineup lock) so we can spend the rest of our time building the stuff that makes your league feel like *your* league.

## 11. Competitor differentiation, in one line each

| Competitor | Their strength | Their weakness | THE WEEKEND's angle |
|---|---|---|---|
| Sleeper | Free, chat-first, best-in-class design, deepest dynasty tooling | Cross-subsidized by a real-money betting product; social features are generic, not league-specific | Culture built for *your* league, not a design system applied to every league identically |
| ESPN | Official NFL fantasy game, real broadcast data, fastest injury news | 2025 redesign backlash, current Sunday-reliability complaints | Smaller, faster-moving, and not trying to be everyone's app |
| Yahoo | Deepest scoring customization, longest league continuity, cleanest paid tier | Institutional feel, current reliability complaints of its own | A product actually run by someone who's in a league, not a division of a media company |

## 12. Brand voice

**Fun, competitive, social, sports-culture-driven, a little edgy, community-oriented — but trustworthy.** In practice:

- Write like a smart friend who's also in the league, not a SaaS company. Never say "leverage," "seamless," "empower," "solution," or "elevate your fantasy experience."
- It's allowed to talk trash. It's allowed to have a favorite team's colors on a T-shirt. It should never mock a real user by name outside of the AI recap feature they opted into by being in the league.
- Confidence without overclaiming: never say "the best fantasy platform" — say specific, checkable things ("real waivers," "a lineup lock that locks," "an AI recap after every week") instead of superlatives that invite an argument.
- Every piece of public copy should survive the question "would a knowledgeable fantasy manager roll their eyes at this?" If a claim isn't true today (see `00_Product_Marketing_Audit.md`), it doesn't go in copy — not "coming soon," not implied, not true.

## 13. Founder story (for "building in public" content — see `16_Weekly_Execution_System.md`)

THE WEEKEND started as a Discord bot posting stats and recaps to one real 12-person money league. The bot couldn't do lineup management or live scoring, so its builder — a member of that same league — rebuilt it as a real web app, then rebuilt the league's draft, rosters, waivers, and scoring engine natively rather than staying dependent on a private, unofficial ESPN API. The app now runs that league's real 2026 season end-to-end. It's being opened up to other leagues because the person building it thinks other commissioners are tired of the same three platforms treating their league like a spreadsheet, and because the thing that makes it good for one league — real attention to a small group's actual season — is the same thing that could make it good for a hundred. That's a true story, not a manufactured one, and it should be told plainly rather than dressed up as a startup pitch.
