import { AlertSettingsForm } from "@/components/alert-settings-form";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <AlertSettingsForm />
    </div>
  );
}
