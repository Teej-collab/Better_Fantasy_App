import { API_BASE_URL } from "@/lib/api";

// The one real logout implementation — clears both cookies (the
// backend's own, on railway.app, still needed for direct browser-
// >backend calls that haven't been proxied like the chat WebSocket;
// and the frontend's first-party copy every server-rendered page
// actually reads — see app/auth/logout/route.ts). Every caller
// (AccountMenu's Log Out item, Account & Security's Log Out button)
// awaits this, then handles its own router.push("/") + router.refresh()
// — this module has no router dependency, so it works the same from
// any client component.
export async function clearSession(): Promise<void> {
  await Promise.all([
    fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" }),
    fetch("/auth/logout", { method: "POST" }),
  ]);
}
