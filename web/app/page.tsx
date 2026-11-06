import { Dashboard } from "@/components/Dashboard";
import { getDashboardSnapshot } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getDashboardSnapshot();

  return <Dashboard initialData={snapshot} />;
}
