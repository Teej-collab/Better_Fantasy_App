"use client";

import { LoungeBanner, type BannerShape } from "@/components/lounge/LoungeBanner";

// The Lounge on a laptop or bigger (2026-10-29 "Lounge Camera Ring"
// mockups): everyone's camera rings the TV. A 7-column grid — a side
// column, five under the TV, a side column — with the TV across the
// middle four rows. Seats fill the bottom row from the center out, then
// climb both sides, then the top row from the center out, so everyone
// stays on screen up to 22 people (anyone past that wraps in a row
// underneath). Whatever border space is still empty is a banner.

const ORDER = [4, 3, 5, 2, 6, 1, 7];
export const RING_SEATS = 22;

type Area = { gridColumn: string; gridRow: string };
const area = (c1: number, c2: number, r1: number, r2: number): Area => ({ gridColumn: `${c1} / ${c2}`, gridRow: `${r1} / ${r2}` });

export function ringLayout(n: number) {
  const top = n > 15 ? 1 : 0;
  const mid = 1 + top;
  const bot = 5 + top;
  const slots: [number, number][] = ORDER.map((c) => [c, bot]);
  for (let i = 0; i < 4; i++) slots.push([1, mid + 3 - i], [7, mid + 3 - i]);
  ORDER.forEach((c) => slots.push([c, 1]));
  const used = slots.slice(0, Math.min(n, RING_SEATS));
  const taken = new Set(used.map(([c, r]) => `${c}_${r}`));
  const banners: { area: Area; shape: BannerShape }[] = [];
  const banner = (c1: number, c2: number, r1: number, r2: number) => {
    const rows = r2 - r1;
    const cols = c2 - c1;
    banners.push({ area: area(c1, c2, r1, r2), shape: rows >= 4 ? "tall" : rows >= 2 ? "mid" : cols >= 2 ? "wide" : "small" });
  };
  for (const c of [1, 7]) {
    let k = 0;
    for (let r = mid; r < mid + 4; r++) if (taken.has(`${c}_${r}`)) k++;
    const empty = 4 - k;
    if (empty > 0) banner(c, c + 1, mid, k === 0 && !taken.has(`${c}_${bot}`) ? bot + 1 : mid + empty);
  }
  const seats: Area[] = [];
  for (let c = 2; c <= 6; c++) if (!taken.has(`${c}_${bot}`)) seats.push(area(c, c + 1, bot, bot + 1));
  if (top) {
    let a = 1;
    while (a <= 7 && !taken.has(`${a}_1`)) a++;
    let b = 7;
    while (b >= 1 && !taken.has(`${b}_1`)) b--;
    if (a > 1) banner(1, a, 1, 2);
    if (b < 7) banner(b + 1, 8, 1, 2);
  }
  return {
    top: !!top,
    tv: area(2, 7, mid, mid + 4),
    tiles: used.map(([c, r]) => ({ area: area(c, c + 1, r, r + 1), side: c === 1 || c === 7 })),
    banners,
    seats,
  };
}

export function LoungeRing<T>({
  people,
  tv,
  renderTile,
  keyOf,
}: {
  people: T[];
  tv: React.ReactNode;
  renderTile: (person: T) => React.ReactNode;
  keyOf: (person: T) => string;
}) {
  const layout = ringLayout(people.length);
  const ringed = people.slice(0, RING_SEATS);
  const overflow = people.slice(RING_SEATS);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="lounge-ring" data-top={layout.top ? "" : undefined}>
        <div className="lounge-ring-tv" style={layout.tv}>
          {tv}
        </div>
        {ringed.map((p, i) => (
          <div key={keyOf(p)} className={`lounge-ring-seat${layout.tiles[i].side ? " lounge-ring-side" : ""}`} style={layout.tiles[i].area}>
            {renderTile(p)}
          </div>
        ))}
        {layout.seats.map((a, i) => (
          <div key={`seat-${i}`} className="lounge-ring-open" style={a}>
            Open seat
          </div>
        ))}
        {layout.banners.map((b, i) => (
          <LoungeBanner key={`banner-${i}`} shape={b.shape} delay={i * 1.7} style={b.area} />
        ))}
      </div>
      {overflow.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
          {overflow.map((p) => (
            <div key={keyOf(p)} className="aspect-[16/10]">
              {renderTile(p)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
