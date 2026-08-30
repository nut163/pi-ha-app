import path from "node:path";

import type { AppSettings, StoredState } from "./types.js";

export interface RuntimePaths {
  dataDir: string;
  configDir: string;
  sessionsDir: string;
  checkpointsDir: string;
  agentDir: string;
  stateFile: string;
  auditFile: string;
  approvalsFile: string;
  secretsFile: string;
  secretKeyFile: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autonomy: "guided",
  defaultWorkspace: "/config",
  retainSessionDays: 90,
  automaticBackups: "meaningful",
  restrictedCapabilities: [],
  theme: "system",
};

export function getRuntimePaths(overrides: Partial<RuntimePaths> = {}): RuntimePaths {
  const dataDir = overrides.dataDir ?? process.env.PI_HOME_AGENT_DATA_DIR ?? "/data";
  const configDir =
    overrides.configDir ??
    process.env.HOMEASSISTANT_CONFIG ??
    (process.platform === "win32" ? path.resolve(".ha-config") : "/config");

  return {
    dataDir,
    configDir,
    sessionsDir: overrides.sessionsDir ?? path.join(dataDir, "sessions"),
    checkpointsDir: overrides.checkpointsDir ?? path.join(dataDir, "checkpoints"),
    agentDir: overrides.agentDir ?? path.join(dataDir, "pi-agent"),
    stateFile: overrides.stateFile ?? path.join(dataDir, "state.json"),
    auditFile: overrides.auditFile ?? path.join(dataDir, "audit.jsonl"),
    approvalsFile: overrides.approvalsFile ?? path.join(dataDir, "approvals.json"),
    secretsFile: overrides.secretsFile ?? path.join(dataDir, "secrets.enc.json"),
    secretKeyFile: overrides.secretKeyFile ?? path.join(dataDir, ".secret-key"),
  };
}

export const DEFAULT_STATE: StoredState = {
  setupCompleted: false,
  settings: DEFAULT_SETTINGS,
};

export function mergeState(value: Partial<StoredState> | undefined): StoredState {
  return {
    ...DEFAULT_STATE,
    ...value,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(value?.settings ?? {}),
      ...(value?.settings?.provider === undefined
        ? {}
        : { provider: value.settings.provider }),
    },
  };
}
