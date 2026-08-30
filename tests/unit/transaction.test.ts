import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ApprovalStore } from "../../src/core/approvals.js";
import { AuditLog } from "../../src/core/audit.js";
import { JsonStore, JsonlStore } from "../../src/core/json-store.js";
import { ConfigPathPolicy } from "../../src/core/path-policy.js";
import { RiskPolicy } from "../../src/core/risk-policy.js";
import { ChangeTransactionRunner } from "../../src/core/transaction.js";
import type { HomeAssistantUser } from "../../src/core/types.js";

const user: HomeAssistantUser = { id: "test", name: "tester", displayName: "Tester", isAdmin: true };

describe("ChangeTransactionRunner", () => {
  it("writes, validates, and records a local checkpoint", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-transaction-"));
    const config = path.join(root, "config");
    const data = path.join(root, "data");
    await mkdir(config, { recursive: true });
    const runner = new ChangeTransactionRunner({
      pathPolicy: new ConfigPathPolicy(config),
      riskPolicy: new RiskPolicy(),
      approvals: new ApprovalStore(new JsonStore(path.join(data, "approvals.json"), [])),
      audit: new AuditLog(new JsonlStore(path.join(data, "audit.jsonl"))),
      checkpointsDir: path.join(data, "checkpoints"),
      automaticBackups: "never",
    });
    const result = await runner.writeFile({ sessionId: "session", user, intent: "add a card", path: "www/card.js", content: "console.log('ok');", autonomy: "autonomous" });
    expect("approvalRequired" in result).toBe(false);
    expect(await readFile(path.join(config, "www/card.js"), "utf8")).toContain("console.log");
    expect((await new AuditLog(new JsonlStore(path.join(data, "audit.jsonl"))).list())[0]?.result).toBe("success");
  });

  it("rolls back an invalid YAML write", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-rollback-"));
    const config = path.join(root, "config");
    const data = path.join(root, "data");
    await mkdir(config, { recursive: true });
    const target = path.join(config, "automations.yaml");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(target, "- id: existing\n"));
    const runner = new ChangeTransactionRunner({
      pathPolicy: new ConfigPathPolicy(config),
      riskPolicy: new RiskPolicy(),
      approvals: new ApprovalStore(new JsonStore(path.join(data, "approvals.json"), [])),
      audit: new AuditLog(new JsonlStore(path.join(data, "audit.jsonl"))),
      checkpointsDir: path.join(data, "checkpoints"),
      automaticBackups: "never",
    });
    const result = await runner.writeFile({ sessionId: "session", user, intent: "break yaml", path: "automations.yaml", content: "- id: [", autonomy: "autonomous" });
    expect(result.content).toContain("rolled back");
    expect(await readFile(target, "utf8")).toBe("- id: existing\n");
  });
});
