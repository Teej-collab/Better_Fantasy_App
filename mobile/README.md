# Weekend League — native app (Expo)

A React Native rebuild of the app, talking to the same FastAPI backend as `frontend/`. The backend needs no changes: it reads `Authorization: Bearer <token>` the same way it reads the web app's session cookie.

## Run it on your phone

1. Install **Expo Go** from the App Store.
2. In this folder:

   ```
   npm install
   npx expo start
   ```

3. Scan the QR code with the iPhone Camera app. Changes you save show up on the phone immediately.

The app talks to the production backend by default (`.env`). To use a local backend instead, create `.env.local` with `EXPO_PUBLIC_API_BASE_URL=http://<your-mac>.local:8000`.

Someone who isn't on your Wi-Fi (like a tester in another state) can open it with `npx expo start --tunnel`.

## How it works

- **Sign-in** (`src/lib/auth.tsx`): Discord opens in the in-app sign-in sheet. The backend redirects to `weekendleague://auth/native-complete?ticket=…`, and the app swaps the one-time ticket for a session token (`POST /auth/native/redeem`), kept in the iOS Keychain via `expo-secure-store`.
- **Data** (`src/lib/queries.ts`): TanStack Query, with the cache saved on the phone. Screens show the last data they had instantly, then refresh in the background.
- **Live chat** (`src/lib/chatSocket.tsx`): one WebSocket while the app is on screen, authenticated with a short-lived ticket from `POST /auth/ticket?purpose=ws`. Incoming events are written straight into the query cache. It disconnects in the background and refetches on return.
- **Chat photos** (`src/lib/chatImage.ts`): resized to 1600 px and JPEG-compressed on the phone, then uploaded to the web app's `/api/chat/upload-native` route (the backend only accepts chat images from the web app's Blob store). Set `EXPO_PUBLIC_WEB_BASE_URL` alongside the API URL.
- **Types** (`src/lib/types.ts`): copied from `frontend/src/lib/api.ts`, trimmed to what these screens read.

## Screens so far

Sign-in, Home (your matchup and the rest of the league), Team (your roster, with lineup moves and swaps from a bottom sheet, and the web's sub-nav to Draft, Keepers, Free Agents and Trades), Trades (propose, accept, reject, cancel), Keepers (pick from last season's roster; commissioner rules and lock), Players (free agents by position or name, with ESPN's green + to add and yellow + to claim off waivers right from the list; add, with a drop when your roster is full, or a waiver claim when they're on waivers; plus My claims), Chat (league chat, Commish Corner and DMs, live over the chat WebSocket, with reactions, replies, photos from the library or camera, and typing indicators), League (the web's sub-nav: overview with polls, standings / scoreboard / playoffs, power rankings week / trend / all-time, rivalries, the rulebook, history and activity — plus awards and all-time records, Player Cards, draft grades, owner and team pages), matchup detail, Gamecast (tap any game in Home's NFL scores strip: live score and field position, the last play with who in your league it scored for, fantasy impact, scoring summary and play-by-play), the draft room (live clock and on-the-clock, player pool with a starred queue you can reorder, the board, draft-room chat, and commissioner start/pause/resume/undo; opened from Home), and player detail (bio, projection and ownership, game log chart, news and outlook; opened by tapping a player anywhere).

`src/lib/rosterSlots.ts` copies the slot-eligibility rules from `frontend/src/lib/rosterSlots.ts`, which mirrors `backend/app/domain/roster_slots.py`. Change all three together.

## Checks

```
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
