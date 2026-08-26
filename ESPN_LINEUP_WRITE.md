# ESPN Lineup Write Investigation

**Superseded (Aug 26, 2026):** `/me/team/lineup/move`/`swap` no longer
call any of the write path documented below — they're a plain
`current_rosters` DB update now (`backend/app/domain/lineup_engine.py`),
part of a broader pivot off ESPN's private API for draft/rosters/
lineups entirely (see `TODO.md`'s "ESPN independence pivot" entry for
why: the single-shared-ESPN-session problem this doc's own "Open
question" section below flagged turned out to be real in production).
`ESPNLineupClient`/`lineup_client.py` itself isn't deleted yet — it's
kept for `admin_lineup.py`'s commissioner override tool and the still-
ESPN-sourced free-agent browse preview — but the core lineup-write
capability this document is about is retired. Left in place as a
historical record of the real capture work, not as active documentation
of what the app currently does.

Status as of 2026-08-19: **both single-player lineup moves and two-player
swaps/displacements are implemented and verified against real ESPN
captures.** This document records what's actually known about ESPN
Fantasy's lineup-mutation API vs. what was assumed before being verified,
for anyone who needs to re-verify or extend this later.

Every claim below is labeled:

- **VERIFIED** — confirmed against this repo's own working code or a live
  response we've actually seen.
- **COMMUNITY-REPORTED** — stated by outside sources (blog posts, other
  reverse-engineering projects) but not independently confirmed by us.
- **ASSUMED** — a reasonable guess based on a pattern elsewhere, not
  confirmed at all.
- **NEEDS CAPTURE** — cannot be known without a real captured request from
  ESPN's own web app.

## How to actually test this right now

Two HTTP surfaces call `ESPNLineupClient`'s write path now:

- `backend/app/routers/admin_lineup.py` — commissioner-session-gated
  (same `is_commissioner` gate as `/admin/sync`), any `team_id`. A
  testing/commissioner-override tool, not the owner-facing path.
  - `GET /admin/lineup/teams/{team_id}/roster`
  - `POST /admin/lineup/teams/{team_id}/set` — body
    `{"player_name": "...", "to_slot": "RB", "as_league_manager": false}`.
  - `POST /admin/lineup/teams/{team_id}/swap` — body
    `{"player_a": "...", "player_b": "...", "as_league_manager": false}`.
- `backend/app/routers/me.py` — session-gated, **owner-facing, real
  submission for everyone**. `team_id` is never accepted from the
  caller; it's resolved server-side from the signed-in owner's own
  `espn_team_id`, same discipline as every other `/me/*` route.
  `frontend/src/components/MyTeamApp.tsx` drives this as a two-step
  preview-then-confirm flow (preview endpoints below, then the real
  submit).
  - `POST /me/team/lineup/preview-move` / `preview-swap` — preview only,
    never sends anything to ESPN.
  - `POST /me/team/lineup/move` — body `{"player_name": "...", "to_slot": "RB"}`.
  - `POST /me/team/lineup/swap` — body `{"player_a": "...", "player_b": "..."}`.

Safe by default: `ESPN_DRY_RUN` defaults to `true`, so hitting any of the
POST endpoints above just returns what *would* be sent until it's
explicitly flipped in `.env` (or the environment's real config).

**Important:** this always reads live from ESPN, never from this app's
own `rosters` database table — which matters because that table can be
(and currently is, pre-draft) empty. `rosters` only gets populated by
the sync pipeline's week-by-week scan, which has two gates that both
fail for a genuinely scoreless preseason week: the full sync stops
before saving anything once it hits an all-zero-points week, and the
live-sync path for week 0 specifically hits a known `espn_api` internal
error. Neither of those affects this endpoint or the underlying write
client — confirmed by actually calling it against production: it
returned a real, full 17-player roster (keepers + auto-fill) for team 4
even with 0 rows in `rosters` for the 2026 season.

## What this app can do today

Read-only: fetch a team's live roster straight from ESPN (not our
database, which is only synced during NFL game windows and can be stale),
identify a player's current slot, validate whether a target slot is legal
for that player, detect whether a change would need to bump someone else
out of the way, and re-check a roster after a claimed change to see if it
actually took effect. All of that is implemented in
`backend/app/providers/espn/lineup_client.py`, `lineup_models.py`,
`lineup_exceptions.py`, and `slots.py`, with tests in
`backend/tests/test_espn_lineup_client.py` and `test_espn_slots.py`.

Write: **implemented.** `ESPNLineupClient.set_lineup()` and
`swap_players()` build and validate a full plan first (Phase 6 of the
original request: read roster, find player, validate slot, validate
eligibility, check lock, check displacement), then, per `ESPN_DRY_RUN`:
either log what *would* be sent (dry-run, the default) or actually send
it and verify the result before calling it a success. Both the
single-player (1-item) and swap/displacement (2-item) request shapes are
verified against real captures — see below.

## Read API — VERIFIED

`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}`

This is **VERIFIED**, not just community-reported — it's the literal
`FANTASY_BASE_ENDPOINT` constant inside the `espn_api` package
(`espn_api==0.46.0`, installed in `backend/.venv`) that this app's own
sync pipeline (`app/providers/espn/adapter.py`) hits successfully in
production every day.

## Slot IDs — VERIFIED for reading, unconfirmed for writing

`espn_api`'s `POSITION_MAP` (`espn_api/football/constant.py`) is what our
adapter already uses to correctly parse every real roster this league has
ever had — including the fact that this league's actual FLEX slot is
labeled `"RB/WR/TE"`, not `"FLEX"` (confirmed against real production data
while fixing the roster-order display bug, see `TODO.md` Phase 6).

| Slot | ID | Notes |
|---|---|---|
| QB | 0 | |
| RB | 2 | |
| WR | 4 | |
| TE | 6 | |
| D/ST | 16 | |
| K | 17 | |
| BENCH | 20 | ESPN's own label is `"BE"` |
| IR | 21 | |
| FLEX | 23 | This league's ESPN label is `"RB/WR/TE"`, not `"FLEX"` |

One real bug this caught during implementation: `POSITION_MAP`'s
string-keyed entries are **not** the reverse of its int-keyed entries —
it has `20: 'BE'` but no `'BE': 20`, and `23: 'RB/WR/TE'` but only
`'FLEX': 23` (not `'RB/WR/TE': 23`). A naive reverse-lookup through the
same dict silently mis-resolves bench/IR/flex players. `slots.py` builds
its own reverse map from the int→label direction (the verified half)
instead of trusting the dict's own string keys.

These IDs are VERIFIED as what ESPN's **read** responses use to describe
a player's current slot. It is **NOT** verified that a **write** request
uses these same integers in the same field name/shape — see below.

## Write API

Updated 2026-08-19 from a real captured request (headers only so far —
body and response still needed, see "Still needed" below).

- **Host** — `https://lm-api-writes.fantasy.espn.com` — **VERIFIED** (2026-08-19
  capture). Matches the pattern we'd guessed, now confirmed for real.
- **Path** — `POST /apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}/transactions/?platformVersion={hash}`
  — **VERIFIED** (2026-08-19 capture). **This corrects our own earlier
  guess** — the commonly-cited `/roster/` path was wrong (or at least
  not what the live web app actually calls); lineup changes go through
  `/transactions/`, the same endpoint family `espn_api`'s
  `TRANSACTION_TYPES` (`"ROSTER"` among them) already hinted at from the
  read side. The `platformVersion` query param is a hash
  (`5e254affd13eaa961c7dffbd9de59d867a2e0acf` in the captured request) —
  unknown yet whether this needs to be exact, is checked for shape/
  presence only, or is safely omittable. **NEEDS CAPTURE** to confirm.
- **HTTP method** — `POST` — **VERIFIED** (2026-08-19 capture).
- **Auth** — no `Cookie` header appeared in what was captured/shared.
  Either it was manually redacted before sharing (correct, and
  expected — see the redaction instructions above) or Chrome's header
  copy view omitted it. Either way, real browser requests to an
  authenticated endpoint like this one are essentially certain to be
  sending `espn_s2`/`SWID` via `Cookie` — treating that assumption as
  **COMMUNITY-REPORTED, not yet independently re-verified** here, since
  we haven't actually seen the header ourselves. Doesn't block anything
  else — `ESPNLineupClient` already builds requests through the same
  `espn_s2`/`swid` cookie auth the (VERIFIED, working) read path uses.
- **Other verified headers** (from the same capture):
  - `content-type: application/json`
  - `accept: application/json`
  - `x-fantasy-platform: espn-fantasy-web`
  - `x-fantasy-source: kona`
  - `origin: https://fantasy.espn.com`, `referer: https://fantasy.espn.com/`
  - `content-length: 218` — matches the actual body below.

### Request body — VERIFIED (2026-08-19 capture)

A single player moved from the FLEX slot (23) into an open TE slot (6),
no displacement:

```json
{
    "isLeagueManager": false,
    "teamId": 4,
    "type": "ROSTER",
    "memberId": "<the requesting user's own SWID-format member GUID — redacted here>",
    "executionType": "EXECUTE",
    "items": [
        {
            "playerId": 4432665,
            "type": "LINEUP",
            "fromLineupSlotId": 23,
            "toLineupSlotId": 6
        }
    ]
}
```

This answers three previously-open questions:

- **ESPN expects only the changed player(s), not the full roster** —
  the body contains a single `items` entry for the one player that
  moved, nothing else.
- **It's `type: "ROSTER"` at the top level with an `items` array of
  `type: "LINEUP"` entries**, not a bare `entries` array as some other
  ESPN write endpoints use.
- **The slot IDs in the write body are the exact same integers as the
  read side** (`fromLineupSlotId: 23` / `toLineupSlotId: 6` — FLEX and
  TE, matching `slots.py`'s `LineupSlot` enum exactly). Our read-side
  ID mapping (built from `espn_api`'s own `POSITION_MAP`) is directly
  reusable for writes — no separate write-side ID scheme.
- `memberId` matches the requesting user's own SWID-format GUID —
  same value as the `SWID` auth cookie, echoed into the body itself.
  **Redacted from this doc and from the test suite**, even though it's
  not itself a bearer credential (it's also visible via this app's own
  read API, as every owner's `espn_member_id` — see `adapter.py`) — no
  reason to keep a real user's literal ID sitting in git history.

### Response body — VERIFIED (2026-08-19 capture, HTTP 200)

```json
{
    "bidAmount": 0,
    "executionType": "EXECUTE",
    "id": "4acc33f5-f72c-4ad0-92d5-7654df3ce855",
    "isActingAsTeamOwner": false,
    "isLeagueManager": false,
    "isPending": false,
    "items": [
        {
            "fromLineupSlotId": 23,
            "fromTeamId": 0,
            "isKeeper": false,
            "overallPickNumber": 0,
            "playerId": 4432665,
            "toLineupSlotId": 6,
            "toTeamId": 0,
            "type": "LINEUP"
        }
    ],
    "memberId": "<redacted, same value as above>",
    "proposedDate": 1787175407429,
    "rating": 0,
    "scoringPeriodId": 0,
    "skipTransactionCounters": false,
    "status": "EXECUTED",
    "subOrder": 0,
    "teamId": 4,
    "type": "ROSTER"
}
```

The key field: **`"status": "EXECUTED"`** on success. ESPN echoes the
`items` back with extra server-filled fields the request didn't send
(`fromTeamId`, `toTeamId`, `isKeeper`, `overallPickNumber`, `bidAmount`
— all zero/false here, presumably meaningful for trade/waiver
transaction types that share this same endpoint). No other status value
has been observed yet — what a *rejected* write (e.g. attempting a
change after the game has locked) looks like is still unknown; per
Phase 7, this app never trusts the response status alone anyway — every
real mutation is followed by a live roster re-read
(`ESPNLineupClient.verify_lineup`) before being called a success.

### Two-item (swap/displacement) request body — VERIFIED (2026-08-19 capture)

A second capture, this time a real two-player swap (a bench player
moved into the K slot, bumping the starting kicker to the bench):

```json
{
    "isLeagueManager": false,
    "teamId": 4,
    "type": "ROSTER",
    "memberId": "<redacted — same GUID as above>",
    "executionType": "EXECUTE",
    "items": [
        {"playerId": 2473037, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 17},
        {"playerId": 3055899, "type": "LINEUP", "fromLineupSlotId": 17, "toLineupSlotId": 20}
    ]
}
```

**This confirms the 2-item shape is exactly what we'd inferred** by
mirroring the verified 1-item shape: one `LINEUP` entry per player, each
with its own `fromLineupSlotId`/`toLineupSlotId`, the two players'
before/after slots swapped between them. Same `type: "ROSTER"` envelope,
same single request (not two separate requests) — response shape
matched the single-item response too, just with two entries in `items`
and the same `"status": "EXECUTED"` on success.

With this, both **`ESPNLineupClient.set_lineup()`** (including the
displacement case — bumping whoever's in a full slot) and
**`swap_players()`** now actually send their requests when
`ESPN_DRY_RUN=false`, not just the open-slot single-item case. The
`_send_mutation` guard now only blocks 3+ item requests — nothing in
this client's planning logic produces those, and there's no capture to
verify that shape against if it ever does.

One piece of corroborating evidence that predates these captures:
`espn_api`'s own `TRANSACTION_TYPES` constant includes a value literally
named `"ROSTER"`, matching what both real bodies confirm.

## Status: core investigation closed

Both request shapes this app needs (single-item move, two-item swap/
displacement) are now verified against real captures, end to end —
host, path, method, headers, body, and success response. Nothing further
is blocking `set_lineup()`/`swap_players()` from working for real once
`ESPN_DRY_RUN=false` is set.

What's still genuinely unknown, lower priority, and fine to learn
opportunistically rather than needing a deliberate capture:
- What a **rejected** write looks like (e.g. attempting a change after
  the game has locked, or an invalid slot) — no rejection has been
  captured yet, only successes. `ESPNWriteHTTPError` handles a non-2xx
  response generically; a real rejection example might reveal ESPN
  returns a 2xx with an error-shaped body instead, which would need its
  own handling.
- Whether `platformVersion` needs to match ESPN's current frontend build
  exactly, or is checked more loosely — it's shown up consistently
  across two different endpoints/requests in the same browsing session,
  which is reassuring but not the same as testing what happens with a
  stale value.

## Open question: does one member's credentials cover other teams?

Every capture so far shows a member writing their OWN team's roster —
`memberId` in the body always matched the requesting member's own
cookie-derived GUID, and `teamId` was their own team. Whether these same
credentials (one commissioner's `espn_s2`/`SWID` in `.env`) can write a
DIFFERENT team's lineup is **not verified**, and it matters a lot for
whether this ever becomes a multi-owner feature (every owner managing
their own team from Discord/the web app) or requires collecting and
securely storing every owner's own ESPN session cookies.

The request body carries an `isLeagueManager` flag, suggesting ESPN's
backend is manager-role-aware. `set_lineup()`/`swap_players()` now
accept an `as_league_manager: bool = False` parameter (defaults to
False, matching every verified capture) specifically so this can be
tested deliberately: try writing a *different* team's lineup, once with
the flag off and once with it on, and see whether ESPN accepts or
rejects each. Two outcomes:
- **Works (with or without the flag)** — no per-owner credential storage
  ever needed; a single commissioner-level account already covers the
  whole league.
- **Rejected either way** — confirms each owner needs to authenticate
  with their own ESPN session for the app to act on their behalf, which
  is a real credential-security feature (not yet designed) — likely a
  new column or table under `owners` (which already has `espn_member_id`
  and links to `users` via `user_id` from Discord OAuth), encrypted at
  rest, with each owner submitting their own cookies through some UI.

This test hasn't been run yet — status here will move to VERIFIED once
it has.

**Decision (Aug 2026):** rather than block the owner-facing Submit
feature (`/me/team/lineup/move`/`swap`, see that router's module
docstring) on running this test first, it ships to every owner now with
a graceful fallback: a write ESPN rejects for an auth-flavored reason
(401/403), or that comes back looking successful but a follow-up roster
read shows never actually applied, is caught and turned into a plain
"couldn't submit — use the ESPN app for now" message instead of a raw
error, and logged distinctly (`ESPN lineup write rejected (auth)...` /
`...not verified after send...`) so real usage reveals which owners it
actually works for. Watch those log lines after rollout — if they show
up for every owner except team 4 (the credential holder), that's this
question answered "rejected" by real traffic, and the per-owner
credential design becomes the real next step. If they don't show up at
all, the single commissioner credential apparently covers the whole
league and this section can move to VERIFIED with no further design
work needed.

If either of those needs chasing down later, the capture process below
is kept for reference — same DevTools steps, same redaction rule.

## Reference: how to capture a request (Chrome DevTools)

1. Open `fantasy.espn.com`, go to your league, open your team.
2. Open DevTools (`Cmd+Option+I` on Mac) → **Network** tab.
3. Click the **Fetch/XHR** filter (top of the Network panel) so you're not
   drowning in image/CSS requests.
4. Make one harmless lineup change — e.g. swap a bench player into a spot
   and immediately swap it back. Any real slot change is fine; it doesn't
   need to be a change you actually want to keep.
5. In the Network panel, look for a request to a host starting with
   `lm-api-writes.fantasy.espn.com` (or, if you don't see one, sort by
   time and look at whatever fired right when you clicked "Save Lineup"/
   confirmed the change).
6. Click that request. You'll want three tabs of it: **Headers**,
   **Payload** (or **Request**), and **Response**.

### What to copy — and what to redact first

Before pasting anything here, **redact these exact fields**:

- The `Cookie` request header — it contains your live `espn_s2` and
  `SWID` session values. Replace the whole header value with
  `<REDACTED>`, don't try to trim just parts of it.
- Any `Authorization` header, if present — replace with `<REDACTED>`.
- Any header whose name contains `fantasy-authz` or similar auth-looking
  names — replace with `<REDACTED>`.
- If the **Payload** contains a `SWID` field anywhere (some ESPN requests
  echo it back in the body, not just cookies) — redact that value too.

Everything else in Headers/Payload/Response is safe to share — it's
league structure and roster data, not credentials. If you're ever unsure
whether something is a secret, redact it and say so rather than guessing;
we can ask for it specifically if it turns out to matter.

You can paste the captured request either as raw text or by using
Chrome's "Copy → Copy as fetch" / "Copy as cURL" option on the request
(right-click the request in the Network panel) — either is fine, but
**redact the Cookie/Authorization values in whatever you copy** before
pasting, using the same rule above.

Once we have that, `backend/app/providers/espn/capture.py` has a
`redact_captured_request()` helper that redacts it again defensively, and
a `compare_shape()` helper to sanity-check the captured request's method
and host against whatever we're assuming — so nothing here depends on a
human redaction being perfect on the first try.

### After a capture lands (for any future gap, e.g. a rejected write)

1. Update the relevant section above, moving the claim from
   "NEEDS CAPTURE"/"ASSUMED" to "VERIFIED".
2. Update `ESPNLineupClient` and its tests to match, the same way this
   round's two captures were incorporated.
3. **Note for the current status**: the request/response shapes are
   verified and the code sends real requests when `ESPN_DRY_RUN=false`,
   but no one has actually flipped that flag and run it against a real
   roster yet — that first real end-to-end test (ideally a harmless,
   reversible change, watched live) is still open, and per Phase 7/10 of
   the original request should be done manually, once, outside the
   automated test suite (which only ever uses mocked responses — no real
   mutation runs in CI).
4. A mutation is only ever reported as successful when a follow-up live
   roster read (`ESPNLineupClient.verify_lineup`) confirms the expected
   state — never from an HTTP 200 alone.

## Not built yet, and out of scope for this pass

Discord slash commands (`/lineup`, `/setlineup`, `/swap`) were explicitly
out of scope for this investigation — this repo (`Better_Fantasy_App`) is
the FastAPI/Next.js web app, not the original Discord bot process
(`Fantasy_Helper`, the sibling repo). The lineup mutation layer built here
lives at `backend/app/providers/espn/lineup_client.py` and is UI-agnostic
— it'll be usable from a future FastAPI route, a Discord command, or both,
once the write endpoint is verified. Building either caller now would be
premature: there's no verified write to call yet.
