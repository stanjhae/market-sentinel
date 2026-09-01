export function mapStatusForTest(status: string) {
  if (status === "LIVE") return "LIVE";
  if (status === "STALE") return "STALE";
  if (status === "RECONNECTING" || status === "CONNECTING") return "DELAYED";
  return "DISCONNECTED";
}
