// The Weekend TV (2026-11-14) — see backend/app/routers/tv.py. The TV
// shows a code; a signed-in member types it here to connect that TV.

export type PairedTv = {
  id: number;
  name: string;
  created_at: string;
  last_seen_at: string | null;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function approveTv(code: string) {
  return call<{ device_name: string }>("POST", "/tv/pair/approve", { code });
}

export async function listTvs(): Promise<PairedTv[]> {
  return (await call<{ devices: PairedTv[] }>("GET", "/tv/devices")).devices;
}

export function disconnectTv(id: number) {
  return call<{ ok: boolean }>("DELETE", `/tv/devices/${id}`);
}
