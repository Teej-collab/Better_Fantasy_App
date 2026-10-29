# THE WEEKEND — SEO & Organic Discovery

**Status:** Proposal for review.

---

## Starting point: there is currently nothing to optimize

Confirmed directly against the codebase: no `sitemap.xml`, no `robots.txt`, no Open Graph/structured data, and — most importantly — **no publicly indexable content of any kind.** Every league-data page requires authenticated league membership by design (a real, deliberate security posture per the competitive audit, not an oversight to casually reverse). The only ungated endpoints (`/seasons`, `/seasons/{season}/current-week`) carry no meaningful content. This means SEO strategy here isn't "improve rankings" — it's "decide what public content should exist at all, then make it findable." That's a real product-plus-content project, not a copywriting pass.

## What to build, and why each piece earns its place

1. **The marketing landing page itself** (`00_Product_Marketing_Audit.md`, `07_Commissioner_Acquisition.md`) — the single most important SEO asset, since it's the only page that can rank for high-intent commercial-intent searches at all today.
2. **A commissioner-focused landing page** — targets exactly the search intent named in the brief ("fantasy football commissioner," "fantasy football league manager").
3. **"Alternative" comparison pages** — honest, specific pages like "an ESPN Fantasy Football alternative" and "a Sleeper alternative," written to the standard set in `01_Brand_Positioning.md`'s voice rule: real, checkable claims only, explicit about what THE WEEKEND doesn't do yet. These target real, high-intent search terms named in the brief and are a well-established, legitimate SEO pattern (not keyword stuffing) as long as the content is honest.
4. **A public "how it works" / feature-explainer set of pages** — draft, live scoring/Gamecast, league chat, commissioner tools — each answering one real search intent from the brief's list ("fantasy football live scoring," "fantasy football league chat," "fantasy football draft").
5. **The blog/content hub feeding the recurring series** (`06_Content_Pillars.md`) — text versions of the AI-recap and awards content, which double as long-tail SEO content ("fantasy football power rankings algorithm," "fantasy football weekly awards") that no incumbent has strong content for, since these are genuinely novel features.
6. **Technical basics**: `sitemap.xml`, `robots.txt`, per-page meta descriptions, and Open Graph tags on every public page (not the private league-data pages, which correctly stay gated).

## What NOT to do

- No keyword stuffing, no thin "SEO pages" that exist only to rank and provide no real content — this is explicitly called out in the brief and is also just bad long-term strategy; Google's ranking signals actively penalize this pattern now more than in past years.
- No public league directory or public league pages purely for SEO surface area — this contradicts the single-private-league product model the competitive audit correctly says not to abandon (its P4 "do not build" list).
- No fabricated superlatives ("the #1 fantasy app") anywhere in SEO copy — beyond being false, this is the fastest way to get flagged by both users and search engines as low-trust content.

## Timing

Per `04_12_Month_Strategy.md` Phase 3, the first wave of this content should publish **March-April 2027** — early enough to have 3-5 months to gain search authority before the June-August pre-season acquisition window, which is when search volume for "fantasy football app" and "ESPN fantasy alternative" naturally peaks. Publishing this content in, say, July would mean it has no time to rank before the window it's meant to serve closes.

## Realistic expectations

SEO is a multi-year compounding channel, not a Year 1 primary acquisition source — a brand-new domain with no backlink history will not outrank ESPN, Sleeper, or Yahoo's own high-authority alternative/comparison content in the first year. Its Year 1 job is to capture the specific, lower-competition long-tail terms (a league's actual questions — "how does THE WEEKEND's waiver system work" style content) and to exist at all for the commissioners who do search directly for the brand name after hearing about it elsewhere (Reddit, a creator mention, a friend) — "branded search capture" is a realistic, valuable Year 1 SEO goal even when "outrank the incumbents" isn't.
