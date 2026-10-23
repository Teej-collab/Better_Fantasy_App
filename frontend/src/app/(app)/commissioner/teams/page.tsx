import { redirect } from "next/navigation";

// Teams joined Members (2026-10-23 overhaul): reassigning a team and
// making one for a member now live on each member's card.
export default function CommissionerTeamsPage() {
  redirect("/commissioner/members");
}
