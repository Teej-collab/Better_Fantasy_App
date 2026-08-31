// Email/password signup and login (Phase 5 of the multi-league
// migration — see backend TODO.md's PHASE 9 entry) — a second,
// independent way to get a real Weekend account, alongside Discord.
// Same same-origin /api/backend proxy every other authenticated call
// in this app uses (see that route's own docstring for why: Safari
// ITP blocks a direct cross-site cookie). The backend's own Set-Cookie
// header never survives that proxy (by design — it's a different
// domain's cookie anyway), so both calls return the real session token
// in the JSON body instead, which the caller hands to
// /auth/complete/set-cookie to finish signing in — the exact same
// second half the Discord OAuth flow already uses.

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function signup(email: string, password: string, displayName: string): Promise<{ token: string }> {
  return post("/auth/signup", { email, password, display_name: displayName });
}

export async function login(email: string, password: string): Promise<{ token: string }> {
  return post("/auth/login", { email, password });
}

// Same route the Discord flow's /auth/complete page posts to — sets
// the frontend's own first-party cookie from a real session token.
export async function completeSignIn(token: string): Promise<void> {
  const res = await fetch("/auth/complete/set-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error("Couldn't complete sign-in");
}
