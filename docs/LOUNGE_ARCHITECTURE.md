# Lounge Architecture

Standalone, password-protected watch-party rooms. Not the same feature as
Watch Party (`backend/app/routers/watch_party.py`), which is league-scoped
and membership-gated — Lounge is reachable by anyone with a link, account
optional. This doc covers the current implementation (2026-09) and the path
to the larger multi-game vision the product owner described.

## 1. Current architecture

**Backend**: `backend/app/routers/lounge.py` + `backend/app/queries/lounge.py`,
one table (`lounge_rooms`). A room has a slug (public, in the URL), a bcrypt
password hash, and a `created_by_user_id`. No membership table — anyone with
the slug and password gets in; the creator never needs the password (see
§6 Security). Create/list/close require a session; metadata and join are
public routes.

**Frontend**: `frontend/src/app/lounge/[slug]/` (public join page, outside all
app chrome) and `frontend/src/app/(app)/lounge/page.tsx` (authed "create and
manage your lounges" splash). The actual call UI is
`frontend/src/components/lounge/LoungeVideoRoom.tsx`.

**Media**: one LiveKit room per Lounge room (`lounge-{room_id}`). The backend
hand-mints LiveKit access tokens with PyJWT (`app/routers/lounge.py`'s
`join_room`) rather than pulling in LiveKit's server SDK — the same approach
Watch Party already uses.

## 2. Media architecture decision

**Chosen: LiveKit Cloud (managed), not a self-hosted SFU, not raw WebRTC.**

This was evaluated explicitly against self-hosting (mediasoup/Janus/Pion) and
direct WebRTC with our own signaling, because the product vision includes
multiple simultaneous screen shares with independently selectable audio per
viewer — a real SFU-shaped requirement, not something plain peer-to-peer
WebRTC handles cleanly past 2-3 participants.

LiveKit Cloud already provides everything that requirement needs, out of the
box, with no additional infrastructure:

- Multiple simultaneous publishers per room (many participants can screen-share
  at once — nothing about the current one-room-per-Lounge model needs to
  change to support this).
- Per-track subscription (`useTracks`, `RoomEvent.TrackSubscribed`) — a
  client can choose which video and which audio tracks it actually receives,
  which is the mechanism the "pick whose game you hear" feature needs.
  Independent audio selection per participant is a frontend subscription
  choice, not a backend or infrastructure concern.
- Simulcast and adaptive quality are built into LiveKit's client SDK.
- Already paid for, already configured (same LiveKit Cloud project Watch
  Party uses), already proven working in production.

A self-hosted SFU would mean real, ongoing operational burden (running and
scaling media servers, TURN relaying, monitoring) for zero functional
capability this app doesn't already have through LiveKit Cloud. Revisit only
if LiveKit Cloud's pricing or limits become a real constraint at scale — not
a concern at today's usage.

## 3. Screen sharing flow

Custom toggle button, not LiveKit's own built-in screen-share control in
`<VideoConference>`/`<ControlBar>` — that built-in button never requests
system/tab audio (confirmed against `livekit-client`'s
`createLocalScreenTracks`, which only captures audio when explicitly passed
`{audio: true}`) and is hidden globally by `globals.css`'s
`data-lk-source="screen_share"` targeting, the same fix Watch Party's own
"Share w/ Audio" button already made. Lounge's `ControlsBar` (in
`LoungeVideoRoom.tsx`) calls
`localParticipant.setScreenShareEnabled(!enabled, { audio: true, systemAudio: "include" })`
directly.

**Current scope is "one shared TV," not "everyone's own game tile":**
`TvScreen` in `LoungeVideoRoom.tsx` renders whichever screen-share track
`useTracks([Track.Source.ScreenShare])` returns first. If more than one
person shares at once today, only one is shown — good enough for "the host
puts a game on," not yet the full multi-game grid (see §9).

## 4. Chat

Uses LiveKit's own built-in data-channel chat (`@livekit/components-react`'s
`<Chat />` / `useChat()`), not a new WebSocket server and not the app's
existing `conversations`/`messages` tables. Two reasons: Lounge guests are
often not `owners` rows at all (no account, no league), so the existing chat
stack's assumptions don't fit; and LiveKit already provides a reliable
realtime channel into the same room, so a second realtime transport would be
pure duplication. Trade-off: chat is ephemeral — a participant who joins
late doesn't see history. Acceptable for a live watch-party; revisit if
persistent history becomes a real ask.

## 5. Fantasy overlay (foundation only, not built yet)

Not implemented in this pass. The architecture keeps room for it deliberately
separate from the media layer: any future fantasy event overlay should be a
frontend UI layer reading from the app's existing scoring/event data (never
duplicating the scoring engine), rendered as a floating card over
`LoungeVideoRoom`'s layout — not burned into the shared video stream itself,
and not coupled to LiveKit at all beyond needing "the Lounge is currently
open" as a mount condition. The NFL scores sidebar (`LoungeNflSidebar.tsx`)
is the first, simplest version of "Weekend data alongside the video" — it
reads the same public `/nfl/scoreboard` endpoint every other ticker in the
app already uses, polled every 30s.

## 6. Security model

- Reuses the app's existing session/JWT auth (`app/auth/session.py`) —
  no second auth system. Create/list/close require a real session; join is
  public.
- A room's own creator never needs the password to (re)join — `join_room`
  checks `session_payload["user_id"] == room["created_by_user_id"]` and
  skips password verification entirely for that one case. Nobody else can
  ever match that check.
- Guests need the room's slug (96 bits of entropy, `secrets.token_urlsafe(12)`)
  plus the password, typed separately — never embedded in the shared link.
- Brute-force lockout (8 wrong attempts → 15 min lock) lives directly on the
  `lounge_rooms` row (`failed_attempts`/`locked_until`), since there's no
  Redis/rate-limiter dependency in this codebase. Per-room, not per-IP —
  sufficient for "someone guessing one room's password," not a general WAF.
- A closed room 404s identically to a nonexistent one at the join endpoint
  (more conservative than the metadata endpoint, which does say "closed" for
  UX reasons).

## 7. Sports content / redistribution

Screen sharing here is strictly user-initiated, within a private,
password-gated room the sharer chooses to open — the same as any video call
where a participant shares their own screen. Nothing in this system
downloads, stores, re-encodes, or redistributes broadcast video; LiveKit
relays whatever the sharer's own browser is already showing them, to the
other people they've explicitly invited into their own private room. Any
broader question about broadcast rights is a legal/product question for the
team, not something this architecture doc resolves.

## 8. Known limitations (today)

- Single shared screen, not independently selectable multi-game tiles.
- No independent audio-source selection — everyone hears whatever's playing
  in the current screen share plus everyone's mic, mixed by LiveKit normally.
- No reconnect UX beyond LiveKit's own client-side retry — a dropped
  connection surfaces as an error with a Rejoin button
  (`LoungeVideoRoom.tsx`'s `connectError` state), not a seamless
  auto-recovery.
- No host moderation tools (mute-others, kick, end-for-everyone) — only
  close-the-room (which stops new joins, doesn't end existing connections).
- Chat has no persistence/history.
- Mobile gets a functional but basic experience (slide-up panels for scores/
  chat); not the bespoke swipe/PiP mobile design a full rebuild would want.

## 9. Path to the full multi-game vision

The eventual target: each participant can share their own game, viewers see
multiple tiles simultaneously, and each viewer independently picks which
tile's audio they hear (with mic/voice chat mixed in separately). This is a
frontend/UX rebuild on top of the *same* LiveKit Cloud infrastructure — no
new backend, no new media provider, no schema change of any real size:

- Render every active screen-share track as its own tile
  (`useTracks([Track.Source.ScreenShare])` already returns all of them —
  today's `TvScreen` just takes only the first).
- Per-tile audio: subscribe to a given participant's microphone/screen-share
  audio track only when the viewer selects it (`trackRef.publication.setSubscribed`
  or per-track volume control via `useTrackVolume`/muting all-but-one), muting
  the rest client-side rather than server-side — each viewer's choice is
  independent and never affects what anyone else hears.
- Layout: a responsive grid (2x2 up to 4, scrolling/paging beyond that),
  distinct from the single "TV" hero layout.
- Mobile: primary tile + a strip of smaller tiles, swipe to change primary —
  not a shrunk desktop grid.

This is a substantially larger UI build than the current one-TV version, not
an infrastructure change — tracked as a separate, dedicated effort.
