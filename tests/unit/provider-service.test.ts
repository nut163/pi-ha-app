import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

import { getRuntimePaths } from "../../src/core/config.js";
import { JsonStore } from "../../src/core/json-store.js";
import { SecretStore } from "../../src/core/secrets.js";
import type { StoredState } from "../../src/core/types.js";
import { ProviderService } from "../../src/agent/provider-service.js";

describe("ProviderService", () => {
  it("tests streaming and never returns the provider key", async () => {
    const root = path.join(os.tmpdir(), `pi-provider-${Date.now()}`);
    const paths = getRuntimePaths({ dataDir: root, configDir: path.join(root, "config") });
    const state = new JsonStore<StoredState>(paths.stateFile, { setupCompleted: false, settings: { autonomy: "guided", defaultWorkspace: "/config", retainSessionDays: 90, automaticBackups: "meaningful", restrictedCapabilities: [], theme: "system" } });
    const secrets = new SecretStore(paths.secretKeyFile, paths.secretsFile);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n", { status: 200 }));
    const service = new ProviderService({ paths, state, secrets, fetchImpl });
    const keyless = await service.test({ kind: "openai-compatible", model: "test-model", baseUrl: "http://localhost:1234/v1" });
    expect(keyless.ok).toBe(true);
    const result = await service.test({ kind: "openai-compatible", model: "test-model", baseUrl: "http://localhost:1234/v1", apiKey: "secret-value" });
    expect(result.ok).toBe(true);
    await service.save({ kind: "openai-compatible", model: "test-model", baseUrl: "http://localhost:1234/v1", apiKey: "secret-value" });
    expect(await service.getStatus()).toMatchObject({ configured: true, keyConfigured: true });
    const saved = await state.get();
    expect(saved.settings.provider).not.toHaveProperty("apiKey");
    expect(JSON.stringify(saved)).not.toContain("secret-value");
  });
});
