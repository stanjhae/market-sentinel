import { JournalBoard } from "@/components/journal-board";

export default function JournalPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Journal</h1>
      <JournalBoard />
    </div>
  );
}
