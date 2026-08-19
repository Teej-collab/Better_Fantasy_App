# ESPN Lineup Write Investigation

Status as of 2026-08-19: **single-player lineup moves are implemented and
verified against a real ESPN capture; swaps/displacements are implemented
but blocked from actually sending until a 2-item request is captured.**
This document tracks what's actually known about ESPN Fantasy's
lineup-mutation API vs. what's assumed, and exactly what's needed to close
the remaining gap.

Every claim below is labeled:

- **VERIFIED** — confirmed against this repo's own working code or a live
  response we've actually seen.
- **COMMUNITY-REPORTED** — stated by outside sources (blog posts, other
  reverse-engineering projects) but not independently confirmed by us.
- **ASSUMED** — a reasonable guess based on a pattern elsewhere, not
  confirmed at all.
- **NEEDS CAPTURE** — cannot be known without a real captured request from
  ESPN's own web app.

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

Write: **partially implemented.** `ESPNLineupClient.set_lineup()` and
`swap_players()` build and validate a full plan first (Phase 6 of the
original request: read roster, find player, validate slot, validate
eligibility, check lock, check displacement), then, per `ESPN_DRY_RUN`:
either log what *would* be sent (dry-run, the default) or actually send
it. Real sending only happens for a **single-player move into an open
slot** — the exact shape verified below. A **swap or a displacement**
(2 players changing slots at once) is fully planned and validated the
same way, but `_send_mutation` refuses to actually POST it — raising
`WriteNotVerifiedError` even with dry-run off — because that 2-item
request body has never been captured, only inferred. See "What's
implemented now vs. still open" below.

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

### What's implemented now vs. still open

With the above, `app/providers/espn/lineup_client.py` now actually sends
this exact request when `ESPN_DRY_RUN=false` — **for the single-item
case only** (a player moving into an open slot). A **displacement or a
two-player swap needs a 2-item body**, which this capture didn't show —
that shape is our own inference (mirroring the verified 1-item entry:
each player gets their own `LINEUP` item with its own from/to slot), and
`_send_mutation` deliberately refuses to send it — even with dry-run
off — until a real 2-item capture confirms it. Dry-run mode still shows
exactly what a swap/displacement *would* send, for review.

One piece of corroborating evidence that predates this capture:
`espn_api`'s own `TRANSACTION_TYPES` constant includes a value literally
named `"ROSTER"`, matching what the real body now confirms.

## What we still need from you to close this out

One more capture: **a two-player swap** (or any lineup change that
displaces an existing starter, e.g. moving a bench player into an
already-full slot). That's the only remaining unverified piece — it
tells us whether ESPN sends that as a single `transactions` request with
2 `items` (our current assumption) or as two separate requests.

### How to capture it (Chrome DevTools)

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

### After a capture lands

1. Confirm/replace the host, path, method, headers, and body shape above,
   moving every "NEEDS CAPTURE" row to "VERIFIED".
2. Implement the real write call behind `ESPNLineupClient._send_mutation`,
   gated the same way it is now: dry-run by default, and a real write only
   when `ESPN_DRY_RUN=false` is explicitly set.
3. Test it exactly once, manually, against a real (non-critical) lineup
   change — never in the automated test suite, which uses mocked
   responses only (see Phase 7/10 of the original request: no real
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
