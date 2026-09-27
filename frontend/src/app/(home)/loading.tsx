import { PageSkeleton } from "@/components/PageSkeleton";

// Shown the instant a nav link is tapped, while the page's server-side
// fetches run — see PageSkeleton.tsx for why this boundary matters.
export default function Loading() {
  return <PageSkeleton />;
}
