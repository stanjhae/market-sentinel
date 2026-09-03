import { parseEnv, withLocalInfraDefaults } from "@market-sentinel/config";

export function loadApiEnv() {
  return parseEnv(withLocalInfraDefaults({ source: process.env }));
}
