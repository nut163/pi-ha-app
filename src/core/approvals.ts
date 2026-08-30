import { randomUUID } from "node:crypto";

import { JsonStore } from "./json-store.js";
import type { ApprovalRequest, HomeAssistantUser, RiskLevel } from "./types.js";

export class ApprovalStore {
  public constructor(private readonly store: JsonStore<ApprovalRequest[]>) {}

  public async create(input: {
    sessionId: string;
    user: HomeAssistantUser;
    title: string;
    explanation: string;
    operation: string;
    target: string;
    risk: RiskLevel;
    toolName: string;
    arguments: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: randomUUID(),
      ...input,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.store.update((current) => [...current.filter((item) => item.status === "pending"), request]);
    return request;
  }

  public async listPending(): Promise<ApprovalRequest[]> {
    return (await this.store.get()).filter((item) => item.status === "pending");
  }

  public async get(id: string): Promise<ApprovalRequest | undefined> {
    return (await this.store.get()).find((item) => item.id === id);
  }

  public async resolve(
    id: string,
    status: "approved" | "rejected",
  ): Promise<ApprovalRequest | undefined> {
    let resolved: ApprovalRequest | undefined;
    await this.store.update((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        resolved = { ...item, status, resolvedAt: new Date().toISOString() };
        return resolved;
      }),
    );
    return resolved;
  }
}
