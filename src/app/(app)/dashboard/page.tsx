import { redirect } from "next/navigation";

// The Ops dashboard is now part of My day.
export default function Dashboard() {
  redirect("/?who=all");
}
