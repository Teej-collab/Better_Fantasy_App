# ESPN Lineup Write Investigation

Status as of 2026-08-19: **write endpoint not implemented.** This document
tracks what's actually known about ESPN Fantasy's lineup-mutation API vs.
what's assumed, and exactly what's needed to close the gap.

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

Write: **not implemented.** `ESPNLineupClient.set_lineup()` and
`swap_players()` build and validate a full plan (Phase 6 of the original
request: read roster, find player, validate slot, validate eligibility,
check lock, check displacement) and then either log what *would* be sent
(dry-run, the default) or raise `WriteNotVerifiedError` (real-write mode).
There is no code path anywhere in this repo that sends a POST/PUT to ESPN.
This isn't a flag waiting to be flipped — the request body it would need
to send has never been confirmed, so there's nothing to send yet.

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
  - `x-fantasy-source:` — value got cut off in what was pasted (looked
    like it started with `kona`); **NEEDS CAPTURE** to get the exact
    full value.
  - `origin: https://fantasy.espn.com`, `referer: https://fantasy.espn.com/`
  - `content-length: 218` — tells us the body is small (roughly what
    you'd expect for a single-player slot change, not a full-roster
    payload), but not what's in it.
- **Request body shape for a single lineup slot change** — **NEEDS CAPTURE**
  (still). The 2026-08-19 capture was headers-only; the body (218 bytes,
  per `content-length`) is the one piece that actually lets us implement
  `_send_mutation` — see "Still needed" below for exactly which DevTools
  tab has it. No current (2025–2026) public source has a verified body
  either: `mkreiser/ESPN-Fantasy-Football-API` (sometimes cited as
  having transaction support — checked its actual source, it doesn't)
  and `espn_api` (this app's own dependency — zero live `.post()`/
  `.put()` calls anywhere in it) are both confirmed read-only.
- **Whether ESPN expects the full roster or just the changed player(s)**
  — **NEEDS CAPTURE**.
- **Whether it's an `entries` array or something else** — **NEEDS CAPTURE**.
- **Special requirements for a two-player swap** (single request vs. two)
  — **NEEDS CAPTURE**.
- **How lineup lock times are enforced server-side** — **NEEDS CAPTURE**.
  This app's own lock check (`ESPNLineupClient._check_not_locked`) is a
  best-effort approximation using the player's scheduled kickoff time
  from `espn_api`'s own schedule data — not a flag ESPN exposes directly,
  and not confirmed to match ESPN's actual server-side enforcement at the
  margins (e.g. a delayed game).
- **What a successful vs. failed write response looks like** — **NEEDS CAPTURE**.

One piece of corroborating (not conclusive) evidence: `espn_api`'s own
`TRANSACTION_TYPES` constant includes a value literally named `"ROSTER"`,
confirming ESPN's internal model does represent lineup changes as a
distinct transaction type — but that's from the read-side activity feed,
not a write request body, so it doesn't tell us the shape of what to send.

## What we still need from you to close this out

The 2026-08-19 capture confirmed the host, path, and method — real
progress. Still missing, from that *same* captured request:

1. **The request body** (Payload/Request tab, not Headers) — the actual
   218 bytes that were sent. This is the one piece that unblocks
   implementation.
2. **The response** — status code and response body, from the
   **Response** tab of the same request.
3. **The full `x-fantasy-source` header value** — it got cut off as
   `kona` in what was shared; needed in full.

If you still have that Network panel open (or can reproduce the same
lineup change again), click the same request and grab those three
things. If not, a fresh capture of any real lineup change works just as
well — see the steps below.

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
