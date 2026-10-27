import { redirect } from "next/navigation";

// Keepers live in the War Room now (2026-10-27); old links and pushes land there.
export default function KeepersPage() {
  redirect("/war-room");
}
