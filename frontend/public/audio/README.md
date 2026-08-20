# Audio files for the landing page

`WeekendLanding.tsx` looks for these two files here and plays them
automatically (pour once on load, jazz looping softly underneath) —
just drop them in with these exact names and it starts working, no
code changes needed:

- `pour.mp3` — a short drink-pour sound effect
- `lofi-jazz.mp3` — an ambient loop, ideally seamless (no jarring
  start/end so the loop isn't noticeable)

Until these exist, the page works fine with no sound at all — the
`<audio>` elements just fail to load silently.
