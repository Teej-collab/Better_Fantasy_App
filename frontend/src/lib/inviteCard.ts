import { API_BASE_URL } from "@/lib/api";

// What an invite link shows before anyone signs in (backend GET
// /leagues/invite-card): the preview card in iMessage and the like, and
// the "You're invited" header on /start?join=CODE.
export type InviteCard = {
  name: string;
  invite_code: string;
  team_count: number | null;
  teams: number;
  scoring: string;
  commissioner: string | null;
};

export async function getInviteCard(code: string): Promise<InviteCard | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/leagues/invite-card?code=${encodeURIComponent(code)}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as InviteCard;
  } catch {
    return null;
  }
}

export function inviteSummary(card: InviteCard): string {
  const full = card.team_count ? `${card.teams} of ${card.team_count} teams` : `${card.teams} teams`;
  return [full, card.scoring, card.commissioner ? `run by ${card.commissioner}` : null].filter(Boolean).join(" · ");
}
