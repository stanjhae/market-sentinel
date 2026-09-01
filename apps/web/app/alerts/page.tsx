import { AlertsInbox } from "@/components/alerts-inbox";

export default function AlertsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Alerts</h1>
      <AlertsInbox />
    </div>
  );
}
