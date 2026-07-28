import { redirect } from "next/navigation";

export default function HistoryPage() {
  // The trophy case is gone as a section of its own — every honour is recorded
  // inside the season that won it, so the season record IS the history.
  redirect("/seasons#seasons");
}
