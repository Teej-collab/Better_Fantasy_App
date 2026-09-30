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
- **Types** (`src/lib/types.ts`): copied from `frontend/src/lib/api.ts`, trimmed to what these screens read.

## Screens so far

Sign-in, Home (your matchup and the rest of the league), Team (your roster, with lineup moves and swaps from a bottom sheet), Standings, and matchup detail.

`src/lib/rosterSlots.ts` copies the slot-eligibility rules from `frontend/src/lib/rosterSlots.ts`, which mirrors `backend/app/domain/roster_slots.py`. Change all three together.

## Checks

```
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
