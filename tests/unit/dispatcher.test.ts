import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ActivityHub } from "../../src/core/activity-hub.js";
import { ApprovalStore } from "../../src/core/approvals.js";
import { AuditLog } from "../../src/core/audit.js";
import { JsonStore, JsonlStore } from "../../src/core/json-store.js";
import { ConfigPathPolicy } from "../../src/core/path-policy.js";
import { RiskPolicy } from "../../src/core/risk-policy.js";
import { ChangeTransactionRunner } from "../../src/core/transaction.js";
import { HomeAssistantCapabilityLayer } from "../../src/ha/capability-layer.js";
import type { HomeAssistantUser } from "../../src/core/types.js";
import { ToolDispatcher } from "../../src/agent/tool-dispatcher.js";

describe("ToolDispatcher", () => {
  it("resumes a medium-risk service call after approval without creating a second approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-dispatcher-"));
    const configDir = path.join(root, "config");
    const dataDir = path.join(root, "data");
    await mkdir(configDir, { recursive: true });
    const callService = vi.fn(async () => [{ entity_id: "light.kitchen", state: "on" }]);
    const core = { callService } as any;
    const supervisor = { checkCore: vi.fn(async () => ({ valid: true })) } as any;
    const layer = new HomeAssistantCapabilityLayer({ configDir, cacheFile: path.join(dataDir, "mcp.json"), core, supervisor, pathPolicy: new ConfigPathPolicy(configDir) });
    const approvals = new ApprovalStore(new JsonStore(path.join(dataDir, "approvals.json"), []));
    const audit = new AuditLog(new JsonlStore(path.join(dataDir, "audit.jsonl")));
    const activity = new ActivityHub();
    const dispatcher = new ToolDispatcher(layer, new ChangeTransactionRunner({ pathPolicy: layer.pathPolicy, riskPolicy: new RiskPolicy(), approvals, audit, checkpointsDir: path.join(dataDir, "checkpoints"), automaticBackups: "never" }), approvals, audit, new RiskPolicy(), activity);
    const user: HomeAssistantUser = { id: "u1", name: "user", displayName: "User", isAdmin: true };
    const request = await dispatcher.execute("ha_call_service", { domain: "light", service: "turn_on", data: { entity_id: "light.kitchen" } }, { sessionId: "s1", user, intent: "turn on kitchen", autonomy: "guided" });
    expect("approvalRequired" in request).toBe(true);
    if (!("approvalRequired" in request)) return;
    const result = await dispatcher.resolveApproval(request.approval.id, "approved", user, "guided");
    expect("approvalRequired" in result).toBe(false);
    expect(callService).toHaveBeenCalledOnce();
  });
});
