import { randomUUID } from "node:crypto";

import { JsonlStore } from "./json-store.js";
import type { AuditEntry, HomeAssistantUser } from "./types.js";

export interface AuditInput {
  sessionId?: string | null;
  user?: HomeAssistantUser;
  requestedIntent: string;
  tool: string;
  operation: string;
  target: string;
  risk: AuditEntry["risk"];
  approval: AuditEntry["approval"];
  beforeState?: string;
  afterState?: string;
  result: AuditEntry["result"];
  rollbackStatus: AuditEntry["rollbackStatus"];
  error?: string;
}

const SYSTEM_USER: HomeAssistantUser = {
  id: null,
  name: "system",
  displayName: "System",
  isAdmin: true,
};

export class AuditLog {
  public constructor(private readonly store: JsonlStore<AuditEntry>) {}

  public async record(input: AuditInput): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId ?? null,
      user: input.user ?? SYSTEM_USER,
      requestedIntent: input.requestedIntent,
      tool: input.tool,
      operation: input.operation,
      target: input.target,
      risk: input.risk,
      approval: input.approval,
      beforeState: input.beforeState,
      afterState: input.afterState,
      result: input.result,
      rollbackStatus: input.rollbackStatus,
      error: input.error,
    };
    await this.store.append(entry);
    return entry;
  }

  public async list(limit = 500): Promise<AuditEntry[]> {
    return this.store.list(limit);
  }
}
