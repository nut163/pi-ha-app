import { describe, expect, it } from "vitest";

import { RiskPolicy } from "../../src/core/risk-policy.js";

describe("RiskPolicy", () => {
  const policy = new RiskPolicy();

  it("keeps reads approval-free in every autonomy mode", () => {
    const classification = policy.classify("ha_list_entities", { query: "light" });
    expect(classification.risk).toBe("READ");
    expect(policy.requiresApproval("guided", classification)).toBe(false);
    expect(policy.requiresApproval("balanced", classification)).toBe(false);
    expect(policy.requiresApproval("autonomous", classification)).toBe(false);
  });

  it("requires confirmation for destructive actions even when autonomous", () => {
    const classification = policy.classify("ha_uninstall_app", { slug: "example" });
    expect(classification.risk).toBe("HIGH");
    expect(policy.requiresApproval("autonomous", classification)).toBe(true);
  });

  it("raises configuration.yaml writes to medium risk", () => {
    expect(policy.classify("ha_write_file", { path: "configuration.yaml" }).risk).toBe("MEDIUM");
    expect(policy.classify("ha_write_file", { path: "www/card.js" }).risk).toBe("LOW");
    expect(policy.classify("ha_write_file", { path: ".storage/core.config" }).risk).toBe("HIGH");
  });
});
