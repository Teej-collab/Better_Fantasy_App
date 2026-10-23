import { Redirect } from 'expo-router';

// Teams joined Members (2026-10-23 overhaul): reassigning a team and
// making one for a member now live on each member's card.
export default function TeamsScreen() {
  return <Redirect href="/commissioner/members" />;
}
