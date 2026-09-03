import { parseEnv, withLocalInfraDefaults } from "@market-sentinel/config";

export function loadWorkerEnv() {
  return parseEnv(withLocalInfraDefaults({ source: process.env }));
}
