import { redirect } from "next/navigation";

// League Bets lives in the app for now (mobile app/bets/league). A
// "they just bet" push tapped on the web lands here, so it opens My
// Bets instead of a 404.
export default function LeagueBetsPage() {
  redirect("/bets");
}
